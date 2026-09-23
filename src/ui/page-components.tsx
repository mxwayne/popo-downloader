import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import {
  Check,
  CircleX,
  Clock3,
  Download,
  FileQuestion,
  Folder,
  LoaderCircle,
  Pause,
  Play,
  Search,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  attentionJobs,
  failedRetryCount,
  findPageDownloadBatch,
  findMatchingFolderJob,
  findMatchingFolderReceipt,
  folderReceiptFeedbackRemaining,
  folderButtonDisplay,
  inferVirtualListItemCount,
  jobDetail,
  jobIsActive,
  jobIsTerminal,
  jobName,
  jobProgress,
  liveJobs,
  MODE_LABELS,
  networkHealthSummary,
  networkReminderVisible,
  nextNetworkNotice,
  nextServiceNotice,
  notificationForTransition,
  recoverableCount,
  summarizeLiveJobs,
  userFacingError,
  type QueueJob,
  type QueueState,
  type NetworkNoticeTracker,
  type ServiceNoticeTracker,
  type GopeedConnection,
  type UiNotification,
} from "../ui-model";

import { useUiActions } from "./actions";
export interface FolderItem {
  name: string;
  itemIndex: string;
  parentUrl: string;
}
export interface ToastRecord extends UiNotification {
  receivedAt: number;
  mergedCount: number;
}
const DOWNLOAD_BUTTON_CLASS = "popo-stable-download-button";
export function ProjectCount({ count }: { count: number | null }) {
  const loading = count == null;
  return (
    <span
      className="popo-react-project-count"
      data-state={loading ? "loading" : "ready"}
      title={
        loading
          ? "正在统计当前目录第一层项目数"
          : "当前目录第一层：" + count + " 个项目（文件 + 文件夹）"
      }
    >
      {loading ? "正在统计…" : count + " 个项目"}
    </span>
  );
}

export function PageDownloadButton({
  pageName,
  parentUrl,
  count,
  state,
  refresh,
  onError,
}: {
  pageName: string;
  parentUrl: string;
  count: number | null;
  state: QueueState | null;
  refresh: () => Promise<void>;
  onError: (title: string, error: unknown) => void;
}) {
  const { send: callExtension, ensureWorker } = useUiActions();
  const [starting, setStarting] = useState(false);
  const [batchBusy, setBatchBusy] = useState(false);
  const [confirmRemoving, setConfirmRemoving] = useState(false);
  const [outcome, setOutcome] = useState<{
    addedCount: number;
    duplicateCount: number;
    completedCount: number;
    folderCount: number;
    coveredByLegacyPageDownload: boolean;
  } | null>(null);
  const batch = useMemo(
    () => findPageDownloadBatch(state, parentUrl),
    [parentUrl, state],
  );
  const label = starting
    ? "正在核对…"
    : outcome?.addedCount
      ? `已排队 ${outcome.addedCount} 个`
      : outcome?.coveredByLegacyPageDownload
        ? "整页任务进行中"
        : outcome?.folderCount === 0
          ? "没有子文件夹"
          : outcome && outcome.completedCount === outcome.folderCount
            ? "均已下载"
            : outcome
              ? "文件夹均已入队"
              : "一键下载";

  useEffect(() => {
    if (!outcome) return;
    const timer = window.setTimeout(() => {
      setOutcome(null);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [outcome]);

  useEffect(() => {
    if (!confirmRemoving) return;
    const timer = window.setTimeout(() => setConfirmRemoving(false), 5000);
    return () => window.clearTimeout(timer);
  }, [confirmRemoving]);

  useEffect(() => {
    if (!batch) setConfirmRemoving(false);
  }, [batch]);

  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setStarting(true);
    setOutcome(null);
    try {
      const response = await callExtension<{
        needsWorker?: boolean;
        addedCount?: number;
        duplicateCount?: number;
        completedCount?: number;
        folderCount?: number;
        coveredByLegacyPageDownload?: boolean;
      }>({
        type: "START_PAGE_DOWNLOAD",
        pageName,
        parentUrl,
      });
      setOutcome({
        addedCount: response.addedCount || 0,
        duplicateCount: response.duplicateCount || 0,
        completedCount: response.completedCount || 0,
        folderCount: response.folderCount || 0,
        coveredByLegacyPageDownload: Boolean(
          response.coveredByLegacyPageDownload,
        ),
      });
      if (response.needsWorker) {
        ensureWorker(parentUrl);
      }
      await refresh();
    } catch (error) {
      onError("一键下载", error);
    } finally {
      setStarting(false);
    }
  };

  const handleBatchAction = async (
    event: React.MouseEvent<HTMLButtonElement>,
    type:
      | "PAUSE_DOWNLOAD_BATCH"
      | "RESUME_DOWNLOAD_BATCH"
      | "REMOVE_DOWNLOAD_BATCH",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (!batch) return;
    setBatchBusy(true);
    try {
      await callExtension({ type, batchId: batch.id });
      setConfirmRemoving(false);
      await refresh();
    } catch (error) {
      onError(
        type === "REMOVE_DOWNLOAD_BATCH" ? "移除一键下载" : "一键下载批次",
        error,
      );
    } finally {
      setBatchBusy(false);
    }
  };

  return (
    <span className="popo-page-download-controls">
      <button
        type="button"
        className="popo-page-download-all"
        data-state={
          starting ? "preparing" : outcome?.addedCount ? "queued" : "idle"
        }
        disabled={starting || batchBusy || count == null || count === 0}
        title={
          count == null
            ? "正在核对当前页面项目数"
            : count === 0
              ? "当前页面没有可下载项目"
              : `核对“${pageName}”的完整列表，把每个第一层文件夹按页面顺序分别加入下载队列`
        }
        aria-busy={starting || undefined}
        aria-live="polite"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => void handleClick(event)}
      >
        <Download aria-hidden="true" focusable="false" strokeWidth={1.8} />
        <span>{label}</span>
      </button>
      {batch && (
        <>
          <button
            type="button"
            className="popo-page-batch-action"
            disabled={batchBusy || starting}
            title={
              batch.paused ? "继续这次一键下载批次" : "暂停这次一键下载批次"
            }
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) =>
              void handleBatchAction(
                event,
                batch.paused ? "RESUME_DOWNLOAD_BATCH" : "PAUSE_DOWNLOAD_BATCH",
              )
            }
          >
            {batch.paused ? (
              <Play aria-hidden="true" focusable="false" strokeWidth={1.8} />
            ) : (
              <Pause aria-hidden="true" focusable="false" strokeWidth={1.8} />
            )}
            <span>{batch.paused ? "全部继续" : "全部暂停"}</span>
          </button>
          <button
            type="button"
            className="popo-page-batch-action"
            data-kind="danger"
            disabled={batchBusy || starting}
            title="移除这次一键下载批次；已交给 Gopeed 的文件不会删除"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              if (!confirmRemoving) {
                event.preventDefault();
                event.stopPropagation();
                setConfirmRemoving(true);
                return;
              }
              void handleBatchAction(event, "REMOVE_DOWNLOAD_BATCH");
            }}
          >
            <Trash2 aria-hidden="true" focusable="false" strokeWidth={1.8} />
            <span>{confirmRemoving ? "确认移除" : "全部移除"}</span>
          </button>
        </>
      )}
    </span>
  );
}

const FOLDER_STATE_ICONS: Partial<
  Record<ReturnType<typeof folderButtonDisplay>["visualState"], LucideIcon>
> = {
  queued: Clock3,
  preparing: LoaderCircle,
  scanning: Search,
  ready: Check,
  paused: Pause,
  success: Check,
  empty: FileQuestion,
  warning: TriangleAlert,
  failed: CircleX,
};

function FolderButtonStateIcon({
  visualState,
  reducedMotion,
}: {
  visualState: ReturnType<typeof folderButtonDisplay>["visualState"];
  reducedMotion: boolean | null;
}) {
  if (visualState === "downloading") {
    return (
      <span
        className="popo-download-state-icon popo-download-injection-icon"
        aria-hidden="true"
      >
        <Folder
          className="popo-download-folder-glyph"
          aria-hidden="true"
          focusable="false"
          strokeWidth={1.8}
        />
        <motion.i
          className="popo-download-resource-block"
          initial={
            reducedMotion
              ? false
              : { y: -1, opacity: 0, scale: 0.72, rotate: -8 }
          }
          animate={
            reducedMotion
              ? { y: 4, opacity: 0.82, scale: 0.9, rotate: 0 }
              : {
                  y: [-1, 2, 7, 10],
                  opacity: [0, 1, 1, 0],
                  scale: [0.72, 1, 0.94, 0.64],
                  rotate: [-8, 4, 0, 0],
                }
          }
          transition={
            reducedMotion
              ? { duration: 0 }
              : { duration: 0.9, ease: "easeIn" as const, repeat: Infinity }
          }
        />
      </span>
    );
  }

  const Icon = FOLDER_STATE_ICONS[visualState];
  if (!Icon) return null;

  const activeMotion = (() => {
    if (reducedMotion)
      return { initial: false, animate: {}, transition: { duration: 0 } };
    if (visualState === "scanning") {
      return {
        initial: { x: -1, y: 1, rotate: -8, scale: 0.86, opacity: 0.68 },
        animate: {
          x: [-1, 1, -1],
          y: [1, -2, 0, 1],
          rotate: [-8, 7, 1, -8],
          scale: [0.86, 1.13, 0.96, 0.86],
          opacity: [0.68, 1, 0.84, 0.68],
        },
        transition: {
          duration: 0.92,
          ease: "easeInOut" as const,
          repeat: Infinity,
        },
      };
    }
    if (visualState === "preparing") {
      return {
        initial: { rotate: 0 },
        animate: { rotate: [0, 360] },
        transition: {
          duration: 1.1,
          ease: "linear" as const,
          repeat: Infinity,
        },
      };
    }
    if (visualState === "queued") {
      return {
        initial: { scale: 0.9, opacity: 0.65 },
        animate: { scale: [0.9, 1.08, 0.9], opacity: [0.65, 1, 0.65] },
        transition: {
          duration: 1.4,
          ease: "easeInOut" as const,
          repeat: Infinity,
        },
      };
    }
    return { initial: false, animate: {}, transition: { duration: 0 } };
  })();

  return (
    <span className="popo-download-state-icon" aria-hidden="true">
      <motion.span
        className="popo-download-state-icon-motion"
        initial={activeMotion.initial}
        animate={activeMotion.animate}
        transition={activeMotion.transition}
      >
        <Icon aria-hidden="true" focusable="false" strokeWidth={1.8} />
      </motion.span>
    </span>
  );
}

function FolderWorkBeat({
  active,
  reducedMotion,
}: {
  active: boolean;
  reducedMotion: boolean | null;
}) {
  if (!active) return null;
  return (
    <span className="popo-download-work-beat" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <motion.i
          key={index}
          initial={reducedMotion ? false : { scaleY: 0.45, opacity: 0.48 }}
          animate={
            reducedMotion
              ? { scaleY: 1, opacity: 0.75 }
              : { scaleY: [0.45, 1.2, 0.55], opacity: [0.48, 1, 0.58] }
          }
          transition={
            reducedMotion
              ? { duration: 0 }
              : {
                  duration: 0.72,
                  delay: index * -0.24,
                  ease: "easeInOut",
                  repeat: Infinity,
                }
          }
        />
      ))}
    </span>
  );
}

const OPTIMISTIC_SCAN_START = 12;
const OPTIMISTIC_SCAN_LIMIT = 89;
const OPTIMISTIC_SCAN_TIME_CONSTANT_MS = 10_700;

function optimisticScanProgressAt(
  startedAt: string | undefined,
  now = Date.now(),
): number {
  const parsedStartedAt = Date.parse(String(startedAt || ""));
  const elapsed = Number.isFinite(parsedStartedAt)
    ? Math.max(0, now - parsedStartedAt)
    : 0;
  const progress =
    OPTIMISTIC_SCAN_LIMIT -
    (OPTIMISTIC_SCAN_LIMIT - OPTIMISTIC_SCAN_START) *
      Math.exp(-elapsed / OPTIMISTIC_SCAN_TIME_CONSTANT_MS);
  return Math.min(
    OPTIMISTIC_SCAN_LIMIT,
    Math.max(OPTIMISTIC_SCAN_START, progress),
  );
}

function useOptimisticScanProgress(
  active: boolean,
  reducedMotion: boolean | null,
  startedAt: string | undefined,
): number {
  const fallbackStartedAt = useRef(Date.now());
  const wasActive = useRef(active);
  const [progress, setProgress] = useState(
    active ? optimisticScanProgressAt(startedAt) : 0,
  );
  useEffect(() => {
    if (!active) {
      wasActive.current = false;
      fallbackStartedAt.current = Date.now();
      setProgress(0);
      return;
    }
    const parsedStartedAt = Date.parse(String(startedAt || ""));
    if (!Number.isFinite(parsedStartedAt) && !wasActive.current) {
      fallbackStartedAt.current = Date.now();
    }
    wasActive.current = true;
    const progressStartedAt = Number.isFinite(parsedStartedAt)
      ? startedAt
      : new Date(fallbackStartedAt.current).toISOString();
    if (reducedMotion) {
      setProgress(optimisticScanProgressAt(progressStartedAt));
      return;
    }
    const update = () =>
      setProgress(optimisticScanProgressAt(progressStartedAt));
    update();
    const timer = window.setInterval(update, 120);
    return () => window.clearInterval(timer);
  }, [active, reducedMotion, startedAt]);
  return progress;
}

function FolderProgressFill({
  className,
  progress,
  reducedMotion,
  transitionMs,
}: {
  className: string;
  progress: number;
  reducedMotion: boolean | null;
  transitionMs: number;
}) {
  const [transitionEnabled, setTransitionEnabled] = useState(false);
  useLayoutEffect(() => {
    if (reducedMotion) return;
    const frame = window.requestAnimationFrame(() =>
      setTransitionEnabled(true),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [reducedMotion]);
  return (
    <span
      className={className}
      style={{
        width: `${progress}%`,
        transition:
          transitionEnabled && !reducedMotion
            ? `width ${transitionMs}ms cubic-bezier(.22,.78,.24,1)`
            : "none",
      }}
    />
  );
}

function FolderButtonRail({
  display,
  reducedMotion,
  motionKey,
  scanStartedAt,
}: {
  display: ReturnType<typeof folderButtonDisplay>;
  reducedMotion: boolean | null;
  motionKey: string;
  scanStartedAt: string | undefined;
}) {
  const scanning = display.visualState === "scanning";
  const downloading = display.visualState === "downloading";
  const working = scanning || downloading;
  const estimatedProgress = useOptimisticScanProgress(
    scanning,
    reducedMotion,
    scanStartedAt,
  );
  const visible = display.indeterminate || display.progress != null;
  return (
    <AnimatePresence>
      {visible && (
        <motion.span
          key={display.indeterminate ? "indeterminate" : "determinate"}
          className="popo-download-rail"
          aria-hidden="true"
          initial={false}
          animate={{ opacity: 1 }}
          exit={{ opacity: reducedMotion ? 1 : 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.16 }}
        >
          {scanning ? (
            <FolderProgressFill
              key={`estimate:${motionKey}`}
              className="popo-download-estimate-fill"
              progress={estimatedProgress}
              reducedMotion={reducedMotion}
              transitionMs={180}
            />
          ) : display.indeterminate && !downloading ? (
            <motion.span
              key={`wave:${motionKey}`}
              className="popo-download-wave"
              initial={reducedMotion ? false : { x: "-120%" }}
              animate={reducedMotion ? { x: "70%" } : { x: ["-120%", "260%"] }}
              transition={
                reducedMotion
                  ? { duration: 0 }
                  : { duration: 1.15, ease: "easeInOut", repeat: Infinity }
              }
            />
          ) : display.progress != null ? (
            <FolderProgressFill
              key={`fill:${motionKey}`}
              className="popo-download-fill"
              progress={display.progress || 0}
              reducedMotion={reducedMotion}
              transitionMs={240}
            />
          ) : null}
          {working && (
            <>
              <motion.span
                key={`comet:${motionKey}`}
                className="popo-download-activity-comet"
                initial={
                  reducedMotion
                    ? false
                    : { left: "-30%", opacity: 0, scaleX: 0.55 }
                }
                animate={
                  reducedMotion
                    ? { left: "72%", opacity: 0.7, scaleX: 1 }
                    : {
                        left: ["-30%", "70%", "74%", "108%"],
                        opacity: [0, 1, 0.72, 0],
                        scaleX: [0.55, 1.22, 0.7, 1],
                      }
                }
                transition={
                  reducedMotion
                    ? { duration: 0 }
                    : { duration: 1.22, ease: "easeInOut", repeat: Infinity }
                }
              />
              {[0, 1, 2].map((index) => (
                <motion.i
                  key={`${motionKey}:packet:${index}`}
                  className="popo-download-activity-packet"
                  initial={
                    reducedMotion
                      ? false
                      : { left: "-6%", y: 0, opacity: 0, scale: 0.55 }
                  }
                  animate={
                    reducedMotion
                      ? { left: `${32 + index * 18}%`, opacity: 0.72, scale: 1 }
                      : {
                          left: ["-6%", "38%", "43%", "103%"],
                          y: [0, -1, 1, 0],
                          opacity: [0, 1, 0.75, 0],
                          scale: [0.55, 1.3, 0.7, 1.05],
                        }
                  }
                  transition={
                    reducedMotion
                      ? { duration: 0 }
                      : {
                          duration: 1.88,
                          delay: index * -0.62,
                          ease: "easeInOut",
                          repeat: Infinity,
                        }
                  }
                />
              ))}
            </>
          )}
          {display.warningSegment && (
            <motion.span
              className="popo-download-warning-segment"
              initial={reducedMotion ? false : { opacity: 0, scaleX: 0 }}
              animate={{ opacity: 1, scaleX: 1 }}
              transition={{ duration: reducedMotion ? 0 : 0.18 }}
            />
          )}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

export function FolderDownloadButton({
  item,
  state,
  refresh,
  onInspect,
  onError,
}: {
  item: FolderItem;
  state: QueueState | null;
  refresh: () => Promise<void>;
  onInspect: (jobId: string) => void;
  onError: (title: string, error: unknown) => void;
}) {
  const { send: callExtension, ensureWorker } = useUiActions();
  const [starting, setStarting] = useState(false);
  const [outcome, setOutcome] = useState<QueueJob | null>(null);
  const [receiptClock, setReceiptClock] = useState(() => Date.now());
  const lastActiveJob = useRef<QueueJob | null>(null);
  const reducedMotion = useReducedMotion();
  const activeJob = findMatchingFolderJob(state, item);
  const receipt = findMatchingFolderReceipt(state, item);
  const receiptFeedbackRemaining = folderReceiptFeedbackRemaining(
    receipt,
    receiptClock,
  );
  const receiptFeedbackVisible = receiptFeedbackRemaining > 0;
  const receiptJob = useMemo<QueueJob | null>(
    () =>
      receipt
        ? {
            id: `receipt:${receipt.key}`,
            key: receipt.key,
            status: "complete",
            folderName: receipt.folderName,
            folderItemIndex: receipt.folderItemIndex,
            parentUrl: receipt.parentUrl,
            completedAt: receipt.completedAt,
            counts: receipt.counts,
            verifiedCompletion: true,
          }
        : null,
    [receipt],
  );
  const transitionOutcome =
    !activeJob && lastActiveJob.current
      ? (state?.jobs || []).find(
          (candidate) =>
            candidate.id === lastActiveJob.current?.id &&
            jobIsTerminal(candidate),
        ) || null
      : null;
  const visibleJob =
    activeJob ||
    transitionOutcome ||
    outcome ||
    (receiptFeedbackVisible ? receiptJob : null);
  const display = folderButtonDisplay(visibleJob, starting);
  const motionKey = `${visibleJob?.id || "transient"}:${display.visualState}`;
  const terminalJob =
    visibleJob && jobIsTerminal(visibleJob) ? visibleJob : null;
  const statusText = [display.primary, display.secondary]
    .filter(Boolean)
    .join("，");
  const title = starting
    ? "正在添加下载"
    : activeJob
      ? `${statusText || "任务进行中"}，点击查看任务`
      : receiptJob && visibleJob === receiptJob
        ? "已成功下载，数量一致且无遗漏；2 分钟后可重新查重"
        : terminalJob
          ? `${statusText}，点击${
              terminalJob.status === "cancelled" &&
              recoverableCount(terminalJob) > 0
                ? "继续"
                : terminalJob.status === "complete" &&
                    display.visualState === "success"
                  ? "重新查找"
                  : "重试"
            }`
          : receipt
            ? "已下载过；点击重新查重，已有文件会跳过，缺少文件会下载"
            : "稳定下载此文件夹";

  useEffect(() => {
    const now = Date.now();
    setReceiptClock(now);
    const remaining = folderReceiptFeedbackRemaining(receipt, now);
    if (remaining <= 0) return;
    const timer = window.setTimeout(
      () => setReceiptClock(Date.now()),
      remaining + 20,
    );
    return () => window.clearTimeout(timer);
  }, [receipt?.completedAt, receipt?.key]);

  useEffect(() => {
    if (activeJob) {
      lastActiveJob.current = activeJob;
      setOutcome(null);
      return;
    }
    const previous = lastActiveJob.current;
    if (!previous) return;
    const terminal = (state?.jobs || []).find(
      (candidate) => candidate.id === previous.id && jobIsTerminal(candidate),
    );
    if (!terminal) return;
    lastActiveJob.current = null;
    setOutcome(terminal);
  }, [activeJob, state?.jobs]);

  useEffect(() => {
    if (!outcome) return;
    const outcomeId = outcome.id;
    const timer = window.setTimeout(() => {
      setOutcome((current) => (current?.id === outcomeId ? null : current));
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [outcome?.completedAt, outcome?.id]);

  const requestFolderScan = async () => {
    const response = await callExtension<{
      needsWorker?: boolean;
      job?: QueueJob;
      coveredByPageDownload?: boolean;
      alreadyCompleted?: boolean;
    }>({
      type: "START_FOLDER_SCAN",
      folderName: item.name,
      folderItemIndex: item.itemIndex,
      parentUrl: item.parentUrl,
    });
    if (response.needsWorker) {
      ensureWorker(item.parentUrl);
    }
    return response;
  };

  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (activeJob) {
      onInspect(activeJob.id);
      return;
    }
    setOutcome(null);
    lastActiveJob.current = null;
    setStarting(true);
    try {
      if (
        terminalJob?.status === "failed" &&
        terminalJob.failureRetryKeys?.length
      ) {
        await callExtension({ type: "RETRY_JOB", jobId: terminalJob.id });
      } else if (
        terminalJob?.status === "cancelled" &&
        recoverableCount(terminalJob) > 0
      ) {
        await callExtension({
          type: "RESTORE_CANCELLED_JOB",
          jobId: terminalJob.id,
        });
      } else {
        const response = await requestFolderScan();
        if (response.coveredByPageDownload && response.job) {
          onInspect(response.job.id);
        }
      }
      await refresh();
    } catch (error) {
      if (terminalJob) setOutcome(terminalJob);
      onError(item.name, error);
    } finally {
      setStarting(false);
    }
  };

  const showDownloadedMarker =
    Boolean(receipt) &&
    !receiptFeedbackVisible &&
    !activeJob &&
    !transitionOutcome &&
    !outcome &&
    !starting;

  return (
    <>
      <motion.button
        layout
        initial={false}
        transition={
          reducedMotion
            ? { duration: 0 }
            : { layout: { type: "spring", stiffness: 420, damping: 34 } }
        }
        whileTap={reducedMotion ? {} : { scale: 0.97 }}
        type="button"
        className={DOWNLOAD_BUTTON_CLASS}
        data-popo-react-owned="true"
        data-state={display.visualState}
        data-expanded={display.visualState === "idle" ? "false" : "true"}
        data-job-status={visibleJob?.status || ""}
        data-job-id={visibleJob?.id || ""}
        data-folder-name={item.name}
        disabled={starting}
        title={title}
        aria-label={`${item.name}：${title}`}
        aria-busy={
          ["preparing", "scanning", "downloading"].includes(
            display.visualState,
          ) || undefined
        }
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => void handleClick(event)}
      >
        {display.visualState === "idle" && (
          <motion.span
            className="popo-download-idle-icon"
            aria-hidden="true"
            initial={false}
            whileHover={reducedMotion ? {} : { y: 1, scale: 1.08 }}
          >
            <Download aria-hidden="true" focusable="false" strokeWidth={1.8} />
          </motion.span>
        )}
        <AnimatePresence mode="popLayout">
          {display.primary && (
            <motion.span
              key={`${visibleJob?.id || "transient"}:${display.visualState}:${visibleJob?.status || "starting"}`}
              className="popo-download-content"
              initial={reducedMotion ? false : { opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{
                opacity: reducedMotion ? 1 : 0,
                y: reducedMotion ? 0 : -3,
              }}
              transition={{ duration: reducedMotion ? 0 : 0.16 }}
            >
              <FolderButtonStateIcon
                visualState={display.visualState}
                reducedMotion={reducedMotion}
              />
              <span className="popo-download-primary">{display.primary}</span>
              <FolderWorkBeat
                active={["scanning", "downloading"].includes(
                  display.visualState,
                )}
                reducedMotion={reducedMotion}
              />
              {display.secondary && (
                <span className="popo-download-secondary">
                  {display.secondary}
                </span>
              )}
            </motion.span>
          )}
        </AnimatePresence>
        <FolderButtonRail
          display={display}
          reducedMotion={reducedMotion}
          motionKey={motionKey}
          scanStartedAt={visibleJob?.startedAt}
        />
      </motion.button>
      <AnimatePresence>
        {showDownloadedMarker && (
          <motion.span
            className="popo-download-complete-marker"
            data-popo-downloaded-marker="true"
            role="img"
            aria-label={`${item.name}：已下载过`}
            title="已下载过；点击左侧下载按钮重新查重"
            initial={reducedMotion ? false : { opacity: 0, scale: 0.72 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{
              opacity: reducedMotion ? 1 : 0,
              scale: reducedMotion ? 1 : 0.72,
            }}
            transition={{ duration: reducedMotion ? 0 : 0.18 }}
          >
            <Check aria-hidden="true" focusable="false" strokeWidth={2.2} />
          </motion.span>
        )}
      </AnimatePresence>
    </>
  );
}

export function ProgressBar({ job }: { job: QueueJob }) {
  const percent = jobProgress(job);
  return (
    <div
      className="popo-page-progress"
      data-indeterminate={percent == null ? "true" : undefined}
      role="progressbar"
      aria-label={jobName(job) + " 下载进度"}
      aria-valuemin={percent == null ? undefined : 0}
      aria-valuemax={percent == null ? undefined : 100}
      aria-valuenow={percent == null ? undefined : percent}
    >
      <i style={percent == null ? undefined : { width: percent + "%" }} />
    </div>
  );
}

export function QueueDock({
  state,
  expanded,
  focusedJobId,
  onExpandedChange,
  onAction,
  onError,
}: {
  state: QueueState | null;
  expanded: boolean;
  focusedJobId: string | null;
  onExpandedChange: (expanded: boolean) => void;
  onAction: () => Promise<void>;
  onError: (title: string, error: unknown) => void;
}) {
  const { send: callExtension, ensureWorker } = useUiActions();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const active = liveJobs(state);
  const attention = attentionJobs(state);
  const candidates = [...active, ...attention];
  const primary =
    candidates.find((job) => job.id === focusedJobId) ||
    candidates.find((job) => job.id === state?.activeJobId) ||
    candidates[0] ||
    null;
  if (!primary) return null;
  const otherQueuedCount = active.filter(
    (job) => job.status === "queued" && job.id !== primary.id,
  ).length;
  const networkVisible =
    networkReminderVisible(state?.networkHealth) &&
    state?.networkHealth?.jobId === primary.id;

  const baseSummary = active.length
    ? summarizeLiveJobs(active)
    : attention.length + " 个需要处理";
  const summary = networkVisible ? `${baseSummary} · 网络慢` : baseSummary;

  const run = async (message: Record<string, unknown>) => {
    setBusy(true);
    try {
      await callExtension(message);
      setConfirming(false);
      await onAction();
    } catch (error) {
      onError(jobName(primary), error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside
      className="popo-page-queue"
      data-collapsed={expanded ? "false" : "true"}
      data-status={primary.status}
      aria-label="POPO 下载任务"
    >
      <div className="popo-page-queue-header">
        <div className="popo-page-queue-heading">
          POPO 下载 <span className="popo-page-queue-summary">· {summary}</span>
        </div>
        <button
          type="button"
          className="popo-page-queue-toggle"
          aria-expanded={expanded}
          onClick={() => onExpandedChange(!expanded)}
        >
          {expanded ? "收起" : "展开"}
        </button>
      </div>
      {expanded && (
        <div className="popo-page-queue-body">
          <div className="popo-page-title-row">
            <strong className="popo-page-job-name" title={jobName(primary)}>
              {jobName(primary)}
            </strong>
            <span className="popo-page-job-state">
              {MODE_LABELS[primary.status]}
            </span>
          </div>
          <div className="popo-page-job-detail">{jobDetail(primary)}</div>
          {networkVisible && (
            <div className="popo-network-notice" role="status">
              <strong>本地线路可能拥堵</strong>
              <span>
                {networkHealthSummary(state?.networkHealth)}
                。下载仍在继续，与代理设置无关。
              </span>
              <div className="popo-page-actions">
                <button
                  type="button"
                  className="popo-page-action"
                  disabled={busy}
                  onClick={() => void run({ type: "SNOOZE_NETWORK_REMINDER" })}
                >
                  15 分钟后提醒
                </button>
                <button
                  type="button"
                  className="popo-page-action"
                  disabled={busy}
                  onClick={() =>
                    void run({ type: "MUTE_NETWORK_REMINDER_TODAY" })
                  }
                >
                  今日不再提醒
                </button>
              </div>
            </div>
          )}
          {primary.status !== "queued" && <ProgressBar job={primary} />}
          {otherQueuedCount > 0 && (
            <div className="popo-page-queue-more">
              另有 {otherQueuedCount} 个排队
            </div>
          )}
          {!confirming ? (
            <div className="popo-page-actions">
              {primary.id === state?.activeJobId &&
                primary.status === "downloading" && (
                  <button
                    type="button"
                    className="popo-page-action"
                    disabled={busy}
                    onClick={() => void run({ type: "PAUSE" })}
                  >
                    暂停
                  </button>
                )}
              {primary.id === state?.activeJobId &&
                ["paused", "draining_paused"].includes(primary.status) && (
                  <button
                    type="button"
                    className="popo-page-action"
                    disabled={busy}
                    onClick={() => void run({ type: "RESUME" })}
                  >
                    继续
                  </button>
                )}
              {jobIsActive(primary) && !primary.cancelRequested && (
                <button
                  type="button"
                  className="popo-page-action"
                  data-kind="danger"
                  disabled={busy}
                  onClick={() =>
                    void run({ type: "CANCEL_JOB", jobId: primary.id })
                  }
                >
                  停止后续下载
                </button>
              )}
              {primary.status === "cancelled" &&
                recoverableCount(primary) > 0 && (
                  <button
                    type="button"
                    className="popo-page-action"
                    disabled={busy}
                    onClick={() =>
                      void run({
                        type: "RESTORE_CANCELLED_JOB",
                        jobId: primary.id,
                      })
                    }
                  >
                    继续（{recoverableCount(primary)}）
                  </button>
                )}
              {primary.status === "failed" && failedRetryCount(primary) > 0 && (
                <button
                  type="button"
                  className="popo-page-action"
                  disabled={busy}
                  onClick={() =>
                    void run({ type: "RETRY_JOB", jobId: primary.id })
                  }
                >
                  重试（{failedRetryCount(primary)}）
                </button>
              )}
              {!jobIsActive(primary) && (
                <button
                  type="button"
                  className="popo-page-action"
                  disabled={busy}
                  onClick={() => setConfirming(true)}
                >
                  移除
                </button>
              )}
            </div>
          ) : (
            <div
              className="popo-page-confirm"
              role="group"
              aria-label="确认移除任务"
            >
              <p>只从列表移除，不会删除已下载文件。</p>
              <div className="popo-page-actions">
                <button
                  type="button"
                  className="popo-page-action"
                  data-kind="danger"
                  disabled={busy}
                  onClick={() =>
                    void run({ type: "DISMISS_JOB", jobId: primary.id })
                  }
                >
                  确认移除
                </button>
                <button
                  type="button"
                  className="popo-page-action"
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  返回
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}

export function ToastItem({
  toast,
  onDismiss,
  onInspect,
  onNetworkSnooze,
}: {
  toast: ToastRecord;
  onDismiss: (id: string) => void;
  onInspect: (jobId: string) => void;
  onNetworkSnooze: () => Promise<void>;
}) {
  useEffect(() => {
    if (toast.timeoutMs == null) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.timeoutMs);
    return () => window.clearTimeout(timer);
  }, [onDismiss, toast.id, toast.timeoutMs]);

  return (
    <aside className="popo-toast" data-kind={toast.kind} role="status">
      <strong>{toast.title}</strong>
      <p>{toast.message}</p>
      <div className="popo-toast-actions">
        {toast.source === "network" && (
          <button
            type="button"
            className="popo-toast-action"
            onClick={() => {
              void onNetworkSnooze()
                .then(() => onDismiss(toast.id))
                .catch(() => undefined);
            }}
          >
            15 分钟后提醒
          </button>
        )}
        {toast.kind === "error" && toast.jobId && (
          <button
            type="button"
            className="popo-toast-action"
            onClick={() => {
              onInspect(toast.jobId);
              onDismiss(toast.id);
            }}
          >
            查看任务
          </button>
        )}
        <button
          type="button"
          className="popo-toast-action"
          data-kind="quiet"
          onClick={() => onDismiss(toast.id)}
          aria-label={
            toast.source === "network" ? "继续下载并关闭提示" : "关闭提示"
          }
        >
          {toast.source === "network" ? "继续下载" : "关闭"}
        </button>
      </div>
    </aside>
  );
}

export function ToastViewport({
  toasts,
  onDismiss,
  onInspect,
  onNetworkSnooze,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: string) => void;
  onInspect: (jobId: string) => void;
  onNetworkSnooze: () => Promise<void>;
}) {
  if (!toasts.length) return null;
  return (
    <div className="popo-toast-viewport" aria-label="POPO 下载通知">
      {toasts.map((toast) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          onDismiss={onDismiss}
          onInspect={onInspect}
          onNetworkSnooze={onNetworkSnooze}
        />
      ))}
    </div>
  );
}
