const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

async function loadSmokeModule() {
  return import("../scripts/filename-smoke-server.mjs");
}

test("STEP 2 验收站复用产品算法生成保留名与稳定碰撞路径", async () => {
  const { buildSmokePlan } = await loadSmokeModule();
  const plan = buildSmokePlan("D:\\POPO\\Validation\\FilenameSmoke");
  const bySource = new Map(plan.map((item) => [item.name, item]));

  assert.equal(bySource.get("CON.txt").target.name, "_CON.txt");
  assert.equal(bySource.get("AUX.zip").target.name, "_AUX.zip");
  assert.equal(bySource.get("COM1").target.name, "_COM1");
  assert.equal(bySource.get("正常视频.mp4").target.name, "正常视频.mp4");
  assert.equal(bySource.get("normal-file.zip").target.name, "normal-file.zip");
  assert.equal(bySource.get("设计源文件.psd").target.name, "设计源文件.psd");
  assert.match(bySource.get("文件夹内容.txt").target.path, /素材2026$/);

  const collisionNames = ["A:B.mp4", "A?B.mp4", "A*B.mp4"].map((name) => bySource.get(name).target.name);
  assert.equal(new Set(collisionNames.map((name) => name.toLowerCase())).size, 3);
  for (const name of collisionNames) assert.match(name, /^A_B~[0-9a-f]{8}\.mp4$/);

  assert.equal(new Set(plan.map((item) => item.relativeFilename.toLowerCase())).size, plan.length);
  assert.equal(new Set(plan.filter((item) => item.name.endsWith(".mp4")).map((item) => item.sha256)).size, 4);
});

test("STEP 2 验收站拒绝监听非回环地址", async () => {
  const { startFilenameSmokeServer } = await loadSmokeModule();
  await assert.rejects(
    startFilenameSmokeServer({ host: "0.0.0.0", port: 0 }),
    /只能监听本机回环地址/
  );
});

test("STEP 2 验收站只监听本机并提供预置文件，不需要人工上传", async (t) => {
  const { startFilenameSmokeServer } = await loadSmokeModule();
  const smoke = await startFilenameSmokeServer({ port: 0 });
  t.after(() => new Promise((resolve) => smoke.server.close(resolve)));

  assert.match(smoke.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  const page = await fetch(smoke.origin);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /POPO STEP 2 文件名验收站/);
  const token = html.match(/const token="([a-f0-9]+)"/)?.[1];
  assert.ok(token);

  const unauthenticatedStatus = await fetch(`${smoke.origin}/api/status`);
  assert.equal(unauthenticatedStatus.status, 403);
  const authenticatedStatus = await fetch(`${smoke.origin}/api/status`, {
    headers: { "X-Smoke-Token": token }
  });
  assert.equal(authenticatedStatus.status, 200);

  const missingOrigin = await fetch(`${smoke.origin}/api/run`, {
    method: "POST",
    headers: { "X-Smoke-Token": token }
  });
  assert.equal(missingOrigin.status, 403);

  const spoofedHost = await new Promise((resolve, reject) => {
    const target = new URL(smoke.origin);
    const request = http.request({
      host: target.hostname,
      port: Number(target.port),
      path: "/api/status",
      headers: { Host: `attacker.example:${target.port}` }
    }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.end();
  });
  assert.equal(spoofedHost, 421);

  const fixture = await fetch(`${smoke.origin}/files/collision-colon`);
  assert.equal(fixture.status, 200);
  assert.equal(fixture.headers.get("content-type"), "video/mp4");
  assert.ok((await fixture.arrayBuffer()).byteLength > 2000);

  const missing = await fetch(`${smoke.origin}/files/not-found`);
  assert.equal(missing.status, 404);
});
