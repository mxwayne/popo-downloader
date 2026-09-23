import { createDirectorySkeleton } from "../ui/directory-skeleton";
import { useEffect, useState, useCallback, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCheck,
  CircleAlert,
  Download,
  Folder,
  Layers,
  LoaderCircle,
  Monitor,
  MousePointer2,
  Palette,
  Pause,
  Play,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  TriangleAlert,
  X,
} from "lucide-react";
import { UiActionsProvider } from "../ui/actions";
import {
  PopupProgress,
  TaskSection,
  TaskCard,
  ServiceSettings,
  NetworkNoticeCard,
  UpdateDiagnosticsCard,
} from "../ui/popup-components";
import {
  FolderDownloadButton,
  PageDownloadButton,
  ProjectCount,
  QueueDock,
  ToastViewport,
} from "../ui/page-components";
import {
  JOB_STATUSES,
  MODE_LABELS,
  attentionJobs,
  completedJobs,
  liveJobs,
} from "../ui-model";
import {
  demoUrl,
  folders,
  makeJob,
  scenarioNames,
  useDemo,
  type Demo,
  type Scenario,
} from "./demo";
import { Frame, popupTokens } from "./frame";
import designCss from "./design.css";

const sections = [
  {
    id: "workbench",
    name: "业务样板",
    icon: Layers,
    detail: "多文件夹下载与恢复",
  },
  {
    id: "foundations",
    name: "基础规范",
    icon: Palette,
    detail: "颜色、文字与空间",
  },
  {
    id: "components",
    name: "基础组件",
    icon: SlidersHorizontal,
    detail: "控件与状态覆盖",
  },
  {
    id: "motion",
    name: "动效与反馈",
    icon: Sparkles,
    detail: "等待、进度与完成",
  },
  {
    id: "guide",
    name: "使用与验收",
    icon: BookOpen,
    detail: "来源、接入与边界",
  },
] as const;
type Section = (typeof sections)[number]["id"];
const sourceNotes = {
  controls: "popup.css · 原生 button / select / details 的共享样式",
  task: "src/ui/popup-components.tsx · TaskCard / TaskSection / PopupProgress",
  page: "src/ui/page-components.tsx · FolderDownloadButton / PageDownloadButton / ProjectCount",
  feedback: "src/ui/page-components.tsx · QueueDock / ToastViewport",
  settings: "src/ui/popup-components.tsx · ServiceSettings / NetworkNoticeCard",
  diagnostics: "src/ui/popup-components.tsx · UpdateDiagnosticsCard",
};
function Heading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="section-heading">
      <h1>{title}</h1>
      <p>{children}</p>
    </div>
  );
}
function Source({ children }: { children: ReactNode }) {
  return (
    <div className="source-note">
      <CheckCheck size={15} />
      <span>公共源码 · 业务已引用</span>
      <code>{children}</code>
    </div>
  );
}
function Note({ children }: { children: ReactNode }) {
  return <p className="design-note">{children}</p>;
}
function ResetButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="d-button" onClick={onClick}>
      <RotateCcw size={15} />
      重置示例
    </button>
  );
}
function NarrowControl({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      className="d-button"
      aria-pressed={value}
      onClick={() => onChange(!value)}
    >
      {value ? <Smartphone size={15} /> : <Monitor size={15} />}
      {value ? "320px 预览" : "适应容器"}
    </button>
  );
}
function DemoErrors({ demo }: { demo: Demo }) {
  return (
    <>
      {demo.error && (
        <div className="demo-error" role="alert">
          {demo.error}
          <button aria-label="关闭错误" onClick={() => demo.setError("")}>
            <X size={14} />
          </button>
        </div>
      )}
      <p className="demo-log" role="status">
        {demo.log}
      </p>
    </>
  );
}
function TaskList({ demo }: { demo: Demo }) {
  return (
    <div className="popup-surface">
      <div className="queue-heading">
        <strong>下载任务</strong>
        <span>模拟队列</span>
      </div>
      {!demo.state.jobs?.length ? (
        <div className="sample-empty">
          <Folder size={26} />
          <p>选择要下载的文件夹</p>
          <p>点击左侧文件夹旁的下载按钮。</p>
        </div>
      ) : (
        <>
          <TaskSection
            title="进行中"
            jobs={liveJobs(demo.state)}
            activeJobId={demo.state.activeJobId || null}
            refresh={demo.refresh}
            showError={demo.showError}
          />
          <TaskSection
            title="需要处理"
            jobs={attentionJobs(demo.state)}
            activeJobId={demo.state.activeJobId || null}
            refresh={demo.refresh}
            showError={demo.showError}
          />
          {!!completedJobs(demo.state).length && (
            <details className="recent-completed" open>
              <summary>最近完成</summary>
              <TaskSection
                title="已完成"
                jobs={completedJobs(demo.state)}
                activeJobId={null}
                refresh={demo.refresh}
                showError={demo.showError}
              />
            </details>
          )}
        </>
      )}
    </div>
  );
}
function PageSample({ demo }: { demo: Demo }) {
  return (
    <div className="sample-page">
      <div className="sample-toolbar">
        <ProjectCount count={3} />
        <PageDownloadButton
          pageName="九月素材交付"
          parentUrl={demoUrl}
          count={3}
          state={demo.state}
          refresh={demo.refresh}
          onError={(_, e) => demo.showError(e)}
        />
      </div>
      {folders.map((name, i) => (
        <div className="sample-row" key={name}>
          <div className="sample-name">
            <Folder size={20} />
            <span>{name}</span>
          </div>
          <FolderDownloadButton
            item={{ name, itemIndex: String(i), parentUrl: demoUrl }}
            state={demo.state}
            refresh={demo.refresh}
            onInspect={() =>
              demo.notify(
                "warning",
                "任务详情",
                "右侧管理面板中可以暂停、继续或处理失败项。",
              )
            }
            onError={(_, e) => demo.showError(e)}
          />
        </div>
      ))}
    </div>
  );
}
function Workbench() {
  const demo = useDemo();
  const [narrow, setNarrow] = useState(false);
  const [expanded, setExpanded] = useState(true);
  return (
    <>
      <Heading title="每一步下载，都有明确反馈。">
        从文件夹入队到失败恢复，在同一个样板里验证页面按钮、任务管理和事件通知。
      </Heading>
      <div className="flow">
        <span>
          <MousePointer2 size={16} />
          选择文件夹
        </span>
        <i />{" "}
        <span>
          <Search size={16} />
          查找与排队
        </span>
        <i />
        <span>
          <Download size={16} />
          下载与恢复
        </span>
        <i />
        <span>
          <Check size={16} />
          完成核对
        </span>
      </div>
      <div className="sample-bar">
        <div>
          <span className="simulation">本地模拟</span>
          <span>九月素材交付</span>
        </div>
        <div className="toolbar">
          <NarrowControl value={narrow} onChange={setNarrow} />
          <ResetButton
            onClick={() => {
              demo.reset();
              setExpanded(true);
            }}
          />
        </div>
      </div>
      <UiActionsProvider value={demo.actions}>
        <div className="workbench-grid" key={demo.epoch}>
          <div>
            <div className="preview-label">
              <span>POPO 文件夹列表</span>
              <span>浅色宿主中的扩展控件</span>
            </div>
            <Frame narrow={narrow} label="文件夹列表预览">
              <PageSample demo={demo} />
            </Frame>
            <div className="playback">
              <button
                className="d-button primary"
                onClick={async () => {
                  if (!demo.state.jobs?.length)
                    await demo.actions.send({ type: "START_PAGE_DOWNLOAD" });
                  demo.setPlaying(!demo.playing);
                }}
              >
                {demo.playing ? <Pause size={15} /> : <Play size={15} />}
                {demo.playing ? "暂停演示" : "自动演示"}
              </button>
              <button
                className="d-button"
                onClick={demo.advance}
                disabled={
                  !demo.state.jobs?.some((j) =>
                    ["queued", "scanning", "downloading"].includes(j.status),
                  )
                }
              >
                推进一步
              </button>
              <button className="d-button" onClick={demo.fail}>
                注入失败
              </button>
              <button
                className="d-button"
                disabled={!liveJobs(demo.state).length}
                onClick={demo.slowNetwork}
              >
                模拟网络慢
              </button>
            </div>
            <div className="preview-label">
              <span>持续摘要与一次性通知</span>
              <span>页面内预览</span>
            </div>
            <Frame narrow={narrow} label="任务摘要预览">
              <QueueDock
                state={demo.state}
                expanded={expanded}
                focusedJobId={null}
                onExpandedChange={setExpanded}
                onAction={demo.refresh}
                onError={(_, e) => demo.showError(e)}
              />
              {!demo.state.jobs?.length && (
                <p className="sample-note">
                  任务开始后，左下任务摘要会出现在这里。
                </p>
              )}
              <ToastViewport
                toasts={demo.toasts}
                onDismiss={(id) =>
                  demo.setToasts((v) => v.filter((t) => t.id !== id))
                }
                onInspect={() =>
                  demo.setError("模拟提示：请在右侧任务卡重试未完成项。")
                }
                onNetworkSnooze={demo.refresh}
              />
            </Frame>
          </div>
          <div>
            <div className="preview-label">
              <span>扩展管理面板</span>
              <span>390px 基线</span>
            </div>
            <Frame narrow={narrow} label="管理面板预览">
              <TaskList demo={demo} />
            </Frame>
            <div className="behavior-note">
              <strong>恢复到正确的位置</strong>
              <p>
                “停止后续下载”保留已开始的文件；“移除”只移除记录。失败项与排队任务分开显示。
              </p>
            </div>
          </div>
        </div>
      </UiActionsProvider>
      <DemoErrors demo={demo} />
      <Source>
        {sourceNotes.task}
        <br />
        {sourceNotes.page}
        <br />
        {sourceNotes.feedback}
      </Source>
      <div className="acceptance-strip">
        <span>
          <Check size={15} />
          共享组件与状态解释
        </span>
        <span>
          <Check size={15} />
          模拟数据独立
        </span>
        <span>
          <CircleAlert size={15} />
          真实下载需 Windows Dev 验收
        </span>
      </div>
    </>
  );
}
const colors = [
  ["--canvas", "画布", "#0c1219"],
  ["--surface", "表面", "#18222e"],
  ["--ink", "主要文字", "#edf3fb"],
  ["--muted", "辅助文字", "#9facbd"],
  ["--blue", "操作与活动", "#79b5ff"],
  ["--green-ink", "成功", "#83dfc2"],
  ["--warning-ink", "提醒", "#f1d17f"],
  ["--red", "失败", "#ff818d"],
];
function Foundations() {
  return (
    <>
      <Heading title="沿用熟悉的 POPO 视觉。">
        以当前业务实现为基线，统一颜色语义、内容层级和交互边界。
      </Heading>
      <h2 className="block-title">
        颜色与主题 <span>现有规范</span>
      </h2>
      <div className="swatch-grid">
        {colors.map(([token, title, fallback]) => (
          <div className="swatch" key={token}>
            <div style={{ background: `var(${token})` }} />
            <strong>{title}</strong>
            <code>{token}</code>
            <small>{fallback}</small>
          </div>
        ))}
      </div>
      <Note>
        固定深色扩展主题。浅色仅作为 POPO
        宿主背景展示，不代表提供浅色扩展主题。状态同时使用文字和图标，不只依赖颜色。来源：popup.css；页面注入规则：src/ui/page-styles.ts。
      </Note>
      <h2 className="block-title">文字与内容层级</h2>
      <div className="type-spec">
        <div>
          <span style={{ fontSize: 21, fontWeight: 700 }}>稳定下载助手</span>
          <code>标题 · 21px / 700</code>
        </div>
        <div>
          <span style={{ fontSize: 16, fontWeight: 700 }}>需要处理</span>
          <code>分组 · 16px / 700</code>
        </div>
        <div>
          <span style={{ fontSize: 13 }}>角色动作素材 · 已完成 8 / 24</span>
          <code>正文 · 13px / 1.45</code>
        </div>
        <div>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>
            只从列表移除，不会删除已下载文件。
          </span>
          <code>辅助 · 11px / 1.45</code>
        </div>
      </div>
      <Note>
        Segoe UI → Microsoft YaHei → sans-serif；不请求远程字体。Design
        说明区适度放大，业务预览保持实际字号。完整名称与路径保留 title
        提示；正文错误允许换行。
      </Note>
      <div className="spec-columns">
        <section>
          <h2 className="block-title">
            间距 <span>整理建议</span>
          </h2>
          <div className="space-spec">
            {[4, 8, 12, 16, 24, 32].map((v) => (
              <div key={v}>
                <code>{v}px</code>
                <i style={{ width: v * 3 }} />
                <span>
                  {v <= 8 ? "控件内部" : v <= 16 ? "信息组" : "内容分区"}
                </span>
              </div>
            ))}
          </div>
        </section>
        <section>
          <h2 className="block-title">
            圆角 <span>当前取值</span>
          </h2>
          <div className="radius-spec">
            {[
              [7, "操作控件"],
              [9, "任务卡"],
              [12, "任务条"],
            ].map(([v, label]) => (
              <div key={v}>
                <i style={{ borderRadius: Number(v) }} />
                <code>{v}px</code>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <Note>
            胶囊仅用于状态标签与进度轨道。保留现有控件尺寸，后续新增样式采用语义命名。
          </Note>
        </section>
      </div>
      <h2 className="block-title">图标与交互</h2>
      <div className="icon-spec">
        {[
          [Download, "下载"],
          [Search, "查找"],
          [Pause, "暂停"],
          [Play, "继续"],
          [Check, "完成"],
          [TriangleAlert, "异常"],
          [Folder, "文件夹"],
        ].map(([Icon, label]) => {
          const I = Icon as typeof Download;
          return (
            <div key={String(label)}>
              <I size={20} strokeWidth={2} />
              <span>{String(label)}</span>
            </div>
          );
        })}
      </div>
      <Note>
        Lucide React · 图标以 16–20px
        为主，状态图标跟随原组件尺寸。图标按钮必须有可访问名称；Tab
        焦点可见，禁用原因就近说明。
      </Note>
      <h2 className="block-title">层级与宿主关系</h2>
      <div className="layer-spec">
        <span>POPO 原生列表</span>
        <span>行内下载控件</span>
        <span>目录过渡层</span>
        <span>任务摘要</span>
        <span>事件通知</span>
      </div>
      <Note>
        注入控件继续使用原有命名空间与 Shadow DOM；Design
        中将固定位置的任务条、通知限制在示例容器。真实页面的菜单、遮罩与目录切换由既有集成测试保护。
      </Note>
    </>
  );
}
function SettingsExample({
  demo,
  scenario,
}: {
  demo: Demo;
  scenario: Scenario;
}) {
  return (
    <div className="popup-surface">
      <ServiceSettings
        connection={demo.connection}
        settings={demo.settings}
        concurrencyLocked={scenario === "disabled"}
        refreshGopeed={async () => demo.setConnection({ connected: true })}
        setConnection={demo.setConnection}
        setSettings={demo.setSettings}
        showError={demo.showError}
      />
      <p className="sample-note">
        展开“设置”操作。选择位置、保存和恢复连接均为模拟。
      </p>
    </div>
  );
}
function Components() {
  const [category, setCategory] = useState<keyof typeof sourceNotes>("task");
  const [scenario, setScenario] = useState<Scenario>("default");
  const [narrow, setNarrow] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const demo = useDemo(scenario);
  const categoryLabels = {
    controls: "基础控件",
    task: "任务卡与进度",
    page: "页面操作控件",
    settings: "设置与网络提醒",
    feedback: "摘要与通知",
    diagnostics: "更新与诊断",
  };
  return (
    <>
      <Heading title="同一份组件，完整的状态。">
        直接运行业务使用的 React 组件。切换状态，观察文案、操作和窄屏布局。
      </Heading>
      <div className="category-tabs" role="group" aria-label="组件分类">
        {Object.entries(categoryLabels).map(([id, name]) => (
          <button
            key={id}
            className="d-button"
            aria-pressed={category === id}
            onClick={() => {
              setCategory(id as keyof typeof sourceNotes);
              demo.reset(scenario);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="sample-bar">
        <label className="select-label">
          示例状态{" "}
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value as Scenario)}
          >
            {Object.entries(scenarioNames).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="toolbar">
          <NarrowControl value={narrow} onChange={setNarrow} />
          <ResetButton onClick={() => demo.reset(scenario)} />
        </div>
      </div>
      <UiActionsProvider value={demo.actions}>
        <div className="component-canvas" key={`${category}-${demo.epoch}`}>
          <Frame narrow={narrow} label="组件状态预览">
            {category === "controls" && (
              <div className="popup-surface">
                <fieldset
                  disabled={scenario === "disabled" || scenario === "loading"}
                  className="demo-fieldset"
                >
                  <div className="sample-actions">
                    <button
                      className="primary"
                      onClick={() =>
                        demo.notify("success", "模拟操作成功", "主操作已完成。")
                      }
                    >
                      {scenario === "loading"
                        ? "正在处理…"
                        : scenario === "long"
                          ? "继续下载尚未完成的全部素材文件"
                          : "继续下载"}
                    </button>
                    <button
                      onClick={() =>
                        demo.notify("warning", "已暂停", "示例已模拟暂停。")
                      }
                    >
                      暂停
                    </button>
                    <button
                      className="danger"
                      onClick={() =>
                        demo.notify(
                          "warning",
                          "后续下载已停止",
                          "已开始的文件保留。",
                        )
                      }
                    >
                      停止后续下载
                    </button>
                    <button
                      className="remove"
                      onClick={() =>
                        demo.notify(
                          "warning",
                          "查看移除确认",
                          "任务卡分类中可操作完整的行内确认。",
                        )
                      }
                    >
                      移除
                    </button>
                  </div>
                </fieldset>
                {scenario === "failed" && (
                  <p className="sample-error" role="alert">
                    模拟操作失败，请重新尝试。
                  </p>
                )}
                {scenario === "disabled" && (
                  <p className="sample-note">
                    正在处理其他操作，按钮暂不可用。
                  </p>
                )}
                <p className="sample-note">
                  按钮的空内容状态不适用：操作必须有可读名称。加载与禁用保持原布局。
                </p>
                <ToastViewport
                  toasts={demo.toasts}
                  onDismiss={() => demo.setToasts([])}
                  onInspect={() => {}}
                  onNetworkSnooze={demo.refresh}
                />
              </div>
            )}
            {category === "task" && (
              <fieldset
                disabled={scenario === "disabled"}
                className="demo-fieldset"
              >
                <TaskList demo={demo} />
              </fieldset>
            )}
            {category === "page" && (
              <fieldset
                disabled={scenario === "disabled"}
                className="demo-fieldset"
              >
                <div className="sample-page">
                  <div className="sample-toolbar">
                    <ProjectCount
                      count={
                        scenario === "loading"
                          ? null
                          : scenario === "empty"
                            ? 0
                            : 3
                      }
                    />
                    <PageDownloadButton
                      pageName="示例目录"
                      parentUrl={demoUrl}
                      count={scenario === "empty" ? 0 : 3}
                      state={demo.state}
                      refresh={demo.refresh}
                      onError={(_, e) => demo.showError(e)}
                    />
                  </div>
                  {scenario === "empty" ? (
                    <p>当前目录没有子文件夹。</p>
                  ) : (
                    <div className="sample-row">
                      <div className="sample-name">
                        <Folder size={20} />
                        <span>{demo.state.jobs?.[0]?.folderName}</span>
                      </div>
                      <FolderDownloadButton
                        item={{
                          name: demo.state.jobs?.[0]?.folderName || folders[0]!,
                          itemIndex: "0",
                          parentUrl: demoUrl,
                        }}
                        state={demo.state}
                        refresh={demo.refresh}
                        onInspect={() =>
                          demo.notify(
                            "warning",
                            "已定位任务",
                            "在业务页打开任务摘要；此处请切换到任务卡分类。",
                          )
                        }
                        onError={(_, e) => demo.showError(e)}
                      />
                    </div>
                  )}
                </div>
              </fieldset>
            )}
            {category === "settings" && (
              <>
                <SettingsExample demo={demo} scenario={scenario} />
                {demo.state.networkHealth &&
                  !demo.state.networkHealth.suppressed && (
                    <div className="popup-surface">
                      <NetworkNoticeCard
                        health={demo.state.networkHealth}
                        refresh={demo.refresh}
                        showError={demo.showError}
                      />
                    </div>
                  )}
              </>
            )}
            {category === "feedback" && (
              <>
                <QueueDock
                  state={demo.state}
                  expanded={expanded}
                  focusedJobId={null}
                  onExpandedChange={setExpanded}
                  onAction={demo.refresh}
                  onError={(_, e) => demo.showError(e)}
                />
                {scenario === "empty" && (
                  <p className="sample-note">
                    没有活动或待处理任务时，任务摘要不显示。
                  </p>
                )}
                <ToastViewport
                  toasts={demo.toasts}
                  onDismiss={(id) =>
                    demo.setToasts((v) => v.filter((t) => t.id !== id))
                  }
                  onInspect={() =>
                    demo.setError("已模拟定位失败任务。请切换任务卡分类查看。")
                  }
                  onNetworkSnooze={demo.refresh}
                />
              </>
            )}
            {category === "diagnostics" && (
              <fieldset
                disabled={scenario === "disabled"}
                className="demo-fieldset"
              >
                <div className="popup-surface">
                  <UpdateDiagnosticsCard showError={demo.showError} />
                  <p className="sample-note">
                    展开“诊断与回传”。发送与复制仅改变模拟状态，不连接外部系统。
                  </p>
                  <footer>版本 0.7.8 · 更新状态文案见下方说明</footer>
                </div>
              </fieldset>
            )}
          </Frame>
        </div>
      </UiActionsProvider>
      {category === "settings" && (
        <div className="playback">
          <button className="d-button" onClick={demo.slowNetwork}>
            显示网络慢提醒
          </button>
        </div>
      )}
      {(category === "feedback" || category === "page") && (
        <div className="playback">
          <button
            className="d-button"
            onClick={() =>
              demo.notify(
                "success",
                "下载完成",
                "24 个文件已完成，此结果为模拟。",
              )
            }
          >
            完成通知
          </button>
          <button
            className="d-button"
            onClick={() =>
              demo.notify(
                "error",
                "下载未完成",
                "3 个文件未完成，请查看任务并重试。",
              )
            }
          >
            失败通知
          </button>
          <button
            className="d-button"
            onClick={() =>
              demo.notify(
                "warning",
                "下载服务暂不可用",
                "服务恢复后可以继续下载。",
              )
            }
          >
            服务断开通知
          </button>
        </div>
      )}
      <DemoErrors demo={demo} />
      <Source>{sourceNotes[category]}</Source>
      <div className="usage-grid">
        <section>
          <h2>适用场景</h2>
          <p>
            {category === "controls"
              ? "沿用弹窗原生按钮及共享 CSS，主操作、次操作、危险操作和弱操作保持一致。表单与折叠控件见设置分类。"
              : category === "task"
                ? "管理单个文件夹任务；进度、可执行动作和移除确认跟随真实状态规则。"
                : category === "page"
                  ? "POPO 列表中添加单文件夹或整页子文件夹任务；重复点击不新建活动任务。"
                  : category === "settings"
                    ? "调整 1–5 个并行下载、选择保存位置、展示服务与网络状态。"
                    : category === "feedback"
                      ? "任务条提供持续摘要；通知只提示事件结果，允许关闭或查看任务。"
                      : "排查更新与下载异常；普通用户看到简短说明，诊断由业务入口执行。"}
          </p>
        </section>
        <section>
          <h2>状态说明</h2>
          <p>
            {category === "diagnostics"
              ? "诊断读取包含模拟延迟；失败态可模拟发送失败，禁用态锁定操作，长内容展示较长错误说明。暂停、停止和完成是任务专属状态，不改变诊断卡。真实发送仍需 Windows 验收。"
              : category === "settings"
                ? "禁用态锁定并行数；失败态显示服务不可用；空内容使用默认目录；长内容展示长路径。暂停、停止和完成不改变设置表单结构。"
                : "操作中按钮暂时禁用。长名称保留完整提示，窄屏允许操作换行。完成态无暂停动作，排队态不显示虚假百分比。"}
          </p>
        </section>
      </div>
      {category === "task" && (
        <>
          <h2 className="block-title">业务状态映射</h2>
          <div className="status-matrix">
            {JOB_STATUSES.map((status) => (
              <div key={status}>
                <code>{status}</code>
                <span>{MODE_LABELS[status]}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {category === "diagnostics" && (
        <div className="status-matrix">
          {[
            "正在检查更新",
            "正在更新到 0.7.9（示例版本）",
            "更新已延后",
            "更新检查失败",
          ].map((text) => (
            <div key={text}>{text}</div>
          ))}
        </div>
      )}
    </>
  );
}
function DirectorySkeleton() {
  const mount = useCallback((host: HTMLDivElement | null) => {
    if (host) {
      const skeleton = createDirectorySkeleton();
      const label = skeleton.querySelector("strong");
      if (label) label.textContent = "正在打开素材目录";
      host.replaceChildren(skeleton);
    }
  }, []);
  return (
    <div
      className="sample-skeleton"
      ref={mount}
      aria-label="目录切换骨架"
      role="status"
    />
  );
}
function Motion() {
  const [reduced, setReduced] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const demo = useDemo("loading");
  return (
    <>
      <Heading title="动效解释状态，不替代状态。">
        沿用 Motion 与
        CSS。等待可识别、完成可确认，减少动态效果时仍能读懂全部信息。
      </Heading>
      <div className="sample-bar">
        <label className="check-label">
          <input
            type="checkbox"
            checked={reduced}
            onChange={(e) => setReduced(e.target.checked)}
          />
          减少动态效果
        </label>
        <div className="toolbar">
          <NarrowControl value={narrow} onChange={setNarrow} />
          <ResetButton onClick={() => demo.reset("loading")} />
        </div>
      </div>
      <UiActionsProvider value={demo.actions}>
        <div className="motion-grid" key={demo.epoch}>
          <div>
            <h2>工作中的反馈</h2>
            <Frame narrow={narrow} reduced={reduced}>
              <div className="sample-page">
                <div className="sample-row">
                  <span>角色动作素材</span>
                  <FolderDownloadButton
                    item={{
                      name: demo.state.jobs?.[0]?.folderName || folders[0]!,
                      itemIndex: "0",
                      parentUrl: demoUrl,
                    }}
                    state={demo.state}
                    refresh={demo.refresh}
                    onInspect={() => {}}
                    onError={(_, e) => demo.showError(e)}
                  />
                </div>
              </div>
              <div className="popup-surface">
                {demo.state.jobs?.[0] && (
                  <TaskCard
                    job={demo.state.jobs[0]}
                    activeJobId={demo.state.activeJobId || null}
                    refresh={demo.refresh}
                    showError={demo.showError}
                  />
                )}
              </div>
            </Frame>
            <div className="playback">
              <button
                className="d-button"
                onClick={() => demo.setPlaying(!demo.playing)}
              >
                {demo.playing ? "暂停演示" : "播放过程"}
              </button>
              <button className="d-button" onClick={demo.advance}>
                推进一步
              </button>
              <button
                className="d-button"
                onClick={() => demo.reset("complete")}
              >
                完成状态
              </button>
            </div>
          </div>
          <div>
            <h2>通知与等待</h2>
            <Frame reduced={reduced} narrow={narrow}>
              <div className="popup-surface">
                <p className="sample-title">正在查找文件</p>
                <PopupProgress job={makeJob(0, "scanning")} />
                <p className="sample-note">不确定进度不报告实际完成百分比。</p>
              </div>
              <ToastViewport
                toasts={demo.toasts}
                onDismiss={() => demo.setToasts([])}
                onInspect={() => {}}
                onNetworkSnooze={demo.refresh}
              />
            </Frame>
            <div className="playback">
              <button
                className="d-button"
                onClick={() =>
                  demo.notify(
                    "success",
                    "下载已完成",
                    "完成通知可关闭，状态继续保留在任务列表。",
                  )
                }
              >
                重播完成反馈
              </button>
            </div>
          </div>
        </div>
      </UiActionsProvider>
      <DemoErrors demo={demo} />
      <div className="motion-rules">
        <div>
          <strong>等待</strong>
          <p>循环仅用于运行中的扫描和下载，暂停、失败、完成时停止活动指示。</p>
        </div>
        <div>
          <strong>进度</strong>
          <p>
            真实百分比来自业务状态；扫描活动轨道只表示仍在工作，不作为已完成数量。
          </p>
        </div>
        <div>
          <strong>完成</strong>
          <p>
            状态转绿并显示明确结果。通知示例保留到手动关闭；业务通知使用各自超时。
          </p>
        </div>
      </div>
      <h2 className="block-title">目录切换骨架</h2>
      <Frame reduced={reduced} narrow={narrow}>
        <DirectorySkeleton />
      </Frame>
      <Note>
        与真实目录过渡共用 DOM 结构和
        CSS；仅在示例容器展示，不覆盖宿主页面。减少动态效果时保留静态占位。
      </Note>
      <h2 className="block-title">依赖选择</h2>
      <p className="prose">
        使用已安装的 Motion 与 Lucide。Animate UI 和 Magic UI
        都需要按组件适配现有 CSS 与构建方式，本轮没有引入它们，也没有增加
        Tailwind、Radix 或第二套动画运行库。
      </p>
      <Source>
        {sourceNotes.page}
        <br />
        popup.css · src/ui/page-styles.ts
      </Source>
    </>
  );
}
const coverage = [
  [
    "基础规范",
    "popup.css / page-styles.ts",
    "颜色、文字、间距、圆角、图标、层级",
    "现有值 + 整理建议",
  ],
  [
    "任务与进度",
    "popup-components.tsx",
    "默认、加载、空、失败、禁用、长、窄屏、暂停、完成、停止",
    "业务已引用公共组件",
  ],
  [
    "页面下载",
    "page-components.tsx",
    "单文件夹、整页、批次、项目数、重复操作",
    "业务已引用公共组件",
  ],
  [
    "设置与网络",
    "popup-components.tsx",
    "加载、服务失败、锁定、长路径、提醒",
    "业务已引用公共组件",
  ],
  [
    "摘要与通知",
    "page-components.tsx",
    "展开、收起、空、完成、失败、服务断开",
    "业务已引用公共组件",
  ],
  [
    "诊断",
    "popup-components.tsx",
    "读取、发送中、发送结果、模拟复制",
    "业务已引用公共组件",
  ],
  [
    "下载业务样板",
    "design/demo.ts",
    "入队、推进、暂停、失败重试、停止、移除、重置",
    "仅内存模拟",
  ],
  [
    "动效",
    "page-components.tsx / popup.css",
    "等待、运行、完成、重播、减少动态效果",
    "沿用业务实现",
  ],
];
function Guide() {
  return (
    <>
      <Heading title="从可运行示例，到业务验收。">
        每个状态都说明来源；本地界面验证与真实下载链路分别记录。
      </Heading>
      <div className="guide-callout">
        <CheckCheck size={22} />
        <div>
          <strong>一份源码，两个运行入口</strong>
          <p>
            业务入口接 Chrome、POPO 与本机服务；Design
            入口接内存模拟器。公共组件只依赖显式传入的操作接口。
          </p>
        </div>
      </div>
      <h2 className="block-title">交付目录与实现状态</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>条目</th>
              <th>来源</th>
              <th>本地示例覆盖</th>
              <th>业务接入</th>
            </tr>
          </thead>
          <tbody>
            {coverage.map((row) => (
              <tr key={row[0]}>
                {row.map((v, i) => (
                  <td key={i}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2 className="block-title">验收分层</h2>
      <div className="status-matrix">
        <div>
          <strong>实现状态</strong>
          <span>共享组件已提取，所有目录均有本地示例</span>
        </div>
        <div>
          <strong>本地验收</strong>
          <span>以本次终端检查、交互验证和截图为证据；页面不自动宣称 PASS</span>
        </div>
        <div>
          <strong>业务接入</strong>
          <span>弹窗和注入页面已改为引用公共组件，真实接口保留</span>
        </div>
        <div>
          <strong>Windows Dev</strong>
          <span>需通过 Dev 同步、扩展重新加载和真实 POPO 操作验收</span>
        </div>
      </div>
      <h2 className="block-title">后续开发约定</h2>
      <ol className="guide-steps">
        <li>
          先找到目录中的相近组件，修改公共源码；不要在 Design 另写业务组件副本。
        </li>
        <li>
          先补示例状态与操作，再接业务数据。新增状态在 ui-model.ts
          保持统一解释。
        </li>
        <li>
          模拟器不导入 popup.tsx、page-ui.tsx 或后台入口，也不读写
          Chrome、IndexedDB 或真实文件。
        </li>
        <li>
          在默认、长内容、窄屏、键盘与减少动态效果下检查；适用时补加载、空、失败与禁用。
        </li>
        <li>
          记录本地通过证据；真实下载、文件夹选择器和诊断发送回到 Windows Dev
          验证。
        </li>
      </ol>
      <h2 className="block-title">已评估的组件来源</h2>
      <p className="prose">
        已有业务组件作为主来源。Impeccable 用于层级、状态、可访问性和窄屏审查。
        <a href="https://animate-ui.com/docs" target="_blank" rel="noreferrer">
          Animate UI <ArrowUpRight size={13} />
        </a>{" "}
        与{" "}
        <a href="https://magicui.design/docs" target="_blank" rel="noreferrer">
          Magic UI <ArrowUpRight size={13} />
        </a>{" "}
        暂未采用：当前已有 Motion，可满足本轮交互反馈，避免重复依赖。
      </p>
      <Note>
        本页面面向界面开发与设计审查，不会修改
        Stable、发布版本或改变用户下载记录。
      </Note>
    </>
  );
}
function App() {
  const getSection = (): Section =>
    sections.some((s) => s.id === location.hash.slice(1))
      ? (location.hash.slice(1) as Section)
      : "workbench";
  const [section, setSection] = useState<Section>(getSection);
  useEffect(() => {
    const listener = () => {
      if (sections.some((s) => s.id === location.hash.slice(1)))
        setSection(getSection());
    };
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);
  return (
    <>
      <style>
        {popupTokens}
        {designCss}
      </style>
      <a className="skip-link" href="#design-content">
        跳到内容
      </a>
      <aside className="sidebar">
        <a className="design-brand" href="#workbench">
          <img src="assets/popo-logo.svg" alt="POPO" width="36" height="36" />
          <span>
            POPO <strong>Design</strong>
          </span>
        </a>
        <p className="sidebar-intro">
          稳定下载助手
          <br />
          界面规范与交互样板
        </p>
        <nav aria-label="Design 目录">
          {sections.map(({ id, name, icon: Icon, detail }) => (
            <a
              key={id}
              href={`#${id}`}
              aria-current={section === id ? "page" : undefined}
            >
              <Icon size={18} />
              <span>
                {name}
                <small>{detail}</small>
              </span>
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" />
          本地设计工作台<small>React · TypeScript · Motion</small>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            POPO 下载助手 <span className="breadcrumb-separator">/</span>{" "}
            {sections.find((s) => s.id === section)?.name}
          </span>
          <span className="simulation">示例与真实数据隔离</span>
        </header>
        <main id="design-content" tabIndex={-1} key={section}>
          {section === "workbench" ? (
            <Workbench />
          ) : section === "foundations" ? (
            <Foundations />
          ) : section === "components" ? (
            <Components />
          ) : section === "motion" ? (
            <Motion />
          ) : (
            <Guide />
          )}
        </main>
        <footer className="page-footer">
          <span>POPO Design · 以项目源码为依据</span>
          <span>本地示例 ≠ 真实下载验收</span>
        </footer>
      </div>
    </>
  );
}
createRoot(document.getElementById("design-root")!).render(<App />);
