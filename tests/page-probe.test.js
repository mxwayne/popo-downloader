"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const runtime = require("../runtime/popo-runtime.cjs");

const { sanitizeProbeReport } = runtime.pageProbe;

test("诊断清洗不保留文件名键、地址值、查询串与长标识路径", () => {
  const report = sanitizeProbeReport({
    apis: [{
      method: "GET",
      path: "/api/bs-team-space/web/v1/page/0123456789abcdef0123456789abcdef/list?token=secret&name=icon_bubble_a.png",
      status: 200,
      shape: {
        code: "number",
        data: { "icon_bubble_a.png": "https://bucket.s3v2.nie.netease.com/a.png?sig=1", list: [{ pageId: "string", name: "string" }] }
      }
    }],
    rows: { attributeNames: ["data-item-index", "icon_bubble_a.png", "class"], hasPageDetailLink: false }
  });
  const text = JSON.stringify(report);
  for (const leaked of ["icon_bubble", "https", "token", "secret", "0123456789abcdef", "s3v2", "sig="]) {
    assert.equal(text.includes(leaked), false, `不得出现 ${leaked}：${text}`);
  }
  assert.equal(report.apis[0].path, "/api/bs-team-space/web/v1/page/:id/list");
  assert.equal(report.apis[0].shape.data["<key>"], "string");
  assert.deepEqual(report.apis[0].shape.data.list, [{ pageId: "string", name: "string" }]);
  assert.deepEqual(report.rows.attributeNames, ["class", "data-item-index"]);
});

test("诊断结构深度超过 4 层被截断，接口超过 20 条被截断", () => {
  const deep = { a: { b: { c: { d: { e: { f: "string" } } } } } };
  const report = sanitizeProbeReport({
    apis: Array.from({ length: 30 }, (_, index) => ({ method: "GET", path: `/api/x${index}`, status: 200, shape: deep })),
    rows: { attributeNames: [], hasPageDetailLink: true }
  });
  assert.equal(report.apis.length, 20);
  assert.equal(report.apis[0].shape.a.b.c.d, "…");
  assert.equal(report.rows.hasPageDetailLink, true);
});

test("诊断清洗对非对象输入给出空报告", () => {
  assert.deepEqual(sanitizeProbeReport("x"), {
    apis: [], rows: { attributeNames: [], hasPageDetailLink: false }, enums: { pageTypePairs: [] }
  });
});

test("诊断清洗：含数字的路径段、十六进制键、无扩展名文件名键、成员映射都不保留", () => {
  const manyKeys = Object.fromEntries(Array.from({ length: 13 }, (_, index) => [`user${index}name`, "string"]));
  const report = sanitizeProbeReport({
    apis: [{
      method: "GET",
      path: "/api/drive/abcdef0123456789abcdef0123456789/Q3_budget_final",
      status: 200,
      shape: { Q3_budget_final: "string", a1b2c3d4e5f60718: "string", pageId: "string", members: manyKeys }
    }],
    rows: { attributeNames: [], hasPageDetailLink: false }
  });
  const text = JSON.stringify(report);
  for (const leaked of ["Q3_budget", "a1b2c3d4", "abcdef0123", "user1name"]) {
    assert.equal(text.includes(leaked), false, `不得出现 ${leaked}：${text}`);
  }
  assert.equal(report.apis[0].path, "/api/drive/:id/:id");
  assert.equal(report.apis[0].shape.pageId, "string");
  assert.deepEqual(report.apis[0].shape.members, { "<map>": "string" });
});

test("诊断保留请求体结构与 pageType/hasChildren 枚举组合，拒绝其他内容", () => {
  const report = sanitizeProbeReport({
    apis: [{
      method: "POST", path: "/api/bs-team-space/web/v1/page/folderSubList", status: 200,
      request: { pageId: "string", pageSize: "number", "report_q3.pdf": "string" },
      shape: { data: "object" }
    }],
    rows: { attributeNames: [], hasPageDetailLink: false },
    enums: { pageTypePairs: ["1|1", "2|0", "3|0", "https://x/a", "12345|1", "1|1"] }
  });
  assert.deepEqual(report.apis[0].request, { pageId: "string", pageSize: "number", "<key>": "string" });
  assert.deepEqual(report.enums.pageTypePairs, ["1|1", "2|0", "3|0"]);
  assert.equal(JSON.stringify(report).includes("report_q3"), false);
  assert.deepEqual(sanitizeProbeReport({}).enums, { pageTypePairs: [] });
});
