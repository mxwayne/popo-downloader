import { UiActionsProvider } from "./ui/actions";
import { TaskSection, UpdateDiagnosticsCard, NetworkNoticeCard, ServiceSettings } from "./ui/popup-components";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  attentionJobs,
  completedJobs,
  failedRetryCount,
  jobDetail,
  jobIsActive,
  jobName,
  jobProgress,
  liveJobs,
  MODE_LABELS,
  modeBadgeLabel,
  networkHealthSummary,
  recoverableCount,
  summarizeLiveJobs,
  userFacingError,
  type GopeedConnection,
  type GopeedSettings,
  type NetworkHealth,
  type QueueJob,
  type QueueState
} from "./ui-model";

interface StateResponse {
  state: QueueState;
  settings: GopeedSettings;
}

interface GopeedResponse {
  connection: GopeedConnection;
  settings: GopeedSettings;
}

interface ConcurrencyResponse {
  state: QueueState;
  settings: GopeedSettings;
}

interface PopupErrorState {
  message: string;
  transient: boolean;
}

interface UpdateStatus {
  state: string;
  currentVersion: string;
  targetVersion: string;
  message: string;
  updatedAt: string;
}

interface UpdateStatusResponse {
  updateStatus: UpdateStatus;
}

interface UpdateDiagnosticsResponse {
  diagnostics: Record<string, unknown>;
}

interface DiagnosticStatus {
  configured: boolean;
  provider: string;
  host: string;
  pendingCount: number;
  lastSentAt: string;
  lastAttemptAt: string;
  lastError: string;
  sent?: number;
}

interface DiagnosticStatusResponse {
  diagnosticStatus: DiagnosticStatus;
}

interface DevSyncMarker {
  schemaVersion?: number;
  channel?: string;
  syncedAtUtc?: string;
  label?: string;
}

async function callExtension<T extends object = Record<string, never>>(
  message: Record<string, unknown>
): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as T & {
    ok?: boolean;
    error?: string;
  };
  if (!response?.ok) throw new Error(response?.error || "扩展后台未响应");
  return response;
}

async function currentPopoTabId(): Promise<number | null> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs.find((candidate) =>
    /^https:\/\/docs\.popo\.netease\.com\/team\/pc\/[^/]+\/pageDetail\/[a-z0-9]+/i
      .test(candidate.url || "")
  );
  return Number.isInteger(tab?.id) ? tab?.id || null : null;
}

function usePopupPresence(): void {
  useEffect(() => {
    let port: chrome.runtime.Port | null = null;
    try {
      port = chrome.runtime.connect({ name: "popo-popup-ui" });
    } catch (error) {
      console.warn("无法同步弹窗显示状态", error);
    }
    return () => {
      try {
        port?.disconnect();
      } catch {
        // Extension reloads can invalidate the port before React unmounts.
      }
    };
  }, []);
}

function useDevSyncBatch(versionName: string): string {
  const [label, setLabel] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!/-dev$/i.test(versionName)) {
      setLabel("");
      return () => { cancelled = true; };
    }
    void fetch(chrome.runtime.getURL("dev-sync.json"), { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Dev sync marker was not found");
        return await response.json() as DevSyncMarker;
      })
      .then((marker) => {
        const markerLabel = String(marker.label || "").trim();
        const syncedAt = Date.parse(String(marker.syncedAtUtc || ""));
        if (
          marker.schemaVersion === 1 &&
          marker.channel === "dev" &&
          Number.isFinite(syncedAt) &&
          /^DEV · \d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(markerLabel) &&
          !cancelled
        ) {
          setLabel(markerLabel);
        }
      })
      .catch(() => {
        if (!cancelled) setLabel("");
      });
    return () => { cancelled = true; };
  }, [versionName]);

  return label;
}

function usePopupState() {
  const [state, setState] = useState<QueueState>({ jobs: [] });
  const [settings, setSettings] = useState<GopeedSettings>({});
  const [connection, setConnection] = useState<GopeedConnection | null>(null);
  const [error, setError] = useState<PopupErrorState | null>(null);
  const gopeedCheckAt = useRef(0);
  const gopeedChecking = useRef(false);

  const refreshGopeed = useCallback(async (force = false) => {
    if (
      gopeedChecking.current ||
      (!force && Date.now() - gopeedCheckAt.current < 5000)
    ) {
      return;
    }
    gopeedChecking.current = true;
    gopeedCheckAt.current = Date.now();
    try {
      const response = await callExtension<GopeedResponse>({ type: "CHECK_GOPEED" });
      setConnection(response.connection);
      setSettings(response.settings || {});
    } catch (caught) {
      setConnection({
        connected: false,
        error: String(caught instanceof Error ? caught.message : caught)
      });
    } finally {
      gopeedChecking.current = false;
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const response = await callExtension<StateResponse>({ type: "GET_STATE" });
      setState(response.state || { jobs: [] });
      setSettings(response.settings || {});
      setError((current) => current?.transient ? null : current);
      void refreshGopeed();
    } catch (caught) {
      console.warn("读取扩展状态失败", caught);
      setError({
        message: "暂时无法读取任务，请重新打开扩展。",
        transient: true
      });
    }
  }, [refreshGopeed]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 1000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return {
    state,
    settings,
    connection,
    error,
    setError,
    setSettings,
    setConnection,
    refresh,
    refreshGopeed
  };
}

function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  useEffect(() => {
    let disposed = false;
    const refresh = async () => {
      try {
        const response = await callExtension<UpdateStatusResponse>({
          type: "GET_UPDATE_STATUS"
        });
        if (!disposed) setStatus(response.updateStatus || null);
      } catch {
        // Update status is supplemental and must not block task controls.
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);
  return status;
}

function updateStatusLabel(status: UpdateStatus | null): string {
  if (!status) return "";
  if (["starting", "checking", "downloading", "installing"].includes(status.state)) {
    return status.targetVersion ? ` · 正在更新到 ${status.targetVersion}` : " · 正在检查更新";
  }
  if (status.state === "deferred") return " · 更新已延后";
  if (status.state === "failed") return " · 更新检查失败";
  return "";
}

function PopupApp() {
  usePopupPresence();
  const updateStatus = useUpdateStatus();
  const {
    state,
    settings,
    connection,
    error,
    setError,
    setSettings,
    setConnection,
    refresh,
    refreshGopeed
  } = usePopupState();
  const active = useMemo(() => liveJobs(state), [state]);
  const attention = useMemo(() => attentionJobs(state), [state]);
  const completed = useMemo(() => completedJobs(state).slice(0, 3), [state]);
  const hasOpenTasks = active.length > 0 || attention.length > 0;
  const networkHealth = state.networkHealth;
  const showNetworkNotice = Boolean(
    hasOpenTasks &&
    networkHealth &&
    !networkHealth.suppressed &&
    networkHealth.activeTasks > 0 &&
    (networkHealth.highProbabilityWindow || ["slow", "severe"].includes(networkHealth.status))
  );
  const manifest = chrome.runtime.getManifest();
  const versionName = manifest.version_name || "";
  const version = versionName || manifest.version;
  const devSyncBatch = useDevSyncBatch(versionName);

  const showError = useCallback((caught: unknown) => {
    console.warn("扩展操作失败", caught);
    setError({ message: userFacingError(caught), transient: false });
  }, [setError]);

  return (
    <main>
      <header>
        <div className="brand">
          <img
            className="brand-logo"
            src="assets/popo-logo.svg"
            alt=""
            width="36"
            height="36"
          />
          <div>
            <p className="eyebrow">POPO 下载</p>
            <h1>稳定下载助手</h1>
          </div>
        </div>
        {!hasOpenTasks && (
          <span id="modeBadge" className="badge" data-state={modeBadgeLabel(state)}>
            {modeBadgeLabel(state)}
          </span>
        )}
      </header>

      {!hasOpenTasks && (
        <section id="idleCard" className="instruction">
          <span className="download-mark">⇩</span>
          <div>
            <strong>选择要下载的文件夹</strong>
            <p>在 POPO 中，点击文件夹旁的蓝色下载按钮。</p>
          </div>
        </section>
      )}

      {hasOpenTasks && (
        <section id="taskCard" className="task-card">
          <div className="queue-heading">
            <strong>下载任务</strong>
            <span id="queueSummary">{summarizeLiveJobs(active)}</span>
          </div>
          {showNetworkNotice && networkHealth && (
            <NetworkNoticeCard health={networkHealth} refresh={refresh} showError={showError} />
          )}
          <div id="popupQueueList" className="popup-queue-list">
            <TaskSection
              title="进行中"
              jobs={active}
              activeJobId={state.activeJobId || null}
              refresh={refresh}
              showError={showError}
            />
            <TaskSection
              title="需要处理"
              jobs={attention}
              activeJobId={state.activeJobId || null}
              refresh={refresh}
              showError={showError}
            />
          </div>
        </section>
      )}

      {completed.length > 0 && (
        <details className="recent-completed">
          <summary>最近完成（{completed.length}）</summary>
          <div className="popup-queue-list">
            <TaskSection
              title="最近完成"
              jobs={completed}
              activeJobId={state.activeJobId || null}
              refresh={refresh}
              showError={showError}
            />
          </div>
        </details>
      )}

      <ServiceSettings
        connection={connection}
        settings={settings}
        concurrencyLocked={active.length > 0}
        refreshGopeed={refreshGopeed}
        setConnection={setConnection}
        setSettings={setSettings}
        showError={showError}
      />

      <UpdateDiagnosticsCard showError={showError} />

      <p id="errorBox" className="error" hidden={!error}>
        {error?.message || ""}
      </p>
      <footer id="versionInfo" title={updateStatus?.message || ""}>
        <span>版本 {version}{updateStatusLabel(updateStatus)}</span>
        {devSyncBatch && <span id="devSyncBatch">{devSyncBatch}</span>}
      </footer>
    </main>
  );
}

const rootElement = document.getElementById("popup-root");
if (!rootElement) throw new Error("Popup React root was not found");
createRoot(rootElement).render(
  <UiActionsProvider value={{ send: callExtension, currentPopoTabId, copyText: (text) => navigator.clipboard.writeText(text), ensureWorker: () => {} }}>
    <PopupApp />
  </UiActionsProvider>
);
