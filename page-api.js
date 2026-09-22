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
   * 从 Cookie 或 Web Storage 中解析当前登录用户的访问令牌。
   * POPO 页面在调用取址与鉴权接口时，要求在 Request Headers 中显式携带 Authorization 与 Devicetype，
   * 否则网关会将请求判定为未授权访客并返回 status: 405 (没有权限操作)。
   */
  function resolveAuthToken() {
    try {
      const match = document.cookie.match(/(?:^|;\s*)accessToken=([^;]+)/);
      if (match && match[1]) return decodeURIComponent(match[1]);
    } catch {}
    try {
      return window.localStorage.getItem("accessToken") ||
             window.sessionStorage.getItem("accessToken") ||
             "";
    } catch {
      return "";
    }
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.data?.source !== REQUEST_SOURCE) return;
    const { requestId, path } = event.data;
    if (typeof requestId !== "string" || typeof path !== "string") return;
    let requestUrl;
    try {
      requestUrl = new URL(path, window.location.origin);
    } catch {
      return;
    }
    if (requestUrl.origin !== window.location.origin || !ALLOWED_PATHS.has(requestUrl.pathname)) return;

    try {
      const headers = {
        Accept: "application/json, text/plain, */*",
        Devicetype: "7"
      };
      const authToken = resolveAuthToken();
      if (authToken) {
        headers.Authorization = authToken;
      }
      const response = await window.fetch(`${requestUrl.pathname}${requestUrl.search}`, {
        credentials: "include",
        headers,
        method: "GET"
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
