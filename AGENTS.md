# POPO repository working agreements

## 源码导航

Chrome MV3 + TypeScript + React + Gopeed。依赖版本以 package-lock.json 为准。

- 根目录 background.js：队列、扫描、交付与恢复；content.js/page-api.js：POPO 页面读取；core.js/queue.js/gopeed.js：纯规则与引擎适配。
- src/：运行包、存储与 UI，见 src/AGENTS.md。
- tests/：Node 与 Playwright 隔离回归；scripts/：构建、固定 Dev 同步和 Windows 验证。
- native-host/、agent/、setup/、bootstrapper/：Windows 本机组件。
- docs/specs/、docs/plans/、docs/tasks/、docs/verification/：当前开发需求、实施任务与验收证据。
- assets/、vendor/：图标与固定上游源码；runtime/、dist/、output/：生成或本地验证产物。

## Extension development and test boundary

- The Git working tree is the only source of truth for Extension code.
- The fixed Dev test output is `D:\POPO\Dev\POPODevDownloader\Extension`.
- The fixed Stable reference is `D:\POPO\Stable\POPOStableDownloader\Extension` and is read-only. Never modify, overwrite, synchronize, or clean it without an explicit release instruction.
- After changing Extension source, run the relevant tests, run `npm run dev:extension:sync`, verify the Dev manifest and extension identity, then ask the user to reload “POPO Dev 下载助手” in Chrome and refresh the POPO page.
- Ordinary Extension JavaScript, CSS, and HTML changes do not require rebuilding an installer.
- Rebuild a Dev package or installer only for Native Host, Agent, installer, registration/configuration, or final release acceptance work.
- Do not stage, commit, push, tag, release, or modify Stable unless the user explicitly authorizes that exact action.
