# 下载链路重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先扫完再下；目录汇总进度；页面面板直接重试；失败自动补一轮；准备步骤更快更稳；探明能否取得文件 ID。

**Architecture:** 保留现有后台队列、隐藏页面与 Gopeed。纯规则放 `src/`（TypeScript，经 `npm run build:runtime` 打入 `runtime/popo-runtime.cjs`），后台只接线。页面与弹窗共用 `src/ui/task-details.tsx`。

**Tech Stack:** Chrome MV3 + JavaScript + TypeScript + React + Zod + Gopeed。测试用 `node --test`，端到端用 Playwright。

**Spec:** [docs/specs/download-pipeline-redesign.md](../specs/download-pipeline-redesign.md)。前置：[download-recovery.md](../specs/download-recovery.md)（已实现，未提交）。

## Global Constraints

- 不新增依赖；不改 Native Host、Agent、安装器；不动 Stable；不 stage、不 commit、不 push（AGENTS.md）。
- 目录数量核对保持严格，不得放宽。
- 新文件必须带 L3 头：`[INPUT]`、`[OUTPUT]`、`[POS]`、`[PROTOCOL]: Update this header on change, then check AGENTS.md`。新增或改名文件后更新所在目录的 `AGENTS.md`。
- 每个文件 ≤800 行。`background.js` 已超限：只加接线，新逻辑放 `src/`。
- 常量值：目录汇总上限 200；准备连续失败上限 3、冷却 30 秒；自动补下最多 1 轮；诊断字段名最长 32 字符、结构深度 ≤4。
- 修改后：`npm run check`、`node --test tests/*.test.js`；Windows：`npm run verify:windows:remote`（同时同步固定 Dev 目录）。本机没有可用的 Playwright Chromium，端到端以 Windows 结果为准。

## Review Focus

1. 扫描队列空但定位队列仍有项时，不得提前下载（Task 1）。
2. 单项补下任务的扫描队列只有一项，先扫后下对它不得死锁（Task 1）。
3. 同目录复用时上一个文件失败，不得假定页面仍在目录（Task 6）。
4. 自动补下的任务自己失败，不得再自动补；批量任务中不得阻塞后续文件夹（Task 4）。
5. 诊断收到以文件名为键的对象或带地址的值，输出里不得出现它们（Task 7）。
6. 目录超过 200 个时，有问题的目录必须保留（Task 2）。

---

### Task 1: 先扫后下

**Files:**
- Modify: `src/workflow-machine.ts`（`choosePersistentWorkflowAction`）、`background.js`（`processPersistentWorkflowStep`）
- Test: `tests/runtime.test.js`、`tests/background-queue.test.js`

**Interfaces:**
- Produces: `choosePersistentWorkflowAction(input: { workflow: unknown; hasPending: boolean; hasPreparing: boolean; activeTransfers: number; concurrency: number; scanFinished: boolean }): "scan" | "handoff"`。`scanFinished` 为 false 且 `hasPreparing` 为 false 时一律返回 `"scan"`。

- [ ] **Step 1: 写失败测试。** `tests/runtime.test.js`：`workflow.choosePersistentWorkflowAction` 在 `nextAction: "handoff"`、`hasPending: true`、`scanFinished: false` 时返回 `"scan"`；`scanFinished: true` 时返回 `"handoff"`；`hasPreparing: true` 且 `scanFinished: false` 时返回 `"handoff"`。`tests/background-queue.test.js`：`先扫完再下：扫描队列清空前不处理待下载文件`——状态含 1 个待下载文件和 1 个扫描队列项，触发一次 pump，断言没有发出文件的 `OPEN_ITEM`，且 `SCAN_DIRECTORY` 已发出。
- [ ] **Step 2: 运行确认失败。** `node --test --test-name-pattern='先扫完再下|choosePersistentWorkflowAction' tests/runtime.test.js tests/background-queue.test.js`，预期 FAIL。
- [ ] **Step 3: 实现。** `src/workflow-machine.ts` 加 `scanFinished` 入参。`background.js` 的 `processPersistentWorkflowStep` 传 `scanFinished: state.scanQueue.length === 0 && state.resolveQueue.length === 0`；去掉其中无 `runtimeWorkflow` 时的回退分支对该条件的遗漏（回退分支同样加此条件）。
- [ ] **Step 4: 修正依赖旧交错行为的测试。** 全量运行 `node --test tests/*.test.js`；对因“扫描期间交付”而失败的用例（如“扫描未结束时可恢复已交付的 Gopeed 任务并继续保持扫描态”），把断言改为新契约，不删除其保护的恢复行为。
- [ ] **Step 5: 验证。** `npm run check && node --test tests/*.test.js`，预期 0 失败。

### Task 2: 目录汇总

**Files:**
- Create: `src/directory-summary.ts`
- Modify: `src/index.ts`（导出 `directorySummary`）、`src/ui-model.ts`（`QueueJob.directories`、`directoryProgressLabel`）、`background.js`（记录扫描结果、`syncActiveJobSummary` 写入 `job.directories`）、`src/AGENTS.md`
- Test: `tests/directory-summary.test.js`、`tests/ui-model.test.js`、`tests/background-queue.test.js`

**Interfaces:**
- Produces（`src/directory-summary.ts`）:
  ```ts
  export interface DirectoryScanRecord { path: string[]; expected: number | null; found: number; verified: boolean }
  export interface DirectorySummary { path: string[]; expected: number | null; found: number; success: number; failed: number; active: number; pending: number; status: "verified" | "unverified" | "failed" }
  export const MAX_DIRECTORY_SUMMARIES = 200;
  export function summarizeDirectories(scans: DirectoryScanRecord[], items: Array<{ directoryPath?: string[]; selected?: boolean; status: string }>, scanFailures: Array<{ path: string[] }>): DirectorySummary[]
  ```
- Produces（`src/ui-model.ts`）: `directoryProgressLabel(summary: DirectorySummary): string`；`QueueJob.directories?: DirectorySummary[]`。
- Produces（后台状态）: `state.directoryScans: DirectoryScanRecord[]`，在 `state.scanFailures` 被重置的每个位置一并重置。

- [ ] **Step 1: 写失败测试。** `tests/directory-summary.test.js`：①同一目录的 items 按 `directoryPath` 精确匹配计数，只统计 `selected`；②`scanFailures` 中的路径状态为 `failed`，`verified:false` 的为 `unverified`；③输入 250 个目录且 3 个有问题时，输出长度为 200 且 3 个问题目录都在其中并排在前面。`tests/ui-model.test.js`：`directoryProgressLabel` 对“预计 77、成功 77”返回含 `完成 77/77`，对 `failed` 返回含 `读取失败`，对 `unverified` 返回含 `未核对`。`tests/background-queue.test.js`：扫描一个目录（预计 2 项，返回 2 个文件）后，`GET_STATE` 的任务里 `directories[0]` 为 `{ expected: 2, found: 2, status: "verified" }`。
- [ ] **Step 2: 运行确认失败。** `node --test tests/directory-summary.test.js`，预期 FAIL（模块不存在）。
- [ ] **Step 3: 实现 `summarizeDirectories` 与 `directoryProgressLabel`，并在 `src/index.ts` 导出。** 排序：`failed`、`unverified` 在前，其余按扫描顺序。
- [ ] **Step 4: 后台接线。** `processScanStep` 目录读取成功后，用 `countCheck` 向 `state.directoryScans` 写入或替换同路径记录；`syncActiveJobSummary` 里 `job.directories = runtimeDirectorySummary.summarizeDirectories(state.directoryScans, state.items, state.scanFailures)`。重试任务只含本任务扫描到的目录。
- [ ] **Step 5: 验证。** `npm run check && node --test tests/*.test.js`，预期 0 失败。

### Task 3: 共享明细组件与页面面板

**Files:**
- Create: `src/ui/task-details.tsx`
- Modify: `src/ui/popup-components.tsx`（用共享组件替换内联失败明细）、`src/ui/page-components.tsx`（`QueueDock` 展开区）、`popup.css`、`src/page-ui.tsx`（`SHADOW_STYLES`）、`src/ui/AGENTS.md`
- Test: `tests/e2e/extension-recovery.spec.mjs`

**Interfaces:**
- Consumes: Task 2 的 `QueueJob.directories`、`directoryProgressLabel`；已有 `QueueJob.failureEntries`、命令 `RETRY_JOB_ITEM { jobId, failureId }`。
- Produces: `FailureList({ job, busy, onRetry }: { job: QueueJob; busy: boolean; onRetry: (failureId: string) => void })` 与 `DirectoryTree({ directories }: { directories: DirectorySummary[] })`；样式类前缀统一为 `popo-detail-`，在 `popup.css` 与 `SHADOW_STYLES` 各定义一份。

- [ ] **Step 1: 写失败的端到端测试。** `页面左下角面板展开后显示目录与失败项，并能单独重试`：注入含 `directories` 与 2 个 `failureEntries` 的失败任务；页面（沿用该文件已有的假 POPO 页面夹具）上展开面板，断言目录行与 2 个“重试”按钮可见；点第一个后，存储中出现 `retryOfJobId` 指向原任务的新任务，`retrySelection.id` 等于该失败项。已有的弹窗用例 `失败明细展示全部条目并能单独重试…` 必须仍通过。
- [ ] **Step 2: 实现共享组件。** `FailureList` 即现有弹窗失败明细的结构（折叠、路径两行截断、按钮在缺少 `url`/`route` 时禁用）。`DirectoryTree` 按 `path.length` 缩进，每行显示 `directoryProgressLabel`。弹窗 `TaskCard` 与页面 `QueueDock` 都使用它们；`QueueDock` 仅在任务有 `directories` 或 `failureEntries` 时渲染详情，默认折叠。
- [ ] **Step 3: 验证。** `npm run check`；`npm run build:design` 通过；Windows 端到端通过（见 Task 8）。

### Task 4: 失败后自动补一轮

**Files:**
- Modify: `src/download-recovery.ts`、`background.js`（抽出 `buildRetryJob`、`markAttemptFailure`、`finalizeActiveJob`、`DIAGNOSTIC_EVENT_CODES`）
- Test: `tests/download-recovery.test.js`、`tests/background-queue.test.js`

**Interfaces:**
- Produces: `FailureEntry.reason?: string`；`isAutoRetryable(entry: FailureEntry): boolean`（`reason` 为 `permission_denied` 或 `file_not_found` 时为 false，其余为 true）；`background.js` 中 `buildRetryJob(state, source, options: { failure?: FailureEntry; auto?: boolean }): QueueJob | null`，由 `retryJob` 与自动补下共用，`auto` 为 true 时任务带 `autoRetryRound: 1`，手动重试带 0。

- [ ] **Step 1: 写失败测试。** `download-recovery.test.js`：`isAutoRetryable` 对四种 `reason` 的返回值。`background-queue.test.js`：①`任务失败结束后自动补一轮`——含一个 `reason: "operation_failed"` 失败文件的任务以失败结束后，`state.jobs` 中出现 `retryOfJobId` 指向它且 `autoRetryRound === 1` 的任务，并带 `AUTO_RETRY_QUEUED` 事件；②`权限类失败不自动补`——`reason: "permission_denied"` 时没有新任务；③`自动补下任务自身失败后不再自动补`；④`批量任务中自动补下不阻塞后续文件夹`——同批次另有排队任务时，后续任务仍先于或紧随执行且不丢失。
- [ ] **Step 2: 运行确认失败。** `node --test --test-name-pattern='自动补|isAutoRetryable' tests/download-recovery.test.js tests/background-queue.test.js`。
- [ ] **Step 3: 实现。** `markAttemptFailure` 写 `item.failureReason = classifyRecoveryError(error)`，扫描失败条目同样写 `reason`；`syncActiveJobSummary` 生成的 `FailureEntry` 带上 `reason`。把 `retryJob` 中构造任务的部分抽成 `buildRetryJob`（无可重试项返回 null）。`finalizeActiveJob` 在 `setJobStatus` 之后、`state.activeJobId = null` 之前：状态为 `failed`、未取消、`!job.autoRetryRound`、且 `failureEntries` 含 `isAutoRetryable` 项时，`state.jobs.push(buildRetryJob(state, job, { auto: true }))`，并写 `AUTO_RETRY_QUEUED` 事件（加入 `DIAGNOSTIC_EVENT_CODES`）。
- [ ] **Step 4: 验证。** `npm run check && node --test tests/*.test.js`，预期 0 失败。

### Task 5: 连续失败冷却

**Files:**
- Modify: `background.js`（`markAttemptFailure`、`processDownloadStep`、常量区）
- Test: `tests/background-queue.test.js`

**Interfaces:**
- Produces: 常量 `PREPARE_FAILURE_STREAK_LIMIT = 3`、`PREPARE_COOLDOWN_MS = 30000`；状态字段 `state.prepareFailureStreak: number`、`state.prepareCooldownUntil: number`。

- [ ] **Step 1: 写失败测试。** `连续 3 次准备失败后冷却，且触发冷却的失败不消耗文件重试次数`：4 个待下载文件，worker 对 `OPEN_ITEM` 一律失败；依次触发 pump 到第 3 次失败后，断言 `prepareCooldownUntil > Date.now()`、第 3 个失败文件 `attempts` 回退为失败前的值、冷却期内再触发 pump 不再发出 `OPEN_ITEM`。`准备成功会清零连续失败计数`。`权限类失败不计入连续失败`。
- [ ] **Step 2: 运行确认失败。** `node --test --test-name-pattern='冷却|连续失败' tests/background-queue.test.js`。
- [ ] **Step 3: 实现。** 非权限类准备失败使 `prepareFailureStreak += 1`；达到上限时 `prepareCooldownUntil = Date.now() + PREPARE_COOLDOWN_MS`、计数清零，并把触发失败的文件 `attempts` 减 1。`processDownloadStep` 在选取文件前若处于冷却期则保存状态并 `schedulePump(Math.min(1000, 剩余毫秒))` 后返回。`beginDownload` 成功交付后清零计数。
- [ ] **Step 4: 验证。** `npm run check && node --test tests/*.test.js`，预期 0 失败。

### Task 6: 同目录复用

**Files:**
- Modify: `content.js`（新增消息 `RETURN_TO_DIRECTORY`）、`background.js`（`processDownloadStep` 准备段、`loadWorkUrl`、`registerWorkerFrame`、`waitForWorkerReconnect`）
- Test: `tests/background-queue.test.js`

**Interfaces:**
- Produces: 内容脚本消息 `{ type: "RETURN_TO_DIRECTORY", timeoutMs }`，执行 `history.back()` 并等待目录列表出现，返回 `{ url, directoryName }`；状态字段 `state.workerAtDirectoryKey: string | null`；`directoryRouteKey(item): string`（`JSON.stringify([item.rootUrl, item.directoryRoute, item.parentUrl])`）。

- [ ] **Step 1: 写失败测试。** `同一目录的下一个文件复用目录页，不重新加载`：两个文件同目录，断言只发出 1 次 `NAVIGATE_WORKER` 与 1 次 `RETURN_TO_DIRECTORY`。`返回后目录名不符时回退完整加载`。`上一个文件失败后下一个文件做完整加载`。
- [ ] **Step 2: 运行确认失败。** `node --test --test-name-pattern='同一目录|返回后目录名|上一个文件失败后' tests/background-queue.test.js`。
- [ ] **Step 3: 实现。** 仅 `triggerMode === "folder_button"` 启用。准备开始时 `state.workerAtDirectoryKey = null`；`waitForPreview` 成功后置为该文件的 `directoryRouteKey`。下一个文件若 key 相同，先发 `RETURN_TO_DIRECTORY`，再用 `getWorkDirectoryContext` 核对 `directoryName` 等于 `item.directoryPath.at(-1)`；核对失败或抛出非页面中断错误时回退 `openDirectory`。`loadWorkUrl`、`registerWorkerFrame`、`waitForWorkerReconnect` 中清空该字段。
- [ ] **Step 4: 验证。** `npm run check && node --test tests/*.test.js`，预期 0 失败。

### Task 7: 页面结构只读诊断

**Files:**
- Create: `src/page-probe.ts`
- Modify: `page-api.js`（观察 `fetch` 与 `XMLHttpRequest` 的 JSON 响应结构）、`content.js`（收集行属性名并上报）、`src/contracts.ts`、`core.js`（新命令校验）、`background.js`（存储与读取）、`src/ui/popup-components.tsx`（“复制页面结构诊断”按钮）、`src/index.ts`、`src/AGENTS.md`
- Test: `tests/page-probe.test.js`、`tests/runtime.test.js`

**Interfaces:**
- Produces（`src/page-probe.ts`）:
  ```ts
  export interface ProbeReport { apis: Array<{ method: string; path: string; status: number; shape: unknown }>; rows: { attributeNames: string[]; hasPageDetailLink: boolean } }
  export function sanitizeProbeReport(value: unknown): ProbeReport
  ```
  规则：`shape` 里值只保留类型名（`string|number|boolean|null|object|array`）；对象键不符合 `/^[A-Za-z_][A-Za-z0-9_]{0,31}$/` 时记为 `"<key>"`；深度 >4 截断；`path` 中长度 ≥16 的段记为 `:id`；`apis` 最多 20 条，`attributeNames` 最多 40 个。
- Produces（命令）: `PAGE_PROBE_REPORT { report }`（仅内容脚本发送，后台用 `sanitizeProbeReport` 再次清洗后写入 `popoPageProbe`）；`GET_PAGE_PROBE`（弹窗读取）。命令校验沿用现有命令的 Zod 严格模式写法。

- [ ] **Step 1: 写失败测试。** `tests/page-probe.test.js`：`sanitizeProbeReport` 对含 `"icon_bubble_a.png": {...}` 键、含 `https://…?token=x` 值、路径含 32 位十六进制段的敌意输入，输出序列化后不含 `icon_bubble`、`https`、`token`、该十六进制串；深度 6 的对象被截断到 4；`apis` 超过 20 条被截断。`tests/runtime.test.js`：`parseRuntimeCommand` 接受合法 `PAGE_PROBE_REPORT`，拒绝带多余字段的。
- [ ] **Step 2: 运行确认失败。** `node --test tests/page-probe.test.js`。
- [ ] **Step 3: 实现清洗函数、命令契约与后台存取。** `page-api.js` 在 MAIN 世界包装 `fetch` 与 `XMLHttpRequest`，只对同源 `/api/` 路径的 JSON 响应生成类型结构，通过自定义事件交给内容脚本（沿用已有的 `popo-stable-download:*` 事件通道）；`content.js` 在一次目录扫描结束后收集前 3 个行元素及其后代的属性名与是否含指向 `pageDetail` 的链接，连同接口结构一次上报，最多每 60 秒一次。
- [ ] **Step 4: 弹窗按钮。** “诊断与回传”增加“复制页面结构诊断”，读取 `GET_PAGE_PROBE` 并复制 JSON。
- [ ] **Step 5: 验证。** `npm run check && node --test tests/*.test.js`，预期 0 失败。

### Task 8: 文档、Windows 验证与 Dev 同步

**Files:**
- Modify: `src/AGENTS.md`、`src/ui/AGENTS.md`、`docs/specs/download-pipeline-redesign.md`（状态改为已实现并记录偏差）、`docs/verification/download-recovery-verification.md`（新增 AC 行）

- [ ] **Step 1: 全量本地检查。** `npm run check && node --test tests/*.test.js`，预期 0 失败。
- [ ] **Step 2: Windows 完整验证并同步。** `npm run verify:windows:remote`，预期输出 `WINDOWS TESTS: PASS`、`DEV SYNC: PASS`。
- [ ] **Step 3: 记录验证。** 把批次号、通过数量、同步时间写入验证记录；真实 POPO 效果（同目录复用是否加速、诊断内容）标 `NOT VERIFIED` 直到用户现场确认。
- [ ] **Step 4: 通知用户。** 请用户重载“POPO Dev 下载助手”、刷新 POPO 页面，并跑一次大文件夹，再点“复制页面结构诊断”把结果发回。

## Self-Review

- 规格覆盖：G1、G2 → Task 1、2；G3 → Task 2、3；G4 → Task 5、6；G5 → Task 4；诊断 → Task 7；AC8 → Task 8。
- 类型一致：`DirectorySummary` 在 Task 2 定义、Task 3 使用；`FailureEntry.reason` 在 Task 4 定义，`buildRetryJob` 在 Task 4 定义并在 `retryJob` 中复用。
