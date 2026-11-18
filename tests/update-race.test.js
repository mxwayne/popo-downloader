"use strict";

// Windows 专属：更新清单的“腾讯云优先、GitHub 竞速”选择。
// 用可控延迟模拟两个来源（测试入口 --test-race），不访问真实网络。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.join(__dirname, "..");
const compiler = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";

function compileHost(output) {
  const result = spawnSync(compiler, [
    "/nologo", "/target:winexe", "/define:POPO_NATIVEHOST_TEST", "/optimize+", "/codepage:65001",
    "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll",
    "/reference:System.IO.Compression.dll", "/reference:System.IO.Compression.FileSystem.dll",
    "/reference:System.Web.Extensions.dll", "/reference:System.Security.dll",
    "/out:" + output, path.join(repoRoot, "native-host", "FolderPickerHost.cs")
  ], { cwd: repoRoot, encoding: "utf8", windowsHide: true, timeout: 60_000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

test("更新来源竞速：快的先赢，腾讯云卡住或失败时 GitHub 很快接手，都失败时报腾讯云的错误", (t) => {
  if (!fs.existsSync(compiler)) {
    t.skip("Windows .NET Framework compiler is unavailable");
    return;
  }
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "popo-update-race-"));
  try {
    const host = path.join(sandbox, "PopoFolderPickerHost.exe");
    compileHost(host);
    const race = (cos, github) => {
      const resultFile = path.join(sandbox, "race.txt");
      fs.rmSync(resultFile, { force: true });
      const started = Date.now();
      const result = spawnSync(host, ["--test-race", cos, github, resultFile], { windowsHide: true, timeout: 60_000 });
      assert.equal(result.status, 0, String(result.stderr));
      const [outcome, elapsed] = fs.readFileSync(resultFile, "utf8").split("|");
      return { outcome, elapsed: Number(elapsed), wall: Date.now() - started };
    };

    // 腾讯云正常：它赢，不等 GitHub。
    let r = race("ok:150", "ok:20");
    assert.equal(r.outcome, "WIN:cos");
    assert.ok(r.elapsed < 1500, "cos fast path took " + r.elapsed);

    // 腾讯云卡住：GitHub 在领先时间之后加入并赢，总耗时远小于卡住的超时。
    r = race("ok:20000", "ok:100");
    assert.equal(r.outcome, "WIN:github");
    assert.ok(r.elapsed >= 2000 && r.elapsed < 6000, "cos stuck, github should win at about 2.6 s but took " + r.elapsed);

    // 腾讯云比领先时间慢一点：GitHub 在领先时间后加入，先到先得。
    r = race("ok:3500", "ok:100");
    assert.equal(r.outcome, "WIN:github");

    // 腾讯云很快失败：GitHub 立刻加入，不用等领先时间。
    r = race("fail:100", "ok:300");
    assert.equal(r.outcome, "WIN:github");
    assert.ok(r.elapsed < 2000, "cos failed fast, github should start at once but took " + r.elapsed);

    // GitHub 先失败不影响腾讯云。
    r = race("ok:3000", "fail:50");
    assert.equal(r.outcome, "WIN:cos");

    // 两个都失败：抛腾讯云那次的错误。
    r = race("fail:50", "fail:50");
    assert.match(r.outcome, /^ERR:cos-error/);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
