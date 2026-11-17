(function installPopoPageApiBridge() {
  "use strict";

  const REQUEST_SOURCE = "popo-stable-downloader-isolated";
  const RESPONSE_SOURCE = "popo-stable-downloader-page";
  const OBSERVED_DOWNLOAD_URL_EVENT = "popo-stable-download:observed-url";
  const REQUEST_OBSERVED_DOWNLOAD_URLS_EVENT = "popo-stable-download:request-observed-urls";
  const PAGE_ROUTE_CHANGE_EVENT = "popo-stable-download:page-route-change";
  const ALLOWED_PATHS = new Set([
    "/api/bs-team-space/web/v1/page/download",
    "/api/bs-team-space/web/v1/teamSpace/id"
  ]);
  // 目录列表接口：仅允许 POST，请求体由模板生成（见 buildFolderListBody）。
  const FOLDER_LIST_PATH = "/api/bs-team-space/web/v1/page/folderSubList";
  const FOLDER_TEMPLATE_KEYS = ["folderPriority", "sortField", "isAsc", "pageMajorVersion"];
  const nativeFetch = window.fetch;
  let folderTemplate = null;

  const observedResources = new WeakSet();
  const observedUrls = [];
  const MAX_OBSERVED_URLS = 120;

  function reportPageRouteChange(previousUrl) {
    if (window.location.href === previousUrl) return;
    window.dispatchEvent(new CustomEvent(PAGE_ROUTE_CHANGE_EVENT, {
      detail: { url: window.location.href }
    }));
  }

  for (const method of ["pushState", "replaceState"]) {
    const original = window.history[method];
    if (typeof original !== "function") continue;
    window.history[method] = function (...args) {
      const previousUrl = window.location.href;
      const result = original.apply(this, args);
      reportPageRouteChange(previousUrl);
      return result;
    };
  }
  window.addEventListener("popstate", () => {
    window.dispatchEvent(new CustomEvent(PAGE_ROUTE_CHANGE_EVENT, {
      detail: { url: window.location.href }
    }));
  });

  function reportObservedUrl(value) {
    const candidate = String(value || "").trim();
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch {
      return;
    }
    if (parsed.protocol !== "https:" ||
        !parsed.hostname.toLowerCase().endsWith(".s3v2.nie.netease.com") ||
        parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) return;
    // Parse only for validation. Keep the observed signed URL byte-for-byte
    // equivalent after trimming; rebuilding it can invalidate its signature.
    const allowedUrl = candidate;
    const existingIndex = observedUrls.indexOf(allowedUrl);
    if (existingIndex >= 0) observedUrls.splice(existingIndex, 1);
    observedUrls.push(allowedUrl);
    if (observedUrls.length > MAX_OBSERVED_URLS) {
      observedUrls.splice(0, observedUrls.length - MAX_OBSERVED_URLS);
    }
    window.dispatchEvent(new CustomEvent(OBSERVED_DOWNLOAD_URL_EVENT, { detail: allowedUrl }));
  }

  window.addEventListener(REQUEST_OBSERVED_DOWNLOAD_URLS_EVENT, () => {
    for (const url of observedUrls) {
      window.dispatchEvent(new CustomEvent(OBSERVED_DOWNLOAD_URL_EVENT, { detail: url }));
    }
  });

  function inspectResource(resource) {
    if (!resource || typeof resource !== "object" || observedResources.has(resource)) return;
    observedResources.add(resource);
    reportObservedUrl(resource.name);
  }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) inspectResource(entry);
    });
    observer.observe({ type: "resource", buffered: true });
  } catch {}

  /**
   * 清洗并规范化访问令牌字符串，剔除可能包裹的双引号、反斜杠转义或首尾空白字符，
   * 并支持从 JSON 序列化对象中提取 accessToken / token 字段。
   * 避免由于 JSON.stringify(token) 存入 storage 导致带引号的 Authorization 请求头被网关判定为 405/401。
   */
  function normalizeAuthToken(raw) {
    if (!raw || typeof raw !== "string") return "";
    let token = raw.trim();
    if (token.startsWith("{") && token.endsWith("}")) {
      try {
        const parsed = JSON.parse(token);
        if (parsed && typeof parsed === "object") {
          token = String(parsed.accessToken || parsed.token || parsed.authToken || parsed.popo_token || "").trim();
        }
      } catch {}
    }
    if (token.startsWith('"') && token.endsWith('"') && token.length >= 2) {
      token = token.slice(1, -1).trim();
    }
    token = token.replace(/\\"/g, '"');
    return token;
  }

  /**
   * 从 Cookie 或 Web Storage 中解析当前登录用户的访问令牌。
   * POPO 页面在调用取址与鉴权接口时，要求在 Request Headers 中显式携带 Authorization 与 Devicetype，
   * 否则网关会将请求判定为未授权访客并返回 status: 405 (没有权限操作)。
   */
  function resolveAuthToken() {
    try {
      const match = document.cookie.match(/(?:^|;\s*)(?:accessToken|token|popo_token)=([^;]+)/i);
      if (match && match[1]) {
        const decoded = decodeURIComponent(match[1]);
        const cleaned = normalizeAuthToken(decoded);
        if (cleaned) return cleaned;
      }
    } catch {}
    try {
      for (const storage of [window.localStorage, window.sessionStorage]) {
        if (!storage) continue;
        for (const key of ["accessToken", "token", "popo_token", "authToken", "popoToken"]) {
          const val = storage.getItem(key);
          const cleaned = normalizeAuthToken(val);
          if (cleaned) return cleaned;
        }
      }
    } catch {}
    return "";
  }

  // 记下页面自己发出的目录列表请求里的数字与布尔字段，扩展发同接口请求时沿用。
  function rememberFolderTemplate(url, bodyText) {
    try {
      if (new URL(url, window.location.origin).pathname !== FOLDER_LIST_PATH) return;
      const parsed = typeof bodyText === "string" ? JSON.parse(bodyText) : null;
      if (!parsed || typeof parsed !== "object") return;
      const template = {};
      for (const key of FOLDER_TEMPLATE_KEYS) {
        if (typeof parsed[key] === "number" || typeof parsed[key] === "boolean") template[key] = parsed[key];
      }
      if (Object.keys(template).length) folderTemplate = template;
    } catch {}
  }

  function buildFolderListBody(input) {
    if (!folderTemplate) return { error: "no_template", status: 0 };
    const valid = input && typeof input === "object" &&
      typeof input.pageId === "string" && input.pageId.length > 0 && input.pageId.length <= 64 &&
      typeof input.teamSpaceId === "string" && input.teamSpaceId.length > 0 && input.teamSpaceId.length <= 64;
    if (!valid) return { error: "请求体无效", status: 400 };
    const body = { ...folderTemplate, pageId: input.pageId, teamSpaceId: input.teamSpaceId };
    if (Number.isInteger(input.pageMajorVersion)) body.pageMajorVersion = input.pageMajorVersion;
    return { body };
  }

  // ── 页面结构诊断：只记录同源 /api/ JSON 响应的字段名与类型名，不记录任何值。
  const PROBE_EVENT = "popo-stable-download:probe";
  const REQUEST_PROBE_EVENT = "popo-stable-download:request-probe";
  const MAX_PROBE_APIS = 20;
  const MAX_PROBE_BODY = 1000000;
  const probeApis = new Map();
  const probeEnumPairs = new Set();

  function describeShape(value, depth) {
    if (value === null) return "null";
    if (Array.isArray(value)) return depth >= 4 || !value.length ? [] : [describeShape(value[0], depth + 1)];
    if (typeof value === "object") {
      if (depth >= 4) return "…";
      const shape = {};
      for (const key of Object.keys(value).slice(0, 40)) shape[key] = describeShape(value[key], depth + 1);
      return shape;
    }
    return typeof value === "number" || typeof value === "boolean" ? typeof value : "string";
  }

  // 在读取响应体之前就按地址、类型和大小过滤；同一接口只解析一次。
  function probeKey(method, url) {
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.origin !== window.location.origin || !parsed.pathname.startsWith("/api/")) return "";
      const key = method + " " + parsed.pathname.replace(/\/[^/]{16,}/g, "/:id");
      if (probeApis.has(key) || probeApis.size >= MAX_PROBE_APIS) return "";
      return key;
    } catch {
      return "";
    }
  }

  // 页面条目里的 pageType 与 hasChildren 都是小整数枚举，可以原样记录，用来分辨文件夹与文件。
  function collectEnumPairs(value, depth) {
    if (!value || typeof value !== "object" || depth > 4 || probeEnumPairs.size >= 20) return;
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 200)) collectEnumPairs(item, depth + 1);
      return;
    }
    if (Number.isInteger(value.pageType) && Number.isInteger(value.hasChildren)) {
      probeEnumPairs.add(value.pageType + "|" + value.hasChildren);
    }
    for (const key of Object.keys(value).slice(0, 40)) collectEnumPairs(value[key], depth + 1);
  }

  function requestShape(body) {
    try {
      if (typeof body !== "string" || body.length > 100000 || body[0] !== "{") return undefined;
      return describeShape(JSON.parse(body), 0);
    } catch {
      return undefined;
    }
  }

  function recordProbe(key, method, url, status, text, request) {
    try {
      if (typeof text !== "string" || text.length > MAX_PROBE_BODY || text[0] !== "{" && text[0] !== "[") return;
      const body = JSON.parse(text);
      collectEnumPairs(body, 0);
      probeApis.set(key, {
        method, path: new URL(url, window.location.origin).pathname, status,
        ...(request === undefined ? {} : { request }), shape: describeShape(body, 0)
      });
    } catch {}
  }

  function jsonWithinLimit(headers) {
    const type = String(headers.get("content-type") || "");
    const length = Number(headers.get("content-length"));
    return /json/i.test(type) && !(Number.isFinite(length) && length > MAX_PROBE_BODY);
  }

  try {
    const originalFetch = window.fetch;
    window.fetch = function (...args) {
      const result = originalFetch.apply(this, args);
      try {
        const method = String((args[1] && args[1].method) || (args[0] && args[0].method) || "GET").toUpperCase();
        const request = requestShape(args[1] && args[1].body);
        rememberFolderTemplate(String((args[0] && args[0].url) || args[0] || ""), args[1] && args[1].body);
        result.then((response) => {
          try {
            const key = probeKey(method, response.url);
            if (!key || !jsonWithinLimit(response.headers)) return;
            response.clone().text().then((text) => recordProbe(key, method, response.url, response.status, text, request)).catch(() => {});
          } catch {}
        }).catch(() => {});
      } catch {}
      return result;
    };
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      try {
        this.__popoProbeRequest = requestShape(body);
        rememberFolderTemplate(this.__popoProbeUrl || "", body);
      } catch {}
      return originalSend.call(this, body);
    };
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      try {
        this.__popoProbeUrl = String(url);
        this.addEventListener("load", () => {
          const upperMethod = String(method || "GET").toUpperCase();
          const key = probeKey(upperMethod, String(url));
          if (key && (this.responseType === "" || this.responseType === "text") && /json/i.test(String(this.getResponseHeader("content-type") || ""))) {
            recordProbe(key, upperMethod, String(url), this.status, this.responseText, this.__popoProbeRequest);
          }
        });
      } catch {}
      return originalOpen.call(this, method, url, ...rest);
    };
  } catch {}

  window.addEventListener(REQUEST_PROBE_EVENT, () => {
    window.dispatchEvent(new CustomEvent(PROBE_EVENT, {
      detail: JSON.stringify({ apis: Array.from(probeApis.values()), enums: { pageTypePairs: Array.from(probeEnumPairs) } })
    }));
  });

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.data?.source !== REQUEST_SOURCE) return;
    const { requestId, path } = event.data;
    if (typeof requestId !== "string" || typeof path !== "string") return;
    const method = event.data.method === undefined ? "GET" : event.data.method;
    const reply = (fields) => window.postMessage({ source: RESPONSE_SOURCE, requestId, ...fields }, window.location.origin);
    if (method !== "GET" && method !== "POST") {
      reply({ ok: false, status: 403, error: "请求方法不在允许范围" });
      return;
    }
    let requestUrl;
    try {
      requestUrl = new URL(path, window.location.origin);
    } catch {
      window.postMessage({
        source: RESPONSE_SOURCE,
        requestId,
        ok: false,
        status: 400,
        error: "无效的请求路径"
      }, window.location.origin);
      return;
    }
    const allowed = method === "POST"
      ? requestUrl.pathname === FOLDER_LIST_PATH
      : ALLOWED_PATHS.has(requestUrl.pathname);
    if (requestUrl.origin !== window.location.origin || !allowed) {
      window.postMessage({
        source: RESPONSE_SOURCE,
        requestId,
        ok: false,
        status: 403,
        error: "请求目标不在允许的白名单接口列表中"
      }, window.location.origin);
      return;
    }

    try {
      const headers = {
        Accept: "application/json, text/plain, */*",
        Devicetype: "7"
      };
      const authToken = resolveAuthToken();
      if (authToken) {
        headers.Authorization = authToken;
      }
      let postBody;
      if (method === "POST") {
        const built = buildFolderListBody(event.data.body);
        if (built.error) {
          reply({ ok: false, status: built.status, error: built.error });
          return;
        }
        postBody = JSON.stringify(built.body);
        headers["Content-Type"] = "application/json";
      }
      const response = await nativeFetch.call(window, `${requestUrl.pathname}${requestUrl.search}`, {
        credentials: "include",
        headers,
        method,
        ...(postBody === undefined ? {} : { body: postBody })
      });
      reportObservedUrl(response.url);
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
      window.postMessage({
        source: RESPONSE_SOURCE,
        requestId,
        ok: response.ok,
        status: response.status,
        body
      }, window.location.origin);
    } catch (error) {
      window.postMessage({
        source: RESPONSE_SOURCE,
        requestId,
        ok: false,
        status: 0,
        error: String(error)
      }, window.location.origin);
    }
  });
})();
