/**
 * [INPUT]: 接收后台记录的目录扫描结果、文件状态与目录读取失败。
 * [OUTPUT]: 导出 DirectorySummary 类型、MAX_DIRECTORY_SUMMARIES 与 summarizeDirectories。
 * [POS]: 纯汇总规则；后台把结果写入任务，页面与弹窗只读取。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
export interface DirectoryScanRecord {
  path: string[];
  expected: number | null;
  found: number;
  verified: boolean;
  /** 扫描方式；旧记录没有此字段，按页面扫描处理。 */
  via?: "api" | "page";
}

export interface DirectorySummary {
  path: string[];
  expected: number | null;
  found: number;
  success: number;
  failed: number;
  active: number;
  pending: number;
  status: "verified" | "unverified" | "failed";
  via: "api" | "page";
}

export const MAX_DIRECTORY_SUMMARIES = 200;

const ACTIVE_STATUSES = new Set(["preparing", "transferring", "paused"]);
const TERMINAL_STATUSES = new Set(["success", "failed", "cancelled"]);

const pathKey = (path: readonly string[]) => JSON.stringify(path);

export function summarizeDirectories(
  scans: DirectoryScanRecord[],
  items: Array<{ directoryPath?: string[]; selected?: boolean; status: string }>,
  scanFailures: Array<{ path: string[]; reason?: string }>,
): DirectorySummary[] {
  // count_unverified：目录已读完，只是页面不提供数量，不算读取失败。
  const failedKeys = new Set(
    scanFailures.filter((failure) => failure.reason !== "count_unverified").map((failure) => pathKey(failure.path || [])),
  );
  const counts = new Map<string, { success: number; failed: number; active: number; pending: number }>();
  for (const item of items) {
    if (!item.selected) continue;
    const key = pathKey(item.directoryPath || []);
    const entry = counts.get(key) || { success: 0, failed: 0, active: 0, pending: 0 };
    if (item.status === "success") entry.success += 1;
    else if (item.status === "failed") entry.failed += 1;
    else if (ACTIVE_STATUSES.has(item.status)) entry.active += 1;
    else if (!TERMINAL_STATUSES.has(item.status)) entry.pending += 1;
    counts.set(key, entry);
  }
  const summaries: DirectorySummary[] = scans.map((scan) => ({
    path: scan.path,
    expected: scan.expected,
    found: scan.found,
    ...(counts.get(pathKey(scan.path)) || { success: 0, failed: 0, active: 0, pending: 0 }),
    status: failedKeys.has(pathKey(scan.path)) ? "failed" : scan.verified ? "verified" : "unverified",
    via: scan.via === "api" ? "api" : "page",
  }));
  const scanned = new Set(scans.map((scan) => pathKey(scan.path)));
  const missing = scanFailures
    .filter((failure) => !scanned.has(pathKey(failure.path || [])))
    .map((failure): DirectorySummary => ({
      path: failure.path || [], expected: null, found: 0,
      success: 0, failed: 0, active: 0, pending: 0, status: "failed", via: "page",
    }));
  const rank = { failed: 0, unverified: 1, verified: 2 } as const;
  return [...missing, ...summaries]
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => rank[left.entry.status] - rank[right.entry.status] || left.index - right.index)
    .slice(0, MAX_DIRECTORY_SUMMARIES)
    .map(({ entry }) => entry);
}
