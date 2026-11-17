"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const runtime = require("../runtime/popo-runtime.cjs");

const { parseFolderSubList, pageUrlFor, findChildFolder, FOLDER_PAGE_TYPE } = runtime.apiScan;

const item = (overrides) => ({
  pageId: "p1", pageName: "a.png", pageType: 3, hasChildren: 0, pageSize: 12, pageMajorVersion: 1, ...overrides
});
const response = (list, extra = {}) => ({
  status: 200, message: "ok",
  data: { pageList: list, more: false, total: list.length, pageMajorVersion: 1, ...extra }
});

test("目录接口响应：pageType 0 是文件夹，其余是文件", () => {
  assert.equal(FOLDER_PAGE_TYPE, 0);
  const result = parseFolderSubList(response([
    item({ pageId: "f1", pageName: "子目录", pageType: 0, hasChildren: 1 }),
    item({ pageId: "x1", pageName: "a.png" }),
    item({ pageId: "x2", pageName: "b.psd", pageType: 5, pageSize: 99 })
  ]));
  assert.equal(result.ok, true);
  assert.deepEqual(result.folders, [{ pageId: "f1", name: "子目录", pageMajorVersion: 1, hasChildren: 1 }]);
  assert.deepEqual(result.files.map((file) => [file.pageId, file.name, file.size]), [["x1", "a.png", 12], ["x2", "b.psd", 99]]);
  assert.equal(result.total, 3);
});

test("目录接口响应：more、数量不符、业务码、结构异常都不被信任", () => {
  assert.deepEqual(
    [parseFolderSubList(response([item({})], { more: true })).reason,
      parseFolderSubList(response([item({})], { total: 5 })).reason,
      parseFolderSubList({ status: 405, data: null }).reason,
      parseFolderSubList({ status: 200, data: {} }).reason,
      parseFolderSubList("x").reason],
    ["more", "count_mismatch", "business_error", "bad_shape", "bad_shape"]
  );
  const mismatch = parseFolderSubList(response([item({})], { total: 5 }));
  assert.deepEqual([mismatch.total, mismatch.length, mismatch.more], [5, 1, 0]);
  assert.equal(parseFolderSubList({ status: 0, data: { pageList: [], more: false, total: 0 } }).ok, true);
  assert.equal(parseFolderSubList(response([item({ pageName: "" })])).reason, "bad_shape");
});

test("pageUrlFor 只替换 pageDetail 后的标识；findChildFolder 同名不唯一时返回 null", () => {
  assert.equal(
    pageUrlFor("https://docs.popo.netease.com/team/pc/2tirvpk2/pageDetail/fe49e8dbc59e44", "7506b066e9a34"),
    "https://docs.popo.netease.com/team/pc/2tirvpk2/pageDetail/7506b066e9a34"
  );
  const listing = parseFolderSubList(response([
    item({ pageId: "f1", pageName: "劫妹", pageType: 0 }),
    item({ pageId: "f2", pageName: "序列帧", pageType: 0 }),
    item({ pageId: "f3", pageName: "序列帧", pageType: 0 })
  ]));
  assert.equal(findChildFolder(listing, "劫妹").pageId, "f1");
  assert.equal(findChildFolder(listing, "序列帧"), null);
  assert.equal(findChildFolder(listing, "不存在"), null);
});

test("非 0 类型但带子项的条目无法判定种类，整个目录结果不被信任", () => {
  const result = parseFolderSubList(response([item({ pageId: "d1", pageName: "文档", pageType: 5, hasChildren: 1 })]));
  assert.equal(result.reason, "unknown_kind");
  assert.equal(parseFolderSubList(response([item({ pageType: 5, hasChildren: 0 })])).ok, true);
});

test("文件夹条目保留 hasChildren，供后台识别“声称有子项却返回空列表”", () => {
  const result = parseFolderSubList(response([item({ pageId: "f1", pageName: "A", pageType: 0, hasChildren: 1 })]));
  assert.deepEqual(result.folders, [{ pageId: "f1", name: "A", pageMajorVersion: 1, hasChildren: 1 }]);
});

test("业务错误保留业务码与简短提示，供诊断定位接口为什么被拒绝", () => {
  const rejected = parseFolderSubList({ status: 405, message: "没有权限操作", data: null });
  assert.equal(rejected.reason, "business_error");
  assert.equal(rejected.status, 405);
  assert.equal(rejected.detail, "没有权限操作");
  const long = parseFolderSubList({ code: 500, message: "x".repeat(300) });
  assert.equal(long.status, 500);
  assert.equal(long.detail.length, 80);
});

test("POPO 的成功业务码是 1（提示“成功”），0 与 200 也视为成功，其余才是业务错误", () => {
  const body = (status) => ({ status, message: status === 1 ? "成功" : "x", data: { pageList: [item({})], more: false, total: 1 } });
  for (const status of [0, 1, 200]) assert.equal(parseFolderSubList(body(status)).ok, true, `status ${status}`);
  for (const status of [2, 400, 405, 500]) {
    const result = parseFolderSubList(body(status));
    assert.equal(result.ok, false);
    assert.equal(result.reason, "business_error");
    assert.equal(result.status, status);
  }
});

test("实测 total 可能为 0 而列表有内容：total 为 0 视为未提供，仍以 more 为准；total 大于 0 时必须相等", () => {
  const zero = parseFolderSubList(response([item({ pageId: "a" }), item({ pageId: "b", pageName: "b.png" })], { total: 0 }));
  assert.equal(zero.ok, true);
  assert.equal(zero.total, 2, "total 取实际条数");
  assert.equal(parseFolderSubList(response([item({})], { total: 0, more: true })).reason, "more");
  assert.equal(parseFolderSubList(response([item({})], { total: 5 })).reason, "count_mismatch");
  assert.equal(parseFolderSubList(response([], { total: 0 })).ok, true);
});
