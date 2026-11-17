"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const runtime = require("../runtime/popo-runtime.cjs");

const { summarizeDirectories, MAX_DIRECTORY_SUMMARIES } = runtime.directorySummary;

test("目录汇总按 directoryPath 精确匹配计数，只统计已选文件", () => {
  const scans = [
    { path: ["素材"], expected: 3, found: 3, verified: true },
    { path: ["素材", "子目录"], expected: 2, found: 2, verified: true }
  ];
  const items = [
    { directoryPath: ["素材"], selected: true, status: "success" },
    { directoryPath: ["素材"], selected: true, status: "failed" },
    { directoryPath: ["素材"], selected: true, status: "transferring" },
    { directoryPath: ["素材"], selected: false, status: "skipped" },
    { directoryPath: ["素材", "子目录"], selected: true, status: "success" },
    { directoryPath: ["素材", "子目录"], selected: true, status: "pending" }
  ];
  const [parent, child] = summarizeDirectories(scans, items, []);
  assert.deepEqual(
    { path: parent.path, expected: parent.expected, found: parent.found, success: parent.success, failed: parent.failed, active: parent.active, pending: parent.pending, status: parent.status },
    { path: ["素材"], expected: 3, found: 3, success: 1, failed: 1, active: 1, pending: 0, status: "verified" }
  );
  assert.equal(child.success, 1);
  assert.equal(child.pending, 1);
});

test("读取失败的目录状态为 failed，未核对数量的为 unverified", () => {
  const scans = [
    { path: ["A"], expected: null, found: 4, verified: false },
    { path: ["B"], expected: 1, found: 1, verified: true }
  ];
  const result = summarizeDirectories(scans, [], [{ path: ["C", "劫妹"] }]);
  const byPath = Object.fromEntries(result.map((entry) => [entry.path.join("/"), entry.status]));
  assert.deepEqual(byPath, { "C/劫妹": "failed", A: "unverified", B: "verified" });
});

test("目录超过上限时保留有问题的目录并排在前面", () => {
  const scans = Array.from({ length: 250 }, (_, index) => ({
    path: [`目录${index}`], expected: 1, found: 1, verified: index !== 249
  }));
  const result = summarizeDirectories(scans, [], [{ path: ["失败甲"] }, { path: ["失败乙"] }]);
  assert.equal(result.length, MAX_DIRECTORY_SUMMARIES);
  assert.deepEqual(result.slice(0, 3).map((entry) => entry.status), ["failed", "failed", "unverified"]);
  assert.ok(result.some((entry) => entry.path[0] === "目录249"));
});

test("页面不提供数量的目录：文件已扫描，状态为未核对而不是读取失败", () => {
  const scans = [{ path: ["A"], expected: null, found: 4, verified: false }];
  const [entry] = summarizeDirectories(scans, [], [{ path: ["A"], reason: "count_unverified" }]);
  assert.equal(entry.status, "unverified");
  const [real] = summarizeDirectories(scans, [], [{ path: ["A"], reason: "timeout" }]);
  assert.equal(real.status, "failed");
});

test("目录汇总保留扫描方式（接口或页面），旧记录缺省为页面", () => {
  const [api, page] = summarizeDirectories([
    { path: ["A"], expected: 1, found: 1, verified: true, via: "api" },
    { path: ["B"], expected: 1, found: 1, verified: true }
  ], [], []);
  assert.equal(api.via, "api");
  assert.equal(page.via, "page");
});
