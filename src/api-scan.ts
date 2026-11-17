/**
 * [INPUT]: 接收 POPO 目录列表接口（folderSubList）的未信任响应体与页面地址。
 * [OUTPUT]: 导出 parseFolderSubList、findChildFolder、pageUrlFor 与 FOLDER_PAGE_TYPE。
 * [POS]: 接口扫描的纯规则；后台据此建立条目，数量不符或翻页未知时返回失败原因，由后台回退页面扫描。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
export const FOLDER_PAGE_TYPE = 0;

export interface ApiFolder {
  pageId: string;
  name: string;
  pageMajorVersion: number;
  /** 条目声称有子项（1）：后台据此识别“有子项却返回空列表”。 */
  hasChildren: number;
}

export interface ApiFile {
  pageId: string;
  name: string;
  size: number;
}

export type FolderListResult =
  | { ok: true; total: number; folders: ApiFolder[]; files: ApiFile[] }
  | {
      ok: false;
      reason: "business_error" | "bad_shape" | "more" | "count_mismatch" | "unknown_kind";
      more: number;
      total: number;
      length: number;
      /** 业务错误时的业务码与简短提示；其他失败为 0 与空串。 */
      status: number;
      detail: string;
    };

const SUCCESS_STATUSES = new Set([0, 1, 200]);

const failure = (
  reason: "business_error" | "bad_shape" | "more" | "count_mismatch" | "unknown_kind",
  counts: { more?: number; total?: number; length?: number; status?: number; detail?: string } = {},
): FolderListResult => ({
  ok: false, reason, more: counts.more ?? 0, total: counts.total ?? 0, length: counts.length ?? 0,
  status: counts.status ?? 0, detail: counts.detail ?? "",
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 只信任“数量一致且没有下一页”的响应；其余原因交给调用方回退。 */
export function parseFolderSubList(body: unknown): FolderListResult {
  if (!isRecord(body)) return failure("bad_shape");
  const status = body.status ?? body.code;
  // 实测（2026-11-17）：成功时业务码为 1、提示“成功”；0 与 200 也按成功处理。
  if (typeof status === "number" && !SUCCESS_STATUSES.has(status)) {
    return failure("business_error", { status, detail: String(body.message ?? body.msg ?? "").slice(0, 80) });
  }
  const data = body.data;
  if (!isRecord(data) || !Array.isArray(data.pageList)) return failure("bad_shape");
  const list = data.pageList;
  const total = Number(data.total);
  const more = data.more === true ? 1 : 0;
  const counts = { more, total: Number.isInteger(total) ? total : 0, length: list.length };
  if (!Number.isInteger(total) || total < 0) return failure("bad_shape", counts);
  const folders: ApiFolder[] = [];
  const files: ApiFile[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) return failure("bad_shape", counts);
    const pageId = String(entry.pageId ?? "");
    const name = String(entry.pageName ?? "").trim();
    if (!pageId || !name) return failure("bad_shape", counts);
    if (entry.pageType === FOLDER_PAGE_TYPE) {
      folders.push({
        pageId, name, pageMajorVersion: Number(entry.pageMajorVersion) || 0,
        hasChildren: Number(entry.hasChildren) === 1 ? 1 : 0,
      });
    } else {
      // 只有 pageType 0 与 3 有实测依据。非 0 类型却带子项（如有子页面的文档）无法判定种类，交给页面扫描。
      if (Number(entry.hasChildren) === 1) return failure("unknown_kind", counts);
      files.push({ pageId, name, size: Number(entry.pageSize) || 0 });
    }
  }
  if (more) return failure("more", counts);
  // 实测（2026-11-17）：total 可能为 0 而列表有内容，说明它不是可靠的总数。
  // total 为 0 视为“未提供”，以 more 为准；total 大于 0 时仍要求与条数相等。
  if (total > 0 && list.length !== total) return failure("count_mismatch", counts);
  return { ok: true, total: list.length, folders, files };
}

/** 同名文件夹不唯一时返回 null，调用方应回退页面扫描。 */
export function findChildFolder(result: FolderListResult, name: string): ApiFolder | null {
  if (!result.ok) return null;
  const matches = result.folders.filter((folder) => folder.name === name);
  return matches.length === 1 ? matches[0]! : null;
}

export function pageUrlFor(rootUrl: string, pageId: string): string {
  return rootUrl.replace(/(\/pageDetail\/)[a-z0-9]+/i, `$1${pageId}`);
}
