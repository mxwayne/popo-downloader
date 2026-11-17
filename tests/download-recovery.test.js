"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const runtime = require("../runtime/popo-runtime.cjs");

test("单项重试契约只接收任务和失败标识，拒绝注入下载路径", () => {
  assert.deepEqual(runtime.contracts.parseRuntimeCommand({
    type: "RETRY_JOB_ITEM", jobId: "job-1", failureId: "failed-1"
  }), { type: "RETRY_JOB_ITEM", jobId: "job-1", failureId: "failed-1" });
  assert.throws(() => runtime.contracts.parseRuntimeCommand({
    type: "RETRY_JOB_ITEM", jobId: "job-1", failureId: "failed-1", url: "https://evil.example"
  }));
});

const failure = { id: "file-1", kind: "file", name: "a.png", path: ["素材"], retryKey: "key-1" };
const other = { id: "file-2", kind: "file", name: "b.png", path: ["素材"], retryKey: "key-2" };

test("单项恢复成功保留其他失败与原成功数，目标消失仍失败", () => {
  const job = {
    retrySelection: failure, retainedFailures: [other],
    retainedCounts: { files: 67, success: 66, failed: 1, scanFailures: 0, unverifiedDirectories: 0 }
  };
  const recovered = runtime.downloadRecovery.mergeRecoverySummary(job,
    { files: 1, success: 1, failed: 0 }, [], [{ id: "file-1", status: "success" }]);
  assert.equal(recovered.counts.success, 67);
  assert.equal(recovered.counts.failed, 1);
  assert.equal(recovered.counts.files, 68);
  assert.deepEqual(recovered.failures, [other]);
  const missing = runtime.downloadRecovery.mergeRecoverySummary(job,
    { files: 0, success: 0, failed: 0 }, [], []);
  assert.equal(missing.counts.failed, 2);
  assert.equal(missing.counts.files, 68);
  assert.equal(missing.failures.length, 2);
  assert.match(missing.failures[1].error, /未找到/);
});

test("目录补下出现新失败时保留原失败并显示新增文件失败", () => {
  const directory = { id: "dir-1", kind: "directory", name: "子目录", path: ["素材", "子目录"] };
  const job = {
    retrySelection: directory, retainedFailures: [other],
    retainedCounts: { files: 67, success: 66, failed: 1, scanFailures: 0, unverifiedDirectories: 0 }
  };
  const result = runtime.downloadRecovery.mergeRecoverySummary(job,
    { files: 2, success: 1, failed: 1, scanFailures: 0, unverifiedDirectories: 0 }, [failure], []);
  assert.equal(result.counts.success, 67);
  assert.equal(result.counts.failed, 2);
  assert.equal(result.counts.files, 69);
  assert.deepEqual(result.failures, [other, failure]);
});

test("失败分类不包含原始素材名、地址或凭证", () => {
  const classify = runtime.downloadRecovery.classifyRecoveryError;
  assert.equal(classify(new Error("未找到文件夹：secret-material")), "folder_not_found");
  assert.equal(classify(new Error("点击后没有进入目标文件夹：private")), "directory_navigation_timeout");
  assert.equal(classify(new Error("文件夹行已失效")), "stale_row");
  assert.equal(classify(new Error("Timeout https://private.example/?token=secret")), "timeout");
  assert.equal(classify(new Error("private-file.png")), "operation_failed");
});

test("目录重扫先扣除已发现文件，避免把成功文件重复计数", () => {
  const directory = { id: "dir-1", kind: "directory", name: "子目录", path: ["素材", "子目录"],
    knownCounts: { files: 3, success: 2, failed: 1 } };
  const retained = runtime.downloadRecovery.retainedRecoveryCounts(
    { files: 8, success: 6, failed: 2, scanFailures: 2, unverifiedDirectories: 2 }, directory);
  assert.equal(retained.files, 5);
  assert.equal(retained.success, 4);
  assert.equal(retained.failed, 1);
  assert.equal(retained.scanFailures, 1);
});

test("目录补下替换目录内的旧失败，保留目录外的失败", () => {
  const directory = { id: "dir-1", kind: "directory", name: "A", path: ["素材", "A"],
    knownCounts: { scanFailures: 2, unverifiedDirectories: 2 } };
  const inside = { ...failure, id: "inside", path: ["素材", "A", "子目录"] };
  const outside = { ...other, path: ["素材", "AB"] };
  assert.deepEqual(runtime.downloadRecovery.remainingFailures([directory, inside, outside], directory), [outside]);
  const counts = runtime.downloadRecovery.retainedRecoveryCounts(
    { scanFailures: 3, unverifiedDirectories: 3 }, directory);
  assert.equal(counts.scanFailures, 1);
  assert.equal(counts.unverifiedDirectories, 1);
});

test("自动补下只针对可能成功的失败，权限拒绝、文件已不存在不补", () => {
  const { isAutoRetryable } = runtime.downloadRecovery;
  assert.equal(isAutoRetryable({ ...failure, reason: "operation_failed" }), true);
  assert.equal(isAutoRetryable({ ...failure, reason: "timeout" }), true);
  assert.equal(isAutoRetryable({ ...failure, reason: "directory_navigation_timeout" }), true);
  assert.equal(isAutoRetryable({ ...failure }), true);
  assert.equal(isAutoRetryable({ ...failure, reason: "permission_denied" }), false);
  assert.equal(isAutoRetryable({ ...failure, reason: "file_not_found" }), false);
  assert.equal(isAutoRetryable({ ...failure, reason: "folder_not_found" }), true);
  assert.equal(isAutoRetryable({ ...failure, reason: "count_unverified" }), false);
  assert.equal(isAutoRetryable({ ...failure, reason: "worker_recovery_exhausted" }), false);
});

test("连续 3 次准备失败触发冷却并清零，成功清零，权限拒绝不计数", () => {
  const { advancePrepareStreak, PREPARE_FAILURE_STREAK_LIMIT, PREPARE_COOLDOWN_MS } = runtime.downloadRecovery;
  assert.equal(PREPARE_FAILURE_STREAK_LIMIT, 3);
  assert.equal(PREPARE_COOLDOWN_MS, 30000);
  assert.deepEqual(advancePrepareStreak(0, "failure"), { streak: 1, cooldown: false });
  assert.deepEqual(advancePrepareStreak(1, "failure"), { streak: 2, cooldown: false });
  assert.deepEqual(advancePrepareStreak(2, "failure"), { streak: 0, cooldown: true });
  assert.deepEqual(advancePrepareStreak(2, "success"), { streak: 0, cooldown: false });
  assert.deepEqual(advancePrepareStreak(2, "permission_denied"), { streak: 2, cooldown: false });
});

test("失败明细上限 200：超出部分只记数量", () => {
  const { capFailureEntries, MAX_FAILURE_ENTRIES } = runtime.downloadRecovery;
  assert.equal(MAX_FAILURE_ENTRIES, 200);
  const entries = Array.from({ length: 250 }, (_, index) => ({ ...failure, id: `f${index}` }));
  const capped = capFailureEntries(entries);
  assert.equal(capped.entries.length, 200);
  assert.equal(capped.omitted, 50);
  assert.equal(capped.entries[0].id, "f0");
  assert.deepEqual(capFailureEntries(entries.slice(0, 3)), { entries: entries.slice(0, 3), omitted: 0 });
});
