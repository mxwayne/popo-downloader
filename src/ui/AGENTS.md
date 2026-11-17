# src/ui/
> L2 | Parent: ../AGENTS.md

actions.tsx: 显式注入 Chrome 或模拟操作，不隐式调用浏览器。
directory-skeleton.ts: 目录切换时的骨架 DOM 工厂。
page-components.tsx: 页面下载按钮、任务摘要与通知。
page-styles.ts: 页面 Shadow DOM 样式。
popup-components.tsx: 完整任务操作、服务设置与诊断（含复制页面结构诊断）。
task-details.tsx: 弹窗与页面面板共用的目录进度与失败明细，只通过 onRetry 回调交出操作。

[PROTOCOL]: Update this header on change, then check AGENTS.md
