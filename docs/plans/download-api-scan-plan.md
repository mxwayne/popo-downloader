# 下载链路阶段二 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** 用 POPO 目录接口扫描、用文件 ID 取址；任何不确定回退到页面流程。

**Architecture:** 纯解析规则放 `src/api-scan.ts`；`page-api.js`（MAIN 世界）新增白名单 POST；后台在 `processScanStep` 前插入接口扫描分支，在 `processDownloadStep` 准备段插入按 ID 取址分支。两处失败都回退，不放宽数量核对。

**Spec:** [download-api-scan.md](../specs/download-api-scan.md)

## Global Constraints

- 不新增依赖；不改 Native Host、Agent、安装器；不动 Stable；不 stage、commit、push。
- 新文件带 L3 头；新增文件后更新所在目录 `AGENTS.md`。
- `background.js` 已超限：只加接线，规则放 `src/`。
- 诊断只记数字与枚举：`more`（0/1）、`total`、`length`、回退原因枚举。
- 验证：`npm run check`、`node --test tests/*.test.js`、`npx playwright test`、`npm run verify:windows:remote`。

## Review Focus

1. 接口扫描中途某目录失败，已扫目录的文件不丢，失败目录转页面扫描。
2. 单文件重试（`retrySelection`）在接口条目与页面条目混合时仍能找到目标。
3. 请求体只含模板字段：调用方多余字段、路径、方法被拒绝。
4. 同名文件夹、`more` 为 true、`length !== total`、业务码异常都回退。
5. 取址权限失败（401/403/405）不回退、不自动重试。

### Task 1: 纯解析规则 `src/api-scan.ts`

- Create: `src/api-scan.ts`；Modify: `src/index.ts`；Test: `tests/api-scan.test.js`
- Produces:
  ```ts
  export const FOLDER_PAGE_TYPE = 0;
  export type FolderListResult =
    | { ok: true; total: number; folders: ApiFolder[]; files: ApiFile[] }
    | { ok: false; reason: "business_error" | "bad_shape" | "more" | "count_mismatch"; more: number; total: number; length: number };
  export interface ApiFolder { pageId: string; name: string; pageMajorVersion: number }
  export interface ApiFile { pageId: string; name: string; size: number }
  export function parseFolderSubList(body: unknown): FolderListResult;
  export function pageUrlFor(rootUrl: string, pageId: string): string;   // 把 pageDetail/<id> 换成目标 id
  export function findChildFolder(result: FolderListResult, name: string): ApiFolder | null; // 同名不唯一返回 null
  ```
- [ ] 测试（先红）：正常响应分出文件夹与文件；`more:true` → `more`；`pageList.length !== total` → `count_mismatch`；`status` 为数字且不是 0 或 200 → `business_error`；缺 `pageList` → `bad_shape`；`pageUrlFor` 只替换 `pageDetail/<id>`；`findChildFolder` 同名两个返回 null。
- [ ] 实现并通过。

### Task 2: 接口桥（page-api.js + content.js）

- Modify: `page-api.js`、`content.js`；Test: `tests/e2e/extension-recovery.spec.mjs`
- Produces: 内容脚本消息 `{ type: "LIST_FOLDER", teamSpaceId, pageId, pageMajorVersion?, timeoutMs }` → `{ ok, status, body }`。页面脚本只放行 `POST /api/bs-team-space/web/v1/page/folderSubList`，请求体由模板拼成：`pageId`、`teamSpaceId` 取调用方字符串；`folderPriority`、`sortField`、`isAsc`、`pageMajorVersion` 取页面自己最近一次同接口请求的值（包装 fetch/XHR 时记录，只记 number/boolean 字段）；没有记录时返回 `{ ok: false, status: 0, error: "no_template" }`。
- [ ] 测试（先红）：假页面先自己发一次 folderSubList（带数字字段），再通过桥调用，路由处理器收到的请求体恰好是模板字段，值来自页面那次请求；调用方多传字段、改路径、改方法被拒（403）；没有页面请求时返回 `no_template`。
- [ ] 实现并通过。

### Task 3: 后台接口扫描

- Modify: `background.js`（`processScanStep` 前的分支、`DEFAULT_SETTINGS.useApiScan`、`DIAGNOSTIC_EVENT_CODES`）、`core.js`、`src/contracts.ts`（设置项 `useApiScan: boolean`）；Test: `tests/background-queue.test.js`
- Produces: 状态字段 `state.apiScanQueue: Array<{ pageId, path, pageMajorVersion, url }>`、`state.apiScanDisabled: boolean`；条目字段 `item.pageId`。接口条目：`itemIndex: ""`，`id = discoveredItemId(dirUrl, directoryPath, pageId, name)`，`parentUrl = dirUrl`，`rootUrl`，`directoryRoute = 累计 {name,itemIndex:""}`，`directoryDirect: true`。
- 规则：`page` 范围任务以 `pageDetailId(parentUrl)` 为根目录 ID；`folder` 范围任务用父目录列表按 `pageName` 找子文件夹，找不到或不唯一整体回退（保留原 `resolveQueue`）；补下任务仅当 `entry.url` 的 pageId 不同于 rootUrl 时用接口。每个目录要求 `parseFolderSubList` 成功；失败则该目录以 `{url, path, rootUrl, route, direct:true}` 追加到 `scanQueue`（页面扫描），并写 `API_SCAN_FALLBACK` 事件（只含数字与枚举）。`retrySelection` 的文件目标除 id 外也按“名称 + 目录路径”匹配。
- [ ] 测试（先红）：①接口扫描两层目录，条目带 `pageId` 且 `directoryScans` 的预计数等于 `total`、全程没有 `OPEN_ITEM`/`SCAN_DIRECTORY`；②某子目录 `more:true` 时该目录转页面扫描、其余条目保留；③同名文件夹整体回退；④`useApiScan:false` 完全走页面流程；⑤补下任务按“名称 + 路径”找到目标。
- [ ] 实现并通过。

### Task 4: 按文件 ID 取址

- Modify: `background.js`（`processDownloadStep` 准备段）；Test: `tests/background-queue.test.js`
- Rule: 条目有 `pageId`、`useApiScan` 开启且 `!item.apiFallback` 时，先 `requestDirectDownloadUrl(state, item.pageId)`；成功直接 `beginDownload`，不发 `NAVIGATE_WORKER`/`OPEN_ITEM`/`GET_PREVIEW_INFO`。权限类错误与页面中断照常上抛；其余错误置 `item.apiFallback = true`，同一次尝试继续走页面流程。
- [ ] 测试（先红）：①有 `pageId` 的文件准备时只发 `REQUEST_DIRECT_DOWNLOAD`；②取址返回空时回退页面流程并成功；③405 直接标记权限失败且不回退；④`apiFallback` 的文件下次不再走接口。
- [ ] 实现并通过。

### Task 5: 收尾

- 设置页开关（若弹窗设置区已有同类复选框则加，否则只保留存储开关并在规格里注明）；更新 `src/AGENTS.md`、规格状态、验证记录；`npm run check && node --test && npx playwright test`；`npm run verify:windows:remote`；一次独立整体评审；修复 Critical 与 Important。

## Self-Review

规格覆盖：G1 → Task 1、3；G2 → Task 2、4；G3 → Task 3、4；AC5 → Task 2；AC6 → Task 3（诊断事件）。类型一致：`FolderListResult`、`ApiFolder` 在 Task 1 定义，Task 3 使用。
