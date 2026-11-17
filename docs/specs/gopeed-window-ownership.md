# Gopeed 窗口归属：不抢前台、不被重复拉起

状态：已实现（随 0.8.2 发布），待 Windows 现场验收。

## 现象

点击扩展后，Gopeed 窗口跳到前台并抢走键盘与鼠标焦点；用户点 X 关闭后，下一次点击又弹出来。用户要求 Gopeed 只在后台运行，需要时才由用户自己打开。

## 根因（2026-11-17 现场取证）

- Gopeed 的 Windows 入口（`ui/flutter/windows/runner/main.cpp`）按窗口类 `FLUTTER_RUNNER_WIN32_WINDOW` 与标题 `gopeed` 做全局单实例：再启动一个 `gopeed.exe`，它不启动自己，而是 `ShowWindow` + `SetForegroundWindow` 把已有窗口（包括在托盘里隐藏的）调到前台，然后退出。`--hidden` 只管自己的首次显示，管不到这条路径。
- 本机助手的 `ensure_gopeed` 在“自己目录下的 Gopeed 没在运行”时无条件启动 `gopeed.exe --hidden`。
- 现场：运行中的是 Dev 的 Gopeed，Stable 的 Gopeed 不在运行；Stable 扩展每次检查连接都拉起一个新的 `gopeed.exe`，它把 Dev 的窗口调到前台。同一台机器上装了官方 Gopeed 或另一份 POPO 也会如此。

## 规则

1. 启动 `gopeed.exe` 前，先用与 Gopeed 入口相同的类名和标题查找窗口。
2. 窗口属于别的程序（路径与内置 Gopeed 不同或读不到）：不启动，返回 `ok=false`、`foreignGopeed=true`，错误文本写明占用者路径并提示在托盘退出它。
3. 窗口属于内置 Gopeed 自己，或没有窗口：照旧。
4. 扩展原样显示该文本，不再加“内置 Gopeed 启动失败”前缀。

## 不做

- 不修改 Gopeed 窗口标题让两份 Gopeed 共存（要改补丁并重编 Gopeed，另议）。因此 Dev 与 Stable 的 Gopeed 仍不能同时运行；Stable 会提示 Dev 的 Gopeed 占用了窗口。
- 不强行结束别人的 Gopeed 进程。

## 验证

- `tests/gopeed-foreign-window.test.js`（Windows）：假窗口使用同一窗口类与标题；检测函数三种结果；真实 `ensure_gopeed` 在别人窗口存在时不启动 gopeed.exe。守卫失效时该测试失败（已验证）。
- `tests/background-load.test.js`：扩展原样显示占用提示。
