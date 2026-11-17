/**
 * [INPUT]: 接收页面脚本上报的未信任诊断对象。
 * [OUTPUT]: 导出 ProbeReport 类型与 sanitizeProbeReport。
 * [POS]: 页面结构诊断的唯一清洗入口；后台存储前与弹窗复制前都以它的结果为准。只保留字段名与类型名。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
export interface ProbeApi {
  method: string;
  path: string;
  status: number;
  /** 请求体的字段名与类型名；没有 JSON 请求体时缺省。 */
  request?: unknown;
  shape: unknown;
}

export interface ProbeReport {
  apis: ProbeApi[];
  rows: { attributeNames: string[]; hasPageDetailLink: boolean };
  /** 页面条目的 "pageType|hasChildren" 枚举组合，用来分辨文件夹与文件。 */
  enums: { pageTypePairs: string[] };
}

const MAX_APIS = 20;
const MAX_DEPTH = 4;
const MAX_KEYS = 40;
const MAX_ATTRIBUTES = 40;
const MAX_ENUM_PAIRS = 20;
const ENUM_PAIR = /^\d{1,3}\|\d{1,2}$/;
const TYPE_NAMES = new Set(["string", "number", "boolean", "null", "object", "array"]);
const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
// 键和路径段只保留“像接口词”的短词：不含数字（版本号 v1 除外）、不是十六进制、长度受限。
// 无法完全排除小写人名之类的普通词，所以诊断只在本机保存，由用户复制前自行查看。
const KEY_PATTERN = /^[A-Za-z_][A-Za-z_]{0,23}$/;
const PATH_WORD = /^(?:[A-Za-z][A-Za-z-]{0,14}|v\d{1,2})$/;
const MAX_MAP_KEYS = 12;
const ATTRIBUTE_PATTERN = /^[A-Za-z_:][-A-Za-z0-9_:]{0,40}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cleanShape(value: unknown, depth: number): unknown {
  if (typeof value === "string") return TYPE_NAMES.has(value) ? value : "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (value === null) return "null";
  if (depth >= MAX_DEPTH) return "…";
  if (Array.isArray(value)) return value.length ? [cleanShape(value[0], depth + 1)] : [];
  if (!isRecord(value)) return "string";
  const entries = Object.entries(value);
  // 键很多且值结构相同：多半是以名称或标识为键的映射，只保留一份结构。
  if (entries.length > MAX_MAP_KEYS) {
    const shapes = new Set(entries.map(([, child]) => JSON.stringify(cleanShape(child, depth + 1))));
    if (shapes.size === 1) return { "<map>": cleanShape(entries[0]![1], depth + 1) };
  }
  const result: Record<string, unknown> = {};
  for (const [key, child] of entries.slice(0, MAX_KEYS)) {
    const safeKey = KEY_PATTERN.test(key) ? key : "<key>";
    if (!(safeKey in result)) result[safeKey] = cleanShape(child, depth + 1);
  }
  return result;
}

function cleanPath(value: unknown): string {
  const path = String(value ?? "").split("?")[0]!.slice(0, 200);
  return path
    .split("/")
    .map((segment) => (!segment || PATH_WORD.test(segment) ? segment : ":id"))
    .join("/");
}

export function sanitizeProbeReport(value: unknown): ProbeReport {
  const source = isRecord(value) ? value : {};
  const apis = (Array.isArray(source.apis) ? source.apis : [])
    .filter(isRecord)
    .slice(0, MAX_APIS)
    .map((api): ProbeApi => {
      const method = String(api.method || "").toUpperCase();
      const status = Number(api.status);
      return {
        method: METHODS.has(method) ? method : "OTHER",
        path: cleanPath(api.path),
        status: Number.isInteger(status) ? Math.min(999, Math.max(0, status)) : 0,
        ...(api.request === undefined ? {} : { request: cleanShape(api.request, 0) }),
        shape: cleanShape(api.shape, 0),
      };
    });
  const rows = isRecord(source.rows) ? source.rows : {};
  const attributeNames = [...new Set(
    (Array.isArray(rows.attributeNames) ? rows.attributeNames : [])
      .map(String)
      .filter((name) => ATTRIBUTE_PATTERN.test(name)),
  )].sort().slice(0, MAX_ATTRIBUTES);
  const enums = isRecord(source.enums) ? source.enums : {};
  const pageTypePairs = [...new Set(
    (Array.isArray(enums.pageTypePairs) ? enums.pageTypePairs : [])
      .map(String)
      .filter((pair) => ENUM_PAIR.test(pair)),
  )].sort().slice(0, MAX_ENUM_PAIRS);
  return {
    apis,
    rows: { attributeNames, hasPageDetailLink: rows.hasPageDetailLink === true },
    enums: { pageTypePairs },
  };
}
