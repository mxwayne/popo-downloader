import { useCallback, useEffect, useRef, useState } from "react";
import { createNetworkHealth } from "../network-monitor";
import {
  jobIsActive,
  type QueueJob,
  type QueueState,
  type JobStatus,
  type GopeedSettings,
  type GopeedConnection,
} from "../ui-model";
import type { UiActions } from "../ui/actions";
import type { ToastRecord } from "../ui/page-components";

export const demoUrl =
  "https://docs.popo.netease.com/team/pc/demo/pageDetail/design";
export const folders = ["角色动作素材", "场景与环境贴图", "界面音效与配乐"];
export function makeJob(
  index = 0,
  status: JobStatus = "downloading",
  long = false,
): QueueJob {
  return {
    id: `demo-${index}`,
    key: `demo-${index}`,
    folderName: long
      ? "九月版本交付_角色动作素材_最终审核通过_包含中英文命名与全部源文件_请保留目录结构"
      : folders[index] || folders[0],
    folderItemIndex: String(index),
    parentUrl: demoUrl,
    scope: "folder",
    status,
    queuePosition: index + 1,
    startedAt: new Date().toISOString(),
    counts: {
      files: 24,
      total: 24,
      discoveredFiles: 24,
      folders: 3,
      success: status === "complete" ? 24 : status === "failed" ? 21 : 8,
      failed: status === "failed" ? 3 : 0,
      cancelled: status === "cancelled" ? 16 : 0,
    },
    failureRetryKeys: status === "failed" ? ["a", "b", "c"] : [],
    verifiedCompletion: status === "complete",
  };
}
export const scenarioNames = {
  default: "默认",
  loading: "加载",
  empty: "空内容",
  failed: "失败",
  disabled: "禁用",
  long: "长内容",
  paused: "暂停",
  complete: "完成",
  cancelled: "停止",
} as const;
export type Scenario = keyof typeof scenarioNames;

/** In-memory only. No extension runtime, storage, network, file picker or clipboard access. */
export function useDemo(initial: Scenario = "empty") {
  const [state, setState] = useState<QueueState>({ jobs: [] });
  const stateRef = useRef(state);
  const [settings, setSettings] = useState<GopeedSettings>({ concurrency: 5 });
  const settingsRef = useRef(settings);
  const [connection, setConnection] = useState<GopeedConnection | null>({
    connected: true,
  });
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const [error, setError] = useState("");
  const [log, setLog] = useState("示例数据已就绪。操作仅影响本页。");
  const [playing, setPlaying] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const generation = useRef(0);
  const transitionTimer = useRef<number | undefined>(undefined);
  const update = useCallback((next: QueueState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  const saveSettings = useCallback((next: GopeedSettings) => {
    settingsRef.current = next;
    setSettings(next);
  }, []);
  const notify = useCallback(
    (kind: "success" | "error" | "warning", title: string, message: string) => {
      setToasts([
        {
          id: `demo-notice-${Date.now()}`,
          jobId: "demo-0",
          kind,
          title,
          message,
          timeoutMs: null,
          receivedAt: Date.now(),
          mergedCount: 1,
        },
      ]);
    },
    [],
  );
  const reset = useCallback(
    (scenario: Scenario = "empty") => {
      window.clearTimeout(transitionTimer.current);
      generation.current++;
      setEpoch(generation.current);
      setPlaying(false);
      setError("");
      setToasts([]);
      const status: JobStatus =
        scenario === "loading"
          ? "scanning"
          : scenario === "failed"
            ? "failed"
            : scenario === "paused"
              ? "paused"
              : scenario === "complete"
                ? "complete"
                : scenario === "cancelled"
                  ? "cancelled"
                  : "downloading";
      const job = makeJob(0, status, scenario === "long");
      const finalState: QueueState = {
        jobs: scenario === "empty" ? [] : [job],
        activeJobId: jobIsActive(job) ? job.id : null,
      };
      if (["complete", "failed", "cancelled"].includes(status)) {
        // Replay the same active -> terminal transition the real folder button observes.
        update({
          jobs: [{ ...job, status: "downloading" }],
          activeJobId: job.id,
        });
        const ticket = generation.current;
        transitionTimer.current = window.setTimeout(() => {
          if (ticket === generation.current) update(finalState);
        }, 150);
      } else update(finalState);
      saveSettings({
        concurrency: 5,
        gopeedDownloadDirOverride:
          scenario === "long"
            ? "D:\\项目素材\\九月版本交付\\角色动作素材\\最终审核通过\\完整源文件\\POPO稳定下载"
            : "",
      });
      setConnection(
        scenario === "loading" ? null : { connected: scenario !== "failed" },
      );
      if (["failed", "complete", "long"].includes(scenario))
        setToasts([
          {
            id: "preset",
            jobId: job.id,
            kind: scenario === "failed" ? "error" : "success",
            title:
              scenario === "long"
                ? job.folderName || "完成"
                : scenario === "failed"
                  ? "部分文件未完成"
                  : "下载已完成",
            message:
              scenario === "failed"
                ? "3 个文件未完成，可在任务卡重试。此结果为模拟。"
                : "24 个文件已完成。此结果为模拟。",
            timeoutMs: null,
            receivedAt: Date.now(),
            mergedCount: 1,
          },
        ]);
      setLog(`已重置为「${scenarioNames[scenario]}」。这是本地模拟。`);
    },
    [saveSettings, update],
  );
  useEffect(() => {
    reset(initial);
    return () => {
      generation.current++;
      window.clearTimeout(transitionTimer.current);
    };
  }, [initial, reset]);

  const advance = useCallback(() => {
    const current = stateRef.current;
    const jobs = [...(current.jobs || [])];
    let index = jobs.findIndex(
      (j) => j.id === current.activeJobId && jobIsActive(j),
    );
    if (index < 0) index = jobs.findIndex((j) => j.status === "queued");
    if (index < 0) {
      setPlaying(false);
      return;
    }
    const job = { ...jobs[index]! };
    if (["paused", "draining_paused"].includes(job.status) || job.batchPaused)
      return;
    if (job.status === "queued") job.status = "scanning";
    else if (job.status === "scanning") job.status = "downloading";
    else {
      const success = Math.min(24, Number(job.counts?.success || 0) + 8);
      job.counts = { ...job.counts, success, failed: 0 };
      if (success === 24) {
        job.status = "complete";
        job.verifiedCompletion = true;
        job.completedAt = new Date().toISOString();
        notify(
          "success",
          `${job.folderName} · 已完成`,
          "24 个文件已完成。此结果为模拟数据。",
        );
      }
    }
    jobs[index] = job;
    update({
      ...current,
      jobs,
      activeJobId: jobIsActive(job)
        ? job.id
        : jobs.find((j) => j.status === "queued")?.id || null,
    });
  }, [notify, update]);
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(advance, 1800);
    return () => window.clearInterval(timer);
  }, [advance, playing]);

  const actions: UiActions = {
    async send<T extends object>(message: Record<string, unknown>): Promise<T> {
      const ticket = generation.current;
      await new Promise((resolve) => window.setTimeout(resolve, 320));
      if (ticket !== generation.current) throw new Error("示例已重置");
      const current = stateRef.current;
      let jobs = [...(current.jobs || [])];
      const type = String(message.type);
      let result: object = {};
      if (type === "START_FOLDER_SCAN" || type === "START_PAGE_DOWNLOAD") {
        const indices =
          type === "START_PAGE_DOWNLOAD"
            ? [0, 1, 2]
            : [Number(message.folderItemIndex) || 0];
        let addedCount = 0;
        for (const i of indices) {
          if (jobs.some((j) => j.id === `demo-${i}` && jobIsActive(j)))
            continue;
          jobs = jobs.filter((j) => j.id !== `demo-${i}`);
          const job = makeJob(
            i,
            jobs.some(jobIsActive) ? "queued" : "scanning",
          );
          if (type === "START_PAGE_DOWNLOAD") {
            job.batchId = "demo-batch";
            job.batchParentUrl = demoUrl;
          }
          jobs.push(job);
          addedCount++;
        }
        result = {
          job: jobs.find((j) => j.id === `demo-${indices[0]}`),
          addedCount,
          folderCount: indices.length,
          duplicateCount: indices.length - addedCount,
          needsWorker: false,
        };
      } else if (
        [
          "PAUSE",
          "RESUME",
          "CANCEL_JOB",
          "RESTORE_CANCELLED_JOB",
          "RETRY_JOB",
          "DISMISS_JOB",
        ].includes(type)
      ) {
        const id = String(message.jobId || current.activeJobId);
        jobs = jobs.flatMap((j) => {
          if (j.id !== id) return [j];
          if (type === "DISMISS_JOB") return [];
          const status: JobStatus =
            type === "PAUSE"
              ? "paused"
              : type === "CANCEL_JOB"
                ? "cancelled"
                : "downloading";
          return [
            {
              ...j,
              status,
              failureRetryKeys: [],
              counts: {
                ...j.counts,
                failed: 0,
                cancelled:
                  type === "CANCEL_JOB"
                    ? 24 - Number(j.counts?.success || 0)
                    : 0,
              },
            },
          ];
        });
      } else if (type.endsWith("DOWNLOAD_BATCH")) {
        jobs = jobs.flatMap((j) =>
          j.batchId !== message.batchId
            ? [j]
            : type === "REMOVE_DOWNLOAD_BATCH"
              ? []
              : [
                  {
                    ...j,
                    batchPaused: type === "PAUSE_DOWNLOAD_BATCH",
                    status:
                      j.status === "downloading" &&
                      type === "PAUSE_DOWNLOAD_BATCH"
                        ? "paused"
                        : j.status === "paused" &&
                            type === "RESUME_DOWNLOAD_BATCH"
                          ? "downloading"
                          : j.status,
                  },
                ],
        );
      } else if (
        [
          "CHOOSE_DOWNLOAD_DIRECTORY",
          "SAVE_GOPEED_SETTINGS",
          "SET_DOWNLOAD_CONCURRENCY",
        ].includes(type)
      ) {
        const next = { ...settingsRef.current };
        if (type === "CHOOSE_DOWNLOAD_DIRECTORY")
          next.gopeedDownloadDirOverride = "D:\\模拟素材\\POPO稳定下载";
        if (type === "SAVE_GOPEED_SETTINGS")
          next.gopeedDownloadDirOverride = "";
        if (type === "SET_DOWNLOAD_CONCURRENCY")
          next.concurrency = Number(message.concurrency);
        saveSettings(next);
        setConnection({ connected: true });
        result = {
          settings: next,
          connection: { connected: true },
          state: current,
        };
      } else if (
        type === "GET_DIAGNOSTIC_STATUS" ||
        type === "SEND_DIAGNOSTICS"
      ) {
        if (type === "SEND_DIAGNOSTICS" && initial === "failed")
          throw new Error("模拟诊断发送失败，请切换默认状态后重试。");
        result = {
          diagnosticStatus: {
            configured: true,
            pendingCount: initial === "failed" ? 3 : 0,
            lastSentAt:
              type === "SEND_DIAGNOSTICS" ? new Date().toISOString() : "",
            provider: "demo",
            host: "本地模拟",
            lastAttemptAt: "",
            lastError:
              initial === "failed"
                ? "模拟网络连接失败，请稍后重试。"
                : initial === "long"
                  ? "模拟错误：当前网络暂时无法连接诊断服务；详细信息会在本机保留，网络恢复后可重试。"
                  : "",
          },
        };
      } else if (type === "GET_UPDATE_DIAGNOSTICS")
        result = { diagnostics: { mode: "simulation", version: "design" } };
      else if (
        type === "SNOOZE_NETWORK_REMINDER" ||
        type === "MUTE_NETWORK_REMINDER_TODAY"
      ) {
        update({
          ...current,
          networkHealth: current.networkHealth
            ? { ...current.networkHealth, suppressed: true }
            : undefined,
        });
        setLog("已模拟关闭网络提醒，下载继续。");
        return {} as T;
      } else throw new Error(`模拟器未实现操作：${type}`);
      update({
        ...current,
        jobs,
        activeJobId:
          jobs.find((j) => jobIsActive(j) && j.status !== "queued")?.id ||
          jobs.find((j) => j.status === "queued")?.id ||
          null,
      });
      if (!type.startsWith("GET_"))
        setLog(
          `${type === "SEND_DIAGNOSTICS" ? "已模拟发送；没有对外请求" : type === "CHOOSE_DOWNLOAD_DIRECTORY" ? "已模拟选择保存位置；没有调用系统窗口" : "模拟操作完成"}。`,
        );
      return result as T;
    },
    currentPopoTabId: async () => null,
    copyText: async () => {
      setLog("已模拟复制诊断；未写入系统剪贴板。");
    },
    ensureWorker: () => {
      throw new Error("Design 不允许创建真实下载工作区");
    },
  };
  const fail = () => {
    setPlaying(false);
    const jobs = stateRef.current.jobs || [];
    if (!jobs.length) {
      reset("failed");
      notify("error", "部分文件未完成", "3 个文件未完成，可在任务卡重试。");
      return;
    }
    const id = stateRef.current.activeJobId || jobs[0]!.id;
    update({
      ...stateRef.current,
      jobs: jobs.map((j) =>
        j.id === id
          ? {
              ...j,
              status: "failed",
              counts: { ...j.counts, success: 21, failed: 3 },
              failureRetryKeys: ["a", "b", "c"],
            }
          : j,
      ),
      activeJobId: null,
    });
    notify("error", "部分文件未完成", "3 个文件未完成，可在任务卡重试。");
  };
  const slowNetwork = () => {
    const health = {
      ...createNetworkHealth(),
      jobId: stateRef.current.activeJobId || "demo-0",
      status: "slow" as const,
      activeTasks: 5,
      medianSpeed: 1024 * 1024,
      suppressed: false,
    };
    update({ ...stateRef.current, networkHealth: health });
    setLog("已注入模拟低速状态，任务仍在运行。");
  };
  return {
    state,
    settings,
    connection,
    toasts,
    error,
    log,
    playing,
    epoch,
    actions,
    reset,
    advance,
    fail,
    slowNetwork,
    notify,
    setPlaying,
    setSettings: saveSettings,
    setConnection,
    setError,
    setToasts,
    refresh: async () => {},
    showError: (e: unknown) => {
      const message = String(e instanceof Error ? e.message : e);
      if (message !== "示例已重置") setError(message);
    },
  };
}
export type Demo = ReturnType<typeof useDemo>;
