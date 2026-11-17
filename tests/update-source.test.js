"use strict";

// Windows 专属：编译带测试入口的本机助手，直接校验更新清单与重定向地址。
// 其他平台没有 .NET Framework 编译器，整体跳过（与 setup-transaction 等测试一致）。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.join(__dirname, "..");
const compiler = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
const GITHUB_PREFIX = "https://github.com/mxwayne/popo-downloader/releases/download";
const COS_PREFIX = "https://popo-updates-1461466196.cos.ap-guangzhou.myqcloud.com/stable";

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

function newKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = publicKey.export({ format: "jwk" });
  const b64 = (value) => Buffer.from(value, "base64url").toString("base64");
  const xml = `<RSAKeyValue><Modulus>${b64(jwk.n)}</Modulus><Exponent>${b64(jwk.e)}</Exponent></RSAKeyValue>`;
  return { privateKey, publicKeyB64: Buffer.from(xml, "utf8").toString("base64") };
}

function signedManifest(privateKey, overrides = {}) {
  const manifest = {
    schemaVersion: 1, channel: "stable", version: "0.8.1", chromeVersion: "0.8.1",
    publishedAt: "2026-11-18T00:00:00.0000000+08:00",
    artifact: "popo-stable-downloader-0.8.1-win-x64.zip",
    url: `${COS_PREFIX}/popo-stable-downloader-0.8.1-win-x64.zip`,
    sha256: "a".repeat(64), size: 39000000, notes: "test",
    ...overrides
  };
  const canonical = [
    manifest.schemaVersion, manifest.channel, manifest.version, manifest.chromeVersion, manifest.publishedAt,
    manifest.artifact, manifest.url, manifest.sha256, manifest.size
  ].join("\n");
  manifest.signature = crypto.sign("sha256", Buffer.from(canonical, "utf8"), privateKey).toString("base64");
  return manifest;
}

test("更新清单校验：腾讯云与 GitHub 两个来源各自的地址规则、签名与篡改", (t) => {
  if (!fs.existsSync(compiler)) {
    t.skip("Windows .NET Framework compiler is unavailable");
    return;
  }
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "popo-update-source-"));
  try {
    const host = path.join(sandbox, "host.exe");
    compileHost(host);
    const { privateKey, publicKeyB64 } = newKey();
    const validate = (manifest, source, mutate = (value) => value) => {
      const json = path.join(sandbox, "manifest.json");
      const result = path.join(sandbox, "result.txt");
      fs.rmSync(result, { force: true });
      fs.writeFileSync(json, JSON.stringify(mutate(manifest)), "utf8");
      const run = spawnSync(host, ["--test-validate-manifest", json, source, result], {
        encoding: "utf8", windowsHide: true, timeout: 30_000,
        env: { ...process.env, POPO_NATIVEHOST_TEST_PUBLIC_KEY_B64: publicKeyB64 }
      });
      assert.equal(run.status, 0, `host exit ${run.status}`);
      return fs.readFileSync(result, "utf8");
    };
    const zip = "popo-stable-downloader-0.8.1-win-x64.zip";
    const cos = signedManifest(privateKey);
    const github = signedManifest(privateKey, { url: `${GITHUB_PREFIX}/v0.8.1/${zip}` });

    assert.equal(validate(cos, "cos"), "OK");
    assert.equal(validate(github, "github"), "OK");

    // 地址必须属于对应来源
    assert.match(validate(github, "cos"), /^ERR:.*COS/);
    assert.match(validate(cos, "github"), /^ERR:.*GitHub/);
    for (const url of [
      `https://github.com/evil/popo-downloader/releases/download/v0.8.1/${zip}`,
      `https://github.com.evil.example/mxwayne/popo-downloader/releases/download/v0.8.1/${zip}`,
      `http://github.com/mxwayne/popo-downloader/releases/download/v0.8.1/${zip}`,
      `${GITHUB_PREFIX}/v0.8.0/${zip}`,
      `${GITHUB_PREFIX}/v0.8.1/other-${zip}`,
      `https://user:pw@github.com/mxwayne/popo-downloader/releases/download/v0.8.1/${zip}`
    ]) {
      assert.match(validate(signedManifest(privateKey, { url }), "github"), /^ERR:/, url);
    }

    // 签名覆盖地址与校验值：任何改动都必须被拒绝
    assert.match(validate(github, "github", (m) => ({ ...m, sha256: "b".repeat(64) })), /^ERR:.*signature/i);
    assert.match(validate(github, "github", (m) => ({ ...m, url: m.url.replace("mxwayne", "mxwaynf") })), /^ERR:/);
    assert.match(validate(github, "github", (m) => ({ ...m, version: "9.9.9", chromeVersion: "9.9.9" })), /^ERR:/);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test("更新下载重定向：只允许 GitHub 自己的发布域名，且必须是 https", (t) => {
  if (!fs.existsSync(compiler)) {
    t.skip("Windows .NET Framework compiler is unavailable");
    return;
  }
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "popo-update-redirect-"));
  try {
    const host = path.join(sandbox, "host.exe");
    compileHost(host);
    const check = (url) => {
      const result = path.join(sandbox, "result.txt");
      fs.rmSync(result, { force: true });
      const run = spawnSync(host, ["--test-check-url", url, result], {
        encoding: "utf8", windowsHide: true, timeout: 30_000
      });
      assert.equal(run.status, 0);
      return fs.readFileSync(result, "utf8");
    };
    for (const url of [
      `${GITHUB_PREFIX}/v0.8.1/a.zip`,
      "https://github.com/mxwayne/popo-downloader/releases/latest/download/latest.github.json",
      "https://objects.githubusercontent.com/github-production-release-asset/1/2?x=1",
      "https://release-assets.githubusercontent.com/github-production-release-asset/1/2?x=1"
    ]) assert.equal(check(url), "ALLOWED", url);
    for (const url of [
      "http://github.com/mxwayne/popo-downloader/releases/download/v0.8.1/a.zip",
      "https://github.com/evil/repo/releases/download/v0.8.1/a.zip",
      "https://raw.githubusercontent.com/mxwayne/popo-downloader/main/a.zip",
      "https://githubusercontent.com.evil.example/a.zip",
      "https://evil.example/github.com/mxwayne/popo-downloader/a.zip",
      "https://github.com:8443/mxwayne/popo-downloader/releases/download/v0.8.1/a.zip",
      "ftp://github.com/mxwayne/popo-downloader/a.zip"
    ]) assert.equal(check(url), "DENIED", url);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
