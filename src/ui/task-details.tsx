/**
 * [INPUT]: 依赖 ui-model 的 QueueJob 类型与 directoryProgressLabel。
 * [OUTPUT]: 导出 TaskDetails、FailureList、DirectoryList 与 JobTiming 组件。
 * [POS]: 弹窗任务卡与页面左下角面板共用的目录进度和失败明细；不发命令，只通过 onRetry 回调交给调用方。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { useEffect, useState } from "react";
import type { DirectorySummary } from "../directory-summary";
import { directoryProgressLabel, jobTimingLabel, type QueueJob } from "../ui-model";

export function DirectoryList({ directories }: { directories: DirectorySummary[] }) {
  const hasProblem = directories.some((entry) => entry.status !== "verified");
  return (
    <details className="popo-detail-directories" open={hasProblem}>
      <summary>目录进度（{directories.length}）</summary>
      <ul>
        {directories.map((entry) => (
          <li
            key={entry.path.join("\u0000")}
            className="popo-detail-directory"
            data-status={entry.status}
            title={entry.path.join(" / ")}
          >
            {directoryProgressLabel(entry)}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function FailureList({
  job,
  busy,
  onRetry,
}: {
  job: QueueJob;
  busy: boolean;
  onRetry: (failureId: string) => void;
}) {
  const entries = job.failureEntries || [];
  return (
    <details className="popo-detail-failures">
      <summary>失败明细（{entries.length}）</summary>
      <ul>
        {entries.map((entry) => (
          <li key={entry.id} className="popo-detail-failure">
            <div className="popo-detail-name">
              <span>{entry.kind === "directory" ? "目录" : "文件"}</span>
              <strong>{entry.name}</strong>
            </div>
            <div className="popo-detail-path" title={entry.path.join(" / ")}>
              {entry.path.join(" / ")}
            </div>
            <p>
              {entry.stage}
              {entry.stage && entry.error ? "：" : ""}
              {entry.error || "未完成"}
            </p>
            <button
              type="button"
              className="popo-detail-retry"
              disabled={busy || !entry.url || !Array.isArray(entry.route)}
              aria-label={`单独重试 ${entry.name}`}
              onClick={() => onRetry(entry.id)}
            >
              单独重试
            </button>
          </li>
        ))}
      </ul>
      {Boolean(job.failureEntriesOmitted) && (
        <p className="popo-detail-omitted">
          另有 {job.failureEntriesOmitted} 项未列出，可用任务的“重试”一并补下。
        </p>
      )}
    </details>
  );
}

export function TaskDetails({
  job,
  busy,
  onRetry,
}: {
  job: QueueJob;
  busy: boolean;
  onRetry: (failureId: string) => void;
}) {
  const showDirectories = Boolean(job.directories?.length);
  const showFailures = job.status === "failed" && Boolean(job.failureEntries?.length);
  if (!showDirectories && !showFailures) return null;
  return (
    <div className="popo-detail">
      {showDirectories && <DirectoryList directories={job.directories!} />}
      {showFailures && <FailureList job={job} busy={busy} onRetry={onRetry} />}
    </div>
  );
}

/** 扫描与下载分开计时；任务进行中每秒刷新一次已用时间。 */
export function JobTiming({ job }: { job: QueueJob }) {
  const [now, setNow] = useState(() => Date.now());
  const running = job.status === "scanning" || job.status === "downloading" || job.status === "waiting_worker";
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const label = jobTimingLabel(job, now);
  return label ? <div className="popo-detail-timing">{label}</div> : null;
}
