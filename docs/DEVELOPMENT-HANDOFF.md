# POPO 开发接手说明

## 项目收尾状态（2026-11-25）

原维护人于 2026-11-25 停止维护本项目。本节记录停止时的状态，供后续接手人使用。

- 最后正式版：`v0.8.4`（2026-11-18），源码提交 `ffd9655`。
- `Publish stable release` 工作流对 `v0.8.4` 运行成功。GitHub Release 与腾讯云 `stable/latest.json` 均指向 0.8.4。
- 收尾时 `main` 与 `origin/main` 一致。没有未提交改动、其他分支、stash、未合并 PR 或未关闭 issue。
- 2026-11-25 在 macOS 上运行 `npm run check:full`，结果通过：
  - Node 测试 344 项：300 项通过，44 项按平台条件跳过，0 项失败。
  - Playwright 测试 17 项：16 项通过，1 项跳过，0 项失败。
- 变更历史见 [CHANGELOG.md](../CHANGELOG.md)。正式发布流程见 [RELEASING.md](RELEASING.md)。

### 未完成事项

- 下载恢复 T5 缺现场证据（见 [download-recovery-tasks.md](tasks/download-recovery-tasks.md)）。需要的证据：真实 POPO 页面的失败素材已恢复，Windows 实际落盘完整，Sentry 原事件已核对。0.8.0 已带上对应代码和自动测试，只缺现场验收。

### 停止维护后的外部服务

腾讯云 COS 与 Sentry 属于原维护人个人账号。停止维护后两者断开，不交接。

- 腾讯云断开后，0.8.1 及以后的客户端只能从 GitHub 备用源更新。0.8.0 及更早的客户端不再收到更新。
- Sentry 断开后，客户端的诊断回传不再有人接收。
- GitHub 仓库 `mxwayne/popo-downloader` 是唯一剩下的更新源。客户端写死了这个路径，每一跳重定向都必须在 `/mxwayne/popo-downloader/` 下（见 [update-github-source.md](specs/update-github-source.md)）。删除、改名或转移仓库都会切断所有客户端的更新。

### 恢复发布的前提

接手人要发布新版，必须先满足以下条件：

- 拥有 GitHub 仓库的管理权限，Actions secrets 与 variables 的清单见 [RELEASING.md](RELEASING.md)「首次启用」。
- 拿到签名私钥 `POPO_RELEASE_SIGNING_KEY_BASE64` 的原件。GitHub secret 写入后不能读出，必须另行交付原件。已安装的客户端内置对应公钥（`native-host/FolderPickerHost.cs`）。原件丢失后，现有客户端不再接受任何新版本。
- 修改发布流程：去掉腾讯云上传和 `stable/latest.json` 切换（`.github/workflows/publish-stable.yml`），或者换成新的 COS 桶。新桶只对新版客户端有效。
- 修改 Stable 构建：去掉 `POPO_DIAGNOSTIC_DSN` 的必填检查（`scripts/build-test-package.ps1`、`scripts/build-runtime.mjs`），或者配置新的 Sentry DSN。
- 拥有一台 Windows 验证机。原验证机的 SSH 别名是 `edy-main`。

## 接手基线

- 工作分支：`main`。
- 当前基线以 `git rev-parse HEAD` 为准。最后正式版的源码基线见上文「项目收尾状态」。
- 历史记录：2026-08-28 开发从 Windows 迁到 macOS，当时的源码基线是 `4e3c229bd60dd46b82e760586f8c3d1abfe4d552`。

## 依赖与环境

- 依赖锁文件：`package-lock.json`，使用 `npm ci` 安装。
- Windows 收口验证环境：Node.js `v24.18.0`、npm `11.16.0`、pnpm `11.18.0`、Windows PowerShell `5.1.22621.4391`。
- 项目实际依赖管理使用 npm；pnpm 不是本仓库安装或验证的必要条件。
- CI 的正式发布工作流使用 Node.js 24。Mac 应使用 Node.js 24，并保留 `package-lock.json` 的锁定结果。

Mac 首次接手建议依次运行：

```bash
npm ci
npm run check
npm test
npm run test:e2e
```

`npm run check:full` 等价于依次执行检查、Node 测试和 Playwright 测试，也可用于一次性基础验收。平台限定测试在非 Windows 环境应按测试自身条件跳过；若出现非预期失败，停止并保留完整输出，不要为了通过测试替换 Windows 工具链。

Windows 收口验证结果（2026-08-28）：`npm run check:full` 通过。其中 Node 测试共 215 项，214 项通过；1 项需要显式启用的真实登录计划任务验收按预期跳过。Playwright 7 项全部通过。此次迁移没有构建 Dev/Stable 安装包，也没有启动发布流程。

## Windows 专属工作

以下工作继续在 Windows 机器完成，不迁到 Mac：

- Native Host、Agent、安装器、Bootstrapper 和 Dev/Stable 安装包的编译、构建与验证。
- 安装、覆盖升级、修复、迁移、回滚、计划任务、注册表和 Native Messaging 注册验收。
- 包内 Gopeed 联动、真实 POPO 页面下载、真实 Windows 文件夹选择器和 Windows 路径边界验收。
- `npm run dev:extension:sync`；该命令固定同步到 Windows Dev 测试目录。
- `npm run build:dev-package`、发布候选安装验收及正式发布相关命令。

普通 Extension JavaScript、CSS 或 HTML 修改不需要重建安装器。修改后先在仓库运行相关测试，再由 Windows 执行 `npm run dev:extension:sync`，确认 Dev manifest 和扩展身份，然后在 Chrome 重新加载“POPO Dev 下载助手”并刷新 POPO 页面。

## Mac 到 Windows 的日常验证

普通分支和 Pull Request 由 `.github/workflows/windows-validation.yml` 在隔离的 `windows-latest` runner 上执行完整测试、构建 Dev 包并上传短期测试产物。该流程不读取发布密钥、不生成 Stable 包，也不更新腾讯云通道。

Mac 可以把当前 Git 基线、未提交的 tracked 修改和未忽略的 untracked 文件发送到隔离 Windows Git 工作树，无需先提交或推送：

```bash
npm run verify:windows:remote
```

默认通过 SSH 主机 `edy-main`，只在 `/d/POPO/Validation/POPODevValidation` 下创建临时验证工作树。已存在于 `origin` 的基线由 Windows 直接读取，只通过 SSH 流式发送当前补丁和未跟踪文件；未推送的本地提交会自动改用 Git bundle，不依赖 SCP。Windows 验证依次执行 `npm ci`、安装/确认 Playwright Chromium、`npm run check:full:windows`，其中 Node 测试串行执行以避免多个 Agent/安装器进程测试争用；成功后调用现有 `npm run dev:extension:sync`，其目标仍固定为 `D:\POPO\Dev\POPODevDownloader\Extension`。成功的临时工作树会删除；失败现场保留在远端输出所示目录用于诊断。

只验证 Windows 自动测试、不写入 Dev Extension 目录时使用：

```bash
npm run verify:windows:remote -- --no-sync
```

如 SSH 别名或隔离盘符不同，可设置 `POPO_WINDOWS_HOST` 和 `POPO_WINDOWS_REMOTE_ROOT`；远端根目录必须位于某个盘符下且名称严格为 `POPODevValidation`。脚本不会访问 Stable 目录。同步成功后，仍需用户在 Chrome 重新加载“POPO Dev 下载助手”并刷新 POPO 页面；真实下载、文件夹选择器、安装/更新/回滚继续作为 Windows 现场验收项。

## 当前边界与停止条件

- 当前没有已知的跨平台源码迁移阻断。
- 安装候选路径过长问题已在当前基线修复并补充回归测试，不再作为当前阻断。
- Native Host/Agent/安装器当前仍依赖 Windows 自带的 .NET Framework 编译器。先前评估的固定 `Microsoft.Net.Compilers.Toolset 5.9.0` 候选没有通过官方 Native Host 的 PE/IL 一致性 Gate F，因此不是获准替代工具链；Mac 不应自行替换编译器或绕过该 Gate。
- 本轮迁移不执行发布、不打 Tag、不修改腾讯云文件，也不删除或清理 Windows 仓库、正式安装和测试环境。
- Mac 如果存在未提交改动、出现 detached HEAD、冲突或与远端发生不明分叉，应立即停止；不要自动 stash、强制重置或删除内容。
- Windows 专属现场验收不是 Mac 基础接手的通过条件，但相关改动在交付前仍必须回到 Windows 完成对应验证。

## Windows 现场测试说明

- Extension 源码以 Git 工作树为唯一来源。
- Dev 扩展和 Stable 扩展必须保持隔离；不得把 Dev 内容覆盖到 Stable 安装目录。
- 真实页面验收前，先完成相关自动测试和 Dev 同步，再由用户在 Chrome 手动重新加载 Dev 扩展并刷新 POPO 页面。
- Native Host、Agent、安装器或注册配置发生变化时才重建 Dev 包；最终发布验收前才执行 Stable 发布流程。
