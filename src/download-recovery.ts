/**
 * [INPUT]: 接收后台已扫描文件、失败目录与原任务汇总。
 * [OUTPUT]: 导出失败定位与单项恢复汇总函数。
 * [POS]: 纯恢复规则；后台持久化结果，UI 只读取摘要。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { JobCounts } from "./ui-model";

export interface FailureEntry {
  id: string;
  kind: "file" | "directory";
  name: string;
  path: string[];
  stage?: string | undefined;
  error?: string | undefined;
  /** classifyRecoveryError 的枚举结果；旧任务没有此字段。 */
  reason?: string | undefined;
  retryKey?: string | undefined;
  url?: string | undefined;
  rootUrl?: string | undefined;
  route?: Array<{ name: string; itemIndex: string }> | undefined;
  knownCounts?: JobCounts | undefined;
}

export interface RecoveryJob {
  retrySelection?: FailureEntry;
  retainedFailures?: FailureEntry[];
  retainedCounts?: JobCounts;
}

export function classifyRecoveryError(error: unknown): string {
  const value = error as { message?: unknown; code?: unknown } | null;
  if (value?.code === "POPO_PERMISSION_DENIED") return "permission_denied";
  const message = String(value?.message || error || "");
  if (/未找到文件夹/.test(message)) return "folder_not_found";
  if (/没有进入目标文件夹/.test(message)) return "directory_navigation_timeout";
  if (/行已失效|点击前失效/.test(message)) return "stale_row";
  if (/未找到.*文件|没有取得.*地址/.test(message)) return "file_not_found";
  if (/timeout|超时/i.test(message)) return "timeout";
  if (/数量.*不一致/.test(message)) return "count_mismatch";
  return "operation_failed";
}

export function mergeRecoverySummary(
  job: RecoveryJob,
  counts: JobCounts,
  failures: FailureEntry[],
  items: Array<{ id: string; status: string }>,
) {
  if (!job.retrySelection) return { counts, failures };
  const merged: JobCounts = { ...counts };
  for (const field of ["files", "success", "failed", "scanFailures", "unverifiedDirectories", "verifiedDirectories"] as const) {
    merged[field] = (counts[field] || 0) + (job.retainedCounts?.[field] || 0);
  }
  const result = [...(job.retainedFailures || []), ...failures];
  const selected = job.retrySelection;
  if (selected.kind === "file" && !items.some((item) => encodeURIComponent(item.id) === selected.id)) {
    result.push({
      ...selected, stage: "定位文件", reason: "file_not_found",
      error: "原目录中未找到此文件，请核对文件是否已移动或删除"
    });
    merged.files = (merged.files || 0) + 1;
    merged.failed = (merged.failed || 0) + 1;
  }
  return { counts: merged, failures: result };
}

export function retainedRecoveryCounts(counts: JobCounts, selected: FailureEntry): JobCounts {
  const known = selected.kind === "file" ? { files: 1, success: 0, failed: 1 } : selected.knownCounts || {};
  return {
    files: Math.max(0, (counts.files || 0) - (known.files || 0)),
    success: Math.max(0, (counts.success || 0) - (known.success || 0)),
    failed: Math.max(0, (counts.failed || 0) - (known.failed || 0)),
    scanFailures: Math.max(0, (counts.scanFailures || 0) - (selected.kind === "directory" ? known.scanFailures || 1 : 0)),
    unverifiedDirectories: Math.max(0, (counts.unverifiedDirectories || 0) - (selected.kind === "directory" ? known.unverifiedDirectories || 1 : 0)),
    verifiedDirectories: counts.verifiedDirectories || 0,
  };
}

export function remainingFailures(entries: FailureEntry[], selected: FailureEntry): FailureEntry[] {
  return entries.filter((entry) => entry.id !== selected.id && !(selected.kind === "directory" &&
    selected.path.length > 0 && selected.path.every((part, index) => entry.path[index] === part)));
}

// 这些失败重试也不会成功：没有权限、文件在完整查找后仍不存在、页面不提供目录数量、后台页面已失联。
// 目录打开是不稳定环节（见 MAX_DIRECTORY_RESOLVE_RETRIES），folder_not_found 允许再补一轮。
const NOT_AUTO_RETRYABLE = new Set([
  "permission_denied", "file_not_found", "count_unverified", "worker_recovery_exhausted",
]);

export const MAX_FAILURE_ENTRIES = 200;

/** 任务里最多保存 200 条失败明细；超出部分只记数量，批量重试仍用 failureRetryKeys。 */
export function capFailureEntries(entries: FailureEntry[]): { entries: FailureEntry[]; omitted: number } {
  return {
    entries: entries.slice(0, MAX_FAILURE_ENTRIES),
    omitted: Math.max(0, entries.length - MAX_FAILURE_ENTRIES),
  };
}

export function isAutoRetryable(entry: FailureEntry): boolean {
  return !NOT_AUTO_RETRYABLE.has(entry.reason || "");
}

export const PREPARE_FAILURE_STREAK_LIMIT = 3;
export const PREPARE_COOLDOWN_MS = 30000;

/**
 * 连续准备失败计数。失败累计到上限时清零并要求冷却；成功清零；
 * 权限拒绝是确定性失败，既不计数也不清零。
 */
export function advancePrepareStreak(
  streak: number,
  outcome: "success" | "failure" | "permission_denied",
): { streak: number; cooldown: boolean } {
  if (outcome === "success") return { streak: 0, cooldown: false };
  if (outcome === "permission_denied") return { streak, cooldown: false };
  const next = streak + 1;
  return next >= PREPARE_FAILURE_STREAK_LIMIT
    ? { streak: 0, cooldown: true }
    : { streak: next, cooldown: false };
}
