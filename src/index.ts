/**
 * [INPUT]: 依赖 src 的接口扫描、契约、诊断、目录汇总、恢复、页面诊断、SDK、存储、工作流与 UI 规则。
 * [OUTPUT]: 导出 PopoRuntime 构建命名空间。
 * [POS]: 后台与测试共用的 TypeScript 运行包入口。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import * as apiScan from "./api-scan";
import * as contracts from "./contracts";
import * as diagnostics from "./diagnostics";
import * as directorySummary from "./directory-summary";
import * as downloadRecovery from "./download-recovery";
import * as gopeed from "./gopeed-sdk";
import * as networkMonitor from "./network-monitor";
import * as pageProbe from "./page-probe";
import * as taskStore from "./task-store";
import * as uiModel from "./ui-model";
import * as workflow from "./workflow-machine";

export { apiScan, contracts, diagnostics, directorySummary, downloadRecovery, gopeed, networkMonitor, pageProbe, taskStore, uiModel, workflow };
