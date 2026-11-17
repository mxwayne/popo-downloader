"use strict";

// Windows 专属：别人的 Gopeed 窗口在运行时，本机助手不能再启动 gopeed.exe。
// 原因：Gopeed 入口按窗口标题做全局单实例，再启动一个会把已有窗口（含托盘里隐藏的）显示并抢到前台。
// 其他平台没有 .NET Framework 编译器，整体跳过。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const repoRoot = path.join(__dirname, "..");
const compiler = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
const WINDOW_TITLE = "popo-test-gopeed-window";

// 假的 Gopeed 窗口：注册与 Gopeed 入口相同的窗口类，创建一个不可见的顶层窗口（与托盘里隐藏的 Gopeed 一致）。
const WINDOW_SENTINEL = `
using System;
using System.IO;
using System.Runtime.InteropServices;
static class Sentinel {
  delegate IntPtr WndProc(IntPtr h, uint m, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct WNDCLASS { public uint style; public WndProc proc; public int clsExtra, wndExtra; public IntPtr instance, icon, cursor, background; public string menu, className; }
  [StructLayout(LayoutKind.Sequential)]
  struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam, lParam; public uint time; public int x, y; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern ushort RegisterClass(ref WNDCLASS c);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint ex, string cls, string title, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr DefWindowProc(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern int GetMessage(out MSG m, IntPtr h, uint a, uint b);
  [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG m);
  [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG m);
  static WndProc keep = DefWindowProc;
  static int Main(string[] args) {
    WNDCLASS c = new WNDCLASS();
    c.proc = keep;
    c.className = "FLUTTER_RUNNER_WIN32_WINDOW";
    if (RegisterClass(ref c) == 0) return 2;
    IntPtr w = CreateWindowEx(0, c.className, args[0], 0, 0, 0, 10, 10, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
    if (w == IntPtr.Zero) return 3;
    File.WriteAllText(args[1], "ready");
    MSG m;
    while (GetMessage(out m, IntPtr.Zero, 0, 0) > 0) { TranslateMessage(ref m); DispatchMessage(ref m); }
    return 0;
  }
}`;

// 假的 gopeed.exe：只记录“被启动过”。
const LAUNCH_RECORDER = `
using System;
using System.IO;
using System.Threading;
static class Recorder {
  static void Main() {
    File.WriteAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "launched.txt"), "launched");
    Thread.Sleep(3000);
  }
}`;

function compile(source, output, extraArgs = []) {
  const result = spawnSync(compiler, [
    "/nologo", "/target:winexe", "/optimize+", "/codepage:65001", ...extraArgs, "/out:" + output, source
  ], { encoding: "utf8", windowsHide: true, timeout: 60_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

function compileInline(sandbox, name, code) {
  const source = path.join(sandbox, name + ".cs");
  fs.writeFileSync(source, code, "utf8");
  const output = path.join(sandbox, name + ".exe");
  compile(source, output);
  return output;
}

function compileHost(output) {
  compile(path.join(repoRoot, "native-host", "FolderPickerHost.cs"), output, [
    "/define:POPO_NATIVEHOST_TEST",
    "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll",
    "/reference:System.IO.Compression.dll", "/reference:System.IO.Compression.FileSystem.dll",
    "/reference:System.Web.Extensions.dll", "/reference:System.Security.dll"
  ]);
}

async function startFakeGopeedWindow(sentinelExe, sandbox) {
  const readyFile = path.join(sandbox, "window-ready.txt");
  fs.rmSync(readyFile, { force: true });
  const child = spawn(sentinelExe, [WINDOW_TITLE, readyFile], { stdio: "ignore", windowsHide: true });
  for (let i = 0; i < 100 && !fs.existsSync(readyFile); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(fs.existsSync(readyFile), "the fake Gopeed window did not start");
  return child;
}

function callHost(hostExe, request) {
  const payload = Buffer.from(JSON.stringify(request), "utf8");
  const length = Buffer.alloc(4);
  length.writeInt32LE(payload.length);
  const result = spawnSync(hostExe, [], {
    input: Buffer.concat([length, payload]),
    env: { ...process.env, POPO_NATIVEHOST_TEST_GOPEED_TITLE: WINDOW_TITLE },
    windowsHide: true,
    timeout: 60_000
  });
  assert.ok(result.stdout && result.stdout.length > 4, "the host returned no message: " + String(result.stderr));
  return JSON.parse(result.stdout.subarray(4, 4 + result.stdout.readInt32LE(0)).toString("utf8"));
}

function probe(hostExe, expectedGopeed, sandbox) {
  const resultFile = path.join(sandbox, "probe.txt");
  fs.rmSync(resultFile, { force: true });
  const result = spawnSync(hostExe, ["--test-foreign-gopeed", expectedGopeed, resultFile], {
    env: { ...process.env, POPO_NATIVEHOST_TEST_GOPEED_TITLE: WINDOW_TITLE },
    windowsHide: true,
    timeout: 30_000
  });
  assert.equal(result.status, 0, String(result.stderr));
  return fs.readFileSync(resultFile, "utf8");
}

test("别人的 Gopeed 窗口在运行时：不启动 gopeed.exe，不抢前台，并说明占用者", async (t) => {
  if (!fs.existsSync(compiler)) {
    t.skip("Windows .NET Framework compiler is unavailable");
    return;
  }
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "popo-foreign-gopeed-"));
  let windowOwner = null;
  try {
    const sentinelExe = compileInline(sandbox, "window-sentinel", WINDOW_SENTINEL);
    const nativeRoot = path.join(sandbox, "Product", "NativeHost");
    fs.mkdirSync(path.join(nativeRoot, "Gopeed"), { recursive: true });
    const hostExe = path.join(nativeRoot, "PopoFolderPickerHost.exe");
    compileHost(hostExe);
    const bundledGopeed = path.join(nativeRoot, "Gopeed", "gopeed.exe");
    fs.copyFileSync(compileInline(sandbox, "launch-recorder", LAUNCH_RECORDER), bundledGopeed);
    const launchedMarker = path.join(nativeRoot, "Gopeed", "launched.txt");

    // 1) 没有任何 gopeed 窗口：判定为“没有占用者”。
    assert.equal(probe(hostExe, bundledGopeed, sandbox), "NONE");

    windowOwner = await startFakeGopeedWindow(sentinelExe, sandbox);

    // 2) 窗口属于别的程序：判定为占用者，并带出它的路径。
    const foreign = probe(hostExe, bundledGopeed, sandbox);
    assert.match(foreign, /^FOREIGN:/);
    assert.equal(foreign.slice("FOREIGN:".length).toLowerCase(), sentinelExe.toLowerCase());

    // 3) 窗口属于内置 Gopeed 自己：不算占用者。
    assert.equal(probe(hostExe, sentinelExe, sandbox), "NONE");

    // 4) 真实流程：ensure_gopeed 不得启动 gopeed.exe（启动就会把别人的窗口抢到前台）。
    const response = callHost(hostExe, { action: "ensure_gopeed" });
    assert.equal(response.ok, false);
    assert.equal(response.foreignGopeed, true);
    assert.ok(response.error.toLowerCase().includes(sentinelExe.toLowerCase()), response.error);
    assert.equal(fs.existsSync(launchedMarker), false, "ensure_gopeed launched gopeed.exe next to a foreign Gopeed window");
  } finally {
    if (windowOwner) windowOwner.kill();
    // 清理失败（进程还没完全退出）不能盖住真正的断言失败。
    await new Promise((resolve) => setTimeout(resolve, 4000));
    try { fs.rmSync(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* temp dir is disposable */ }
  }
});
