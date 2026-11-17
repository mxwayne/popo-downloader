# 下载恢复实施计划

**Goal:** 目录短暂错误自动恢复，失败项可逐项补下。
**Architecture:** 保留队列调度与 Gopeed 传输。新增小型恢复模块计算失败定位及部分重试汇总，后台持久化失败条目，弹窗调用严格校验的单项命令。
**Tech Stack:** Chrome MV3 + JavaScript + TypeScript + React + Gopeed。
**Spec:** [download-recovery.md](../specs/download-recovery.md)。

## 约束与回退

- 不新增依赖、不改 Native Host/Agent/安装器，不提交或发布。
- 原目录结构、数量核对、原有去重与工作区恢复继续有效。
- 新字段为可选字段；旧任务继续使用整任务重试。
- 修改前 clean，HEAD `c37e2a9`。源码备份 `/tmp/popo-download-recovery-baseline-c37e2a9.tgz`。回退仅恢复本次文件，不使用 reset/clean。

## 实施顺序

1. 在 `tests/background-queue.test.js` 先复现普通扫描异常直接遗漏。在 `background.js` 补 2 次自动重试和终止诊断。（AC1、AC5）
2. `src/download-recovery.ts` 导出失败定位、部分重试汇总。`src/index.ts` 接入运行包；后台持久化 `failureEntries`，`RETRY_JOB_ITEM { jobId, failureId }` 只接受原任务已存失败。原父目录与 route 定位，不信任 UI 传入路径。（AC2–AC4）
3. `src/ui-model.ts` 添加失败条目类型，`src/contracts.ts` 与 `core.js` 校验命令；`src/ui/popup-components.tsx` 与 `popup.css` 增加可折叠明细和单项重试。每个单项任务继承其余失败和成功计数；目录重扫扣除该目录已有计数后合并新结果；未找到目标保持失败。`queue.js` 保留取消恢复前的失败，并防止旧任务反向隐藏新重试结果。（AC2–AC4）
4. Node 复现与回归；Playwright 用隔离扩展验证明细、点击、去重、窄屏与截图。运行 `check:full`、`build:design`。（AC1–AC6）
5. `verify:windows:remote` 将当前未提交源码发至独立验证工作树，完整测试后调用 `dev:extension:sync`。核对 Dev manifest、ID、同步标记；用户重载 Dev 后真实下载验收。（AC6）

6. `background.js` 的 `markAttemptFailure` 写入 `retryNotBefore`；`selectedPendingItem` 把退避中的文件排在可立即处理的文件之后；`processDownloadStep` 在全部文件退避时等待而不结束任务。（AC7）

## 审查重点

目标消失、同名不同目录、只重试一个但其他失败仍存在、目录恢复发现新失败、旧任务无定位、页面断开和重试中重复点击。测试必须覆盖这些边界；真实服务不可用时记录 NOT VERIFIED。
