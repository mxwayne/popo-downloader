"use strict";

// e2e 沙箱扩展与 Stable 扩展 ID 相同；没有隔离时，在装了 POPO 的 Windows 机器上跑 e2e，
// 会连上真实的 Stable 原生助手并在真实安装目录里启动 Gopeed（2026-11-17 现场事故：以更高权限启动的 Gopeed
// 让用户的在线更新因“无权结束 Gopeed”回滚）。这里锁住隔离做法。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const e2eDir = path.join(__dirname, "e2e");

test("每个加载扩展的 e2e 用例集都调用原生助手隔离", () => {
  const specs = fs.readdirSync(e2eDir).filter((name) => name.endsWith(".spec.mjs"));
  const loading = specs.filter((name) => fs.readFileSync(path.join(e2eDir, name), "utf8").includes("--load-extension"));
  assert.ok(loading.length >= 2, "expected the e2e specs that load the extension");
  for (const name of loading) {
    const source = fs.readFileSync(path.join(e2eDir, name), "utf8");
    assert.match(source, /import \{ isolateNativeHost \} from "\.\/native-host-isolation\.mjs"/, name);
    assert.match(source, /await isolateNativeHost\(/, name);
  }
});

test("隔离把 Stable 与 Dev 原生助手名都换成不存在的名字，常量改名时测试直接报错", async () => {
  const { isolateNativeHostSource, UNREACHABLE_NATIVE_HOST } = await import("./e2e/native-host-isolation.mjs");
  const background = fs.readFileSync(path.join(root, "background.js"), "utf8");
  const isolated = isolateNativeHostSource(background);
  assert.doesNotMatch(isolated, /const (?:STABLE|DEV)_FOLDER_PICKER_HOST = "com\.popo\.(?:stable|dev)_downloader/);
  assert.equal(isolated.split(UNREACHABLE_NATIVE_HOST).length - 1, 2);
  assert.throws(() => isolateNativeHostSource("const SOMETHING_ELSE = 1;"), /native host isolation/);
});
