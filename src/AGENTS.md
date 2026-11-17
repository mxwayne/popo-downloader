# src/
> L2 | Parent: ../AGENTS.md

api-scan.ts: POPO 目录接口响应解析（只信任数量一致且无下一页的结果）、同名文件夹判定与目录地址拼装。
contracts.ts: Zod 运行时输入与 Gopeed 响应契约。
diagnostics.ts: Sentry 脱敏事件与传输停滞观察。
directory-summary.ts: 每个目录的预计数、实际数、核对状态与文件状态汇总，上限 200。
download-recovery.ts: 单项补下的定位类型、累计失败汇总、自动补下判定与准备连续失败冷却规则。
gopeed-sdk.ts: 官方 SDK 适配与响应校验。
index.ts: 后台运行包导出入口。
network-monitor.ts: 网络故障与提醒状态计算。
page-probe.ts: 页面结构诊断的唯一清洗入口，只保留字段名与类型名。
page-ui.tsx: Chrome 页面 UI 适配入口。
popup.tsx: Chrome 弹窗适配入口。
task-store.ts: IndexedDB 文件分块、操作预约与诊断队列。
ui-model.ts: 页面与弹窗共享的任务展示规则。
workflow-machine.ts: XState 扫描与传输工作流。
ui/: 共享组件与操作适配契约，见 ui/AGENTS.md。
design/: 隔离模拟预览，见 ../docs/DESIGN.md。

[PROTOCOL]: Update this header on change, then check AGENTS.md
