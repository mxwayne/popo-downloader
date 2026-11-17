"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fakeIndexedDb = require("fake-indexeddb");
const { buildTaskIdentityLabels } = require("../gopeed.js");
const { makeFolderJobKey } = require("../queue.js");

function installFakeIndexedDb() {
  const names = [
    "indexedDB",
    "IDBCursor",
    "IDBCursorWithValue",
    "IDBDatabase",
    "IDBFactory",
    "IDBIndex",
    "IDBKeyRange",
    "IDBObjectStore",
    "IDBOpenDBRequest",
    "IDBRecord",
    "IDBRequest",
    "IDBTransaction",
    "IDBVersionChangeEvent"
  ];
  const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(global, name)]));
  for (const name of names) {
    const value = name === "indexedDB" ? new fakeIndexedDb.IDBFactory() : fakeIndexedDb[name];
    Object.defineProperty(global, name, { configurable: true, writable: true, value });
  }
  return () => {
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  };
}

function eventStub() {
  return {
    listeners: [],
    addListener(listener) { this.listeners.push(listener); },
    removeListener(listener) {
      this.listeners = this.listeners.filter((candidate) => candidate !== listener);
    }
  };
}

function createHarness(initial = {}, options = {}) {
  const backgroundPath = require.resolve("../background.js");
  delete require.cache[backgroundPath];
  const previousFetch = Object.getOwnPropertyDescriptor(global, "fetch");
  const previousSetTimeout = global.setTimeout;
  const previousClearTimeout = global.clearTimeout;
  const activeTimeouts = new Set();
  const stored = structuredClone(initial);
  const deletedGopeedTasks = [];
  const pausedGopeedTasks = [];
  const continuedGopeedTasks = [];
  const sentTabMessages = [];
  const nativeMessages = [];
  let runtimeReloadCount = 0;
  const actionState = {};
  const storageAccessState = {};

  global.importScripts = (...files) => {
    if (files.includes("runtime/popo-runtime.js")) global.PopoRuntime = require("../runtime/popo-runtime.cjs");
    if (files.includes("core.js")) global.PopoCore = require("../core.js");
    if (files.includes("gopeed.js")) {
      global.PopoGopeed = {
        ...require("../gopeed.js"),
        ...(options.getGopeedConfig ? {
          getConfig: options.getGopeedConfig
        } : options.gopeedConfig ? {
          async getConfig() { return structuredClone(options.gopeedConfig); }
        } : {}),
        ...(options.gopeedTasks ? {
          async listTasks() { return structuredClone(options.gopeedTasks); }
        } : {}),
        ...(options.listGopeedTasks ? {
          listTasks: options.listGopeedTasks
        } : {}),
        ...(options.startOrReplaceGopeedTask ? {
          startOrReplaceTask: options.startOrReplaceGopeedTask
        } : {}),
        ...(options.getGopeedTask ? {
          getTask: options.getGopeedTask
        } : {}),
        ...(options.pauseGopeedTask ? {
          pauseTask: options.pauseGopeedTask
        } : {
          async pauseTask(_settings, taskId) { pausedGopeedTasks.push(taskId); }
        }),
        ...(options.continueGopeedTask ? {
          continueTask: options.continueGopeedTask
        } : {
          async continueTask(_settings, taskId) { continuedGopeedTasks.push(taskId); }
        }),
        async deleteTask(_settings, taskId) { deletedGopeedTasks.push(taskId); }
      };
    }
    if (files.includes("queue.js")) global.PopoQueue = require("../queue.js");
  };
  if (options.fetch) {
    Object.defineProperty(global, "fetch", {
      configurable: true,
      writable: true,
      value: options.fetch
    });
  }
  global.setTimeout = (callback, delay, ...args) => {
    const effectiveDelay = Number.isFinite(options.updatePollDelayMs) && delay === 2000
      ? options.updatePollDelayMs
      : delay;
    let timeout;
    timeout = previousSetTimeout((...callbackArgs) => {
      activeTimeouts.delete(timeout);
      callback(...callbackArgs);
    }, effectiveDelay, ...args);
    activeTimeouts.add(timeout);
    return timeout;
  };
  global.clearTimeout = (timeout) => {
    activeTimeouts.delete(timeout);
    previousClearTimeout(timeout);
  };
  global.chrome = {
    action: {
      async setBadgeText({ text }) { actionState.text = text; },
      async setBadgeBackgroundColor({ color }) { actionState.color = color; },
      async setTitle({ title }) { actionState.title = title; }
    },
    alarms: { create() {}, onAlarm: eventStub() },
    runtime: {
      onInstalled: eventStub(),
      onMessage: eventStub(),
      onStartup: eventStub(),
      ...(options.runtimeManifest ? {
        getManifest() { return structuredClone(options.runtimeManifest); }
      } : {}),
      reload() {
        runtimeReloadCount += 1;
        if (options.onRuntimeReload) options.onRuntimeReload(runtimeReloadCount);
      },
      async sendNativeMessage(host, message) {
        nativeMessages.push({ host, message: structuredClone(message) });
        if (options.sendNativeMessage) return options.sendNativeMessage(host, message);
        throw new Error("未配置本机助手响应");
      }
    },
    storage: {
      local: {
        async setAccessLevel({ accessLevel }) {
          storageAccessState.accessLevel = accessLevel;
        },
        async get(keys) {
          const requested = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(requested.filter((key) => key in stored).map((key) => [key, stored[key]]));
        },
        async set(values) { Object.assign(stored, structuredClone(values)); },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete stored[key];
        }
      }
    },
    tabs: {
      onRemoved: eventStub(),
      onUpdated: eventStub(),
      async sendMessage(tabId, message, sendOptions) {
        sentTabMessages.push({ tabId, message: structuredClone(message), options: structuredClone(sendOptions) });
        if (options.sendTabMessage) {
          return options.sendTabMessage(tabId, message, sendOptions);
        }
        return { ok: true };
      },
      async get(tabId) { return options.getTab ? options.getTab(tabId) : null; },
      async remove() {}
    }
  };

  require(backgroundPath);
  const listener = global.chrome.runtime.onMessage.listeners[0];
  const send = (message, sender = {
    tab: { id: 7, url: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1" },
    url: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1",
    frameId: 0
  }) => new Promise((resolve) => {
    assert.equal(listener(message, sender, resolve), true);
  });
  const cleanup = () => {
    delete global.chrome;
    delete global.importScripts;
    delete global.PopoCore;
    delete global.PopoGopeed;
    delete global.PopoQueue;
    delete global.PopoRuntime;
    if (previousFetch) Object.defineProperty(global, "fetch", previousFetch);
    else delete global.fetch;
    for (const timeout of activeTimeouts) previousClearTimeout(timeout);
    activeTimeouts.clear();
    global.setTimeout = previousSetTimeout;
    global.clearTimeout = previousClearTimeout;
    delete require.cache[backgroundPath];
  };
  const fireAlarm = (name) => {
    for (const alarmListener of global.chrome.alarms.onAlarm.listeners) alarmListener({ name });
  };
  return {
    actionState,
    cleanup,
    continuedGopeedTasks,
    deletedGopeedTasks,
    fireAlarm,
    nativeMessages,
    pausedGopeedTasks,
    send,
    sentTabMessages,
    storageAccessState,
    stored,
    get runtimeReloadCount() { return runtimeReloadCount; }
  };
}

async function waitUntil(predicate, message = "等待后台状态更新超时") {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

test("未配置接收地址时一键诊断会脱敏写入 IndexedDB 离线队列", async () => {
  const restoreIndexedDb = installFakeIndexedDb();
  const runtime = require("../runtime/popo-runtime.cjs");
  await runtime.taskStore.resetDatabaseForTests();
  const initialState = transferState();
  initialState.rootUrl = "https://docs.popo.netease.com/team/pc/private/pageDetail/root-secret";
  const harness = createHarness({
    popoState: initialState,
    popoSettings: initialState.settings
  }, {
    runtimeManifest: { version: "0.7.2" }
  });
  try {
    const response = await harness.send({ type: "SEND_DIAGNOSTICS" });
    assert.equal(response.ok, true);
    assert.equal(response.diagnosticStatus.configured, false);
    assert.equal(response.diagnosticStatus.pendingCount, 1);
    const records = await runtime.taskStore.listDiagnosticEvents({ includeDeferred: true });
    assert.equal(records.length, 1);
    assert.equal(records[0].event.message, "MANUAL_DIAGNOSTIC_SNAPSHOT");
    const exported = JSON.stringify(records[0].event);
    assert.doesNotMatch(exported, /active\.mp4|root-secret|private\/pageDetail/);
    assert.match(records[0].event.tags.install, /^h:/);
  } finally {
    harness.cleanup();
    await runtime.taskStore.resetDatabaseForTests();
    restoreIndexedDb();
  }
});

function transferState({ mode = "downloading", jobStatus = mode, includePending = false } = {}) {
  const now = new Date().toISOString();
  const jobId = "job-gopeed-control";
  const rootUrl = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
  const items = [{
    id: "active-file",
    parentUrl: rootUrl,
    name: "active.mp4",
    selected: true,
    status: "transferring",
    stage: "传输中",
    attempts: 1,
    gopeedTaskId: "task-active"
  }];
  if (includePending) {
    items.push({
      id: "pending-file",
      parentUrl: rootUrl,
      name: "pending.mp4",
      selected: true,
      status: "pending",
      attempts: 0
    });
  }
  return {
    version: 4,
    runToken: "run-gopeed-control",
    jobs: [{
      id: jobId,
      key: "key-gopeed-control",
      sourceTabId: 7,
      folderName: "Gopeed 控制测试",
      folderItemIndex: "1",
      parentUrl: rootUrl,
      status: jobStatus,
      cancelRequested: false,
      createdAt: now,
      counts: { files: items.length }
    }],
    activeJobId: jobId,
    mode,
    phase: mode,
    triggerMode: "popup",
    sourceTabId: 7,
    selectedFolderName: "Gopeed 控制测试",
    rootUrl,
    workerFrameId: 42,
    settings: { concurrency: 1, gopeedConnections: 1, maxRetries: 3 },
    items,
    preparingItemId: null,
    activeTransfers: [{ itemId: "active-file", taskId: "task-active" }],
    activeItemId: "active-file",
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    scannedFolderCount: 0,
    logs: [],
    startedAt: now,
    completedAt: ""
  };
}

test("后台启动时把本地状态限制在受信任扩展上下文", () => {
  const harness = createHarness();
  try {
    assert.equal(harness.storageAccessState.accessLevel, "TRUSTED_CONTEXTS");
  } finally {
    harness.cleanup();
  }
});

test("incompatible agent shadow status falls back to the existing signed update path", async () => {
  const harness = createHarness(
    {
      popoSettings: {},
      popoState: {
        version: 4,
        jobs: [],
        activeJobId: null,
        activeTransfers: [],
        mode: "idle",
        phase: "idle",
        settings: {}
      }
    },
    {
      runtimeManifest: { version: "0.7.2", version_name: "0.7.2" },
      async sendNativeMessage(_host, message) {
        if (message.action === "agent_connection") {
          return {
            ok: true,
            endpoint: "http://127.0.0.1:54321",
            token: "not-used-for-an-incompatible-protocol",
            protocol: 3,
            minimumProtocol: 3
          };
        }
        if (message.action === "check_update") {
          return { ok: true, available: false, version: "0.7.2" };
        }
        throw new Error("unexpected native action " + message.action);
      }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-update");
    await waitUntil(() => harness.stored.popoUpdateStatus?.state === "up_to_date");
    assert.equal(harness.stored.popoAgentShadowStatus.available, false);
    assert.equal(harness.stored.popoAgentShadowStatus.errorCode, "AGENT_UNAVAILABLE");
    assert.equal(harness.stored.popoAgentShadowComparison.comparable, false);
    assert.equal(harness.stored.popoAgentShadowComparison.outcome, "shadow_unavailable");
    assert.deepEqual(
      harness.nativeMessages.map(({ message }) => message.action),
      ["agent_connection", "check_update"]
    );
  } finally {
    harness.cleanup();
  }
});

test("reading a saved update failure immediately retries and clears a stale failure", async () => {
  const harness = createHarness(
    {
      popoUpdateStatus: {
        state: "failed",
        currentVersion: "0.7.5",
        targetVersion: "",
        message: "previous transport failure",
        updatedAt: "2026-08-25T00:00:00.000Z"
      },
      popoSettings: {},
      popoState: {
        version: 4,
        jobs: [],
        activeJobId: null,
        activeTransfers: [],
        mode: "idle",
        phase: "idle",
        settings: {}
      }
    },
    {
      runtimeManifest: { version: "0.7.5", version_name: "0.7.5" },
      async sendNativeMessage(_host, message) {
        if (message.action === "agent_connection") {
          throw new Error("shadow agent is optional");
        }
        if (message.action === "check_update") {
          return {
            ok: true,
            available: false,
            currentVersion: "0.7.5",
            installedVersion: "0.7.5",
            runtimeMatchesInstalled: true,
            version: "0.7.4"
          };
        }
        throw new Error("unexpected native action " + message.action);
      }
    }
  );
  try {
    const response = await harness.send({ type: "GET_UPDATE_STATUS" });
    assert.equal(response.ok, true);
    assert.equal(response.updateStatus.state, "checking");
    assert.doesNotMatch(response.updateStatus.message, /failure/i);
    await waitUntil(() => harness.stored.popoUpdateStatus?.state === "up_to_date");
    assert.equal(harness.stored.popoUpdateStatus.currentVersion, "0.7.5");
    assert.equal(harness.stored.popoUpdateStatus.targetVersion, "0.7.4");
    assert.deepEqual(
      harness.nativeMessages.map(({ message }) => message.action),
      ["agent_connection", "check_update"]
    );
  } finally {
    harness.cleanup();
  }
});

test("repeated reads throttle a failing immediate update retry", async () => {
  const harness = createHarness(
    {
      popoUpdateStatus: {
        state: "failed",
        currentVersion: "0.7.5",
        targetVersion: "",
        message: "previous transport failure",
        updatedAt: "2026-08-25T00:00:00.000Z"
      },
      popoSettings: {},
      popoState: {
        version: 4,
        jobs: [],
        activeJobId: null,
        activeTransfers: [],
        mode: "idle",
        phase: "idle",
        settings: {}
      }
    },
    {
      runtimeManifest: { version: "0.7.5", version_name: "0.7.5" },
      async sendNativeMessage(_host, message) {
        if (message.action === "agent_connection") {
          throw new Error("shadow agent unavailable");
        }
        if (message.action === "check_update") {
          throw new Error("legacy native host disconnected");
        }
        throw new Error("unexpected native action " + message.action);
      }
    }
  );
  try {
    const first = await harness.send({ type: "GET_UPDATE_STATUS" });
    assert.equal(first.updateStatus.state, "checking");
    await waitUntil(() => harness.stored.popoUpdateStatus?.state === "failed");
    const messageCount = harness.nativeMessages.length;
    const second = await harness.send({ type: "GET_UPDATE_STATUS" });
    assert.equal(second.updateStatus.state, "failed");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(harness.nativeMessages.length, messageCount);
    assert.equal(messageCount, 2);
  } finally {
    harness.cleanup();
  }
});

test("automatic update reports a managed-install path mismatch instead of claiming up to date", async () => {
  const harness = createHarness(
    {
      popoSettings: {},
      popoState: {
        version: 4,
        jobs: [],
        activeJobId: null,
        activeTransfers: [],
        mode: "idle",
        phase: "idle",
        settings: {}
      }
    },
    {
      runtimeManifest: { version: "0.7.4", version_name: "0.7.4" },
      async sendNativeMessage(_host, message) {
        if (message.action === "agent_connection") {
          throw new Error("agent unavailable in mismatch test");
        }
        if (message.action === "check_update") {
          return {
            ok: true,
            available: false,
            currentVersion: "0.7.4",
            installedVersion: "0.7.2",
            runtimeMatchesInstalled: false,
            version: "0.7.2"
          };
        }
        throw new Error("unexpected native action " + message.action);
      }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-update");
    await waitUntil(() => harness.stored.popoUpdateStatus?.state === "path_mismatch");
    assert.equal(harness.stored.popoUpdateStatus.currentVersion, "0.7.4");
    assert.equal(harness.stored.popoUpdateStatus.targetVersion, "0.7.2");
    assert.match(harness.stored.popoUpdateStatus.message, /运行版本与绿色安装版本不一致/);
    assert.match(harness.stored.popoUpdateStatus.message, /不会自动降级/);
    assert.equal(harness.runtimeReloadCount, 0);
  } finally {
    harness.cleanup();
  }
});

test("successful automatic installation persists its handoff before reloading exactly once", async () => {
  const harness = createHarness(
    {
      popoSettings: {},
      popoState: {
        version: 4,
        jobs: [],
        activeJobId: null,
        activeTransfers: [],
        mode: "idle",
        phase: "idle",
        settings: {}
      }
    },
    {
      runtimeManifest: { version: "0.7.7", version_name: "0.7.7" },
      updatePollDelayMs: 0,
      async sendNativeMessage(_host, message) {
        if (message.action === "agent_connection") throw new Error("shadow agent unavailable");
        if (message.action === "check_update") {
          return {
            ok: true,
            available: true,
            installedVersion: "0.7.7",
            runtimeMatchesInstalled: true,
            version: "0.7.8"
          };
        }
        if (message.action === "apply_update") return { ok: true, started: true };
        if (message.action === "update_status") {
          return {
            ok: true,
            state: "succeeded",
            currentVersion: "0.7.7",
            targetVersion: "0.7.8",
            transactionId: "update-078",
            message: "installed"
          };
        }
        throw new Error("unexpected native action " + message.action);
      }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-update");
    await waitUntil(() => harness.runtimeReloadCount === 1);
    assert.equal(harness.stored.popoUpdateReloadState.targetVersion, "0.7.8");
    assert.equal(harness.stored.popoUpdateReloadState.reloadRequired, true);
    assert.equal(harness.stored.popoUpdateReloadState.reloadAttemptCount, 1);
    assert.ok(Number.isFinite(Date.parse(harness.stored.popoUpdateReloadState.lastReloadRequestedAt)));
    assert.deepEqual(
      harness.nativeMessages.map(({ message }) => message.action),
      ["agent_connection", "check_update", "apply_update", "update_status"]
    );
    assert.deepEqual(
      harness.stored.popoUpdateHandoffLog.map(({ event }) => event),
      ["UPDATE_INSTALL_SUCCEEDED", "UPDATE_RELOAD_REQUIRED", "UPDATE_RELOAD_REQUESTED"]
    );
  } finally {
    harness.cleanup();
  }
});

test("a new service worker recovers a succeeded install that the old worker did not observe", async () => {
  let updateStatusReads = 0;
  const harness = createHarness(
    {
      popoUpdateReloadState: {
        targetVersion: "0.7.8",
        reloadRequired: false,
        reloadAttemptCount: 0,
        lastReloadRequestedAt: ""
      }
    },
    {
      runtimeManifest: { version: "0.7.7", version_name: "0.7.7" },
      updatePollDelayMs: 0,
      async sendNativeMessage(_host, message) {
        assert.equal(message.action, "update_status");
        updateStatusReads += 1;
        if (updateStatusReads === 1) {
          return {
            ok: true,
            state: "installing",
            currentVersion: "0.7.7",
            targetVersion: "0.7.8",
            transactionId: "update-recovered",
            message: "installing"
          };
        }
        return {
          ok: true,
          state: "succeeded",
          currentVersion: "0.7.7",
          targetVersion: "0.7.8",
          transactionId: "update-recovered",
          message: "installed"
        };
      }
    }
  );
  try {
    await waitUntil(() => harness.runtimeReloadCount === 1);
    assert.equal(updateStatusReads, 2);
    assert.equal(harness.stored.popoUpdateStatus.state, "succeeded");
    assert.equal(harness.stored.popoUpdateReloadState.reloadAttemptCount, 1);
    assert.deepEqual(
      harness.stored.popoUpdateHandoffLog.map(({ event }) => event),
      ["UPDATE_INSTALL_SUCCEEDED", "UPDATE_RELOAD_REQUIRED", "UPDATE_RELOAD_REQUESTED"]
    );
  } finally {
    harness.cleanup();
  }
});

test("an installed version newer than the runtime reloads once then remains path_mismatch", async () => {
  const harness = createHarness(
    {
      popoSettings: {},
      popoState: {
        version: 4,
        jobs: [],
        activeJobId: null,
        activeTransfers: [],
        mode: "idle",
        phase: "idle",
        settings: {}
      }
    },
    {
      runtimeManifest: { version: "0.7.7", version_name: "0.7.7" },
      async sendNativeMessage(_host, message) {
        if (message.action === "agent_connection") throw new Error("shadow agent unavailable");
        if (message.action === "check_update") {
          return {
            ok: true,
            available: false,
            installedVersion: "0.7.8",
            runtimeMatchesInstalled: false,
            version: "0.7.8"
          };
        }
        throw new Error("unexpected native action " + message.action);
      }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-update");
    await waitUntil(() => harness.runtimeReloadCount === 1);
    assert.equal(harness.stored.popoUpdateReloadState.reloadAttemptCount, 1);
    harness.fireAlarm("popo-stable-downloader-update");
    await waitUntil(() => harness.stored.popoUpdateStatus?.state === "path_mismatch");
    assert.equal(harness.runtimeReloadCount, 1);
    assert.match(harness.stored.popoUpdateStatus.message, /自动重载已尝试一次/);
    assert.ok(harness.stored.popoUpdateHandoffLog.some(
      ({ event }) => event === "UPDATE_RELOAD_GUARD_EXHAUSTED"
    ));
  } finally {
    harness.cleanup();
  }
});

test("matching installed and runtime versions clear reloadRequired without another reload", async () => {
  const harness = createHarness({
    popoUpdateReloadState: {
      targetVersion: "0.7.8",
      reloadRequired: true,
      reloadAttemptCount: 1,
      lastReloadRequestedAt: "2026-08-28T06:00:00.000Z"
    }
  }, {
    runtimeManifest: { version: "0.7.8", version_name: "0.7.8" }
  });
  try {
    await waitUntil(() => harness.stored.popoUpdateReloadState?.reloadRequired === false);
    assert.equal(harness.runtimeReloadCount, 0);
    assert.equal(harness.stored.popoUpdateReloadState.reloadAttemptCount, 1);
    assert.equal(harness.stored.popoUpdateHandoffLog.at(-1).event, "UPDATE_RUNTIME_CONFIRMED");
  } finally {
    harness.cleanup();
  }
});

test("a recovered handoff never reloads a runtime newer than its installed target", async () => {
  const harness = createHarness({
    popoUpdateReloadState: {
      targetVersion: "0.7.8",
      reloadRequired: true,
      reloadAttemptCount: 0,
      lastReloadRequestedAt: ""
    }
  }, {
    runtimeManifest: { version: "0.7.9", version_name: "0.7.9" }
  });
  try {
    await waitUntil(() => harness.stored.popoUpdateStatus?.state === "path_mismatch");
    assert.equal(harness.runtimeReloadCount, 0);
    assert.match(harness.stored.popoUpdateStatus.message, /不会自动降级或重载/);
  } finally {
    harness.cleanup();
  }
});

test("native messaging failure cannot turn a pending handoff into install success", async () => {
  const harness = createHarness(
    {
      popoUpdateReloadState: {
        targetVersion: "0.7.8",
        reloadRequired: false,
        reloadAttemptCount: 0,
        lastReloadRequestedAt: ""
      }
    },
    {
      runtimeManifest: { version: "0.7.7", version_name: "0.7.7" },
      async sendNativeMessage() {
        throw new Error("native host unavailable");
      }
    }
  );
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(harness.runtimeReloadCount, 0);
    assert.equal(harness.stored.popoUpdateReloadState.reloadRequired, false);
    assert.notEqual(harness.stored.popoUpdateStatus?.state, "succeeded");
  } finally {
    harness.cleanup();
  }
});

test("matching agent and legacy checks persist a comparable shadow diagnostic", async () => {
  const existingHistory = Array.from({ length: 64 }, (_, index) => ({
    schemaVersion: 1,
    outcome: "matched",
    comparable: true,
    matches: true,
    shadowTarget: "0.7.2",
    legacyTarget: "0.7.2",
    shadowState: "idle",
    shadowErrorCode: "",
    legacyErrorCode: "",
    shadowFailureKind: "",
    legacyFailureKind: "",
    shadowTransactionId: `shadow-old-${index}`,
    shadowUpdatedAt: "2026-08-13T00:00:00.000Z",
    checkedAt: new Date(Date.UTC(2026, 7, 13, 0, index)).toISOString(),
    ...(index === 1 ? { secret: "must-not-survive" } : {})
  }));
  const harness = createHarness(
    {
      popoSettings: {},
      popoAgentShadowComparisonHistory: existingHistory,
      popoState: {
        version: 4,
        jobs: [],
        activeJobId: null,
        activeTransfers: [],
        mode: "idle",
        phase: "idle",
        settings: {}
      }
    },
    {
      runtimeManifest: { version: "0.7.2", version_name: "0.7.2" },
      async fetch(url, init) {
        assert.equal(url, "http://127.0.0.1:54321/update-status");
        assert.equal(init.headers["X-Popo-Agent-Token"], "test-agent-token");
        return {
          ok: true,
          async json() {
            return {
              schemaVersion: 1,
              phase: "shadow",
              state: "idle",
              currentVersion: "0.7.2",
              targetVersion: "0.7.2",
              transactionId: "shadow-match",
              errorCode: "",
              protocol: 2,
              minimumProtocol: 1,
              updatedAt: "2026-08-14T00:00:00.000Z"
            };
          }
        };
      },
      async sendNativeMessage(_host, message) {
        if (message.action === "agent_connection") {
          return {
            ok: true,
            endpoint: "http://127.0.0.1:54321",
            token: "test-agent-token",
            protocol: 2,
            minimumProtocol: 1
          };
        }
        if (message.action === "check_update") {
          return {
            ok: true,
            available: false,
            currentVersion: "0.7.2",
            version: "0.7.2"
          };
        }
        throw new Error("unexpected native action " + message.action);
      }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-update");
    await waitUntil(() => harness.stored.popoUpdateStatus?.state === "up_to_date");
    assert.equal(harness.stored.popoAgentShadowComparison.schemaVersion, 1);
    assert.equal(harness.stored.popoAgentShadowComparison.outcome, "matched");
    assert.equal(harness.stored.popoAgentShadowComparison.comparable, true);
    assert.equal(harness.stored.popoAgentShadowComparison.matches, true);
    assert.equal(harness.stored.popoAgentShadowComparison.shadow.validation, "passed");
    assert.equal(harness.stored.popoAgentShadowComparison.legacy.validation, "passed");
    assert.equal(harness.stored.popoAgentShadowComparisonHistory.length, 64);
    assert.equal(harness.stored.popoAgentShadowComparisonHistory[0].shadowTransactionId, "shadow-old-1");
    assert.equal(harness.stored.popoAgentShadowComparisonHistory.at(-1).outcome, "matched");
    assert.equal(
      harness.stored.popoAgentShadowComparisonHistory.at(-1).shadowTransactionId,
      "shadow-match"
    );
    const persistedHistory = JSON.stringify(harness.stored.popoAgentShadowComparisonHistory);
    assert.equal(persistedHistory.includes("must-not-survive"), false);
    assert.equal(persistedHistory.includes("test-agent-token"), false);
    assert.equal(persistedHistory.includes("127.0.0.1:54321"), false);
    assert.deepEqual(
      harness.nativeMessages.map(({ message }) => message.action),
      ["agent_connection", "check_update"]
    );
  } finally {
    harness.cleanup();
  }
});

test("update diagnostics expose only a bounded redacted shadow snapshot", async () => {
  const outcomes = ["matched", "mismatch", "shadow_unavailable", "matched_failure", "legacy_failed"];
  const history = Array.from({ length: 70 }, (_, index) => ({
    schemaVersion: 1,
    outcome: outcomes[index % outcomes.length],
    comparable: index % 5 !== 2,
    matches: index % 5 === 0 || index % 5 === 3,
    shadowTarget: "0.7.3",
    legacyTarget: index % 5 === 1 ? "0.7.2" : "0.7.3",
    shadowState: index % 5 === 2 ? "unavailable" : "available",
    shadowErrorCode: index % 5 === 2 ? "AGENT_UNAVAILABLE" : "",
    legacyErrorCode: index % 5 === 4 ? "LEGACY_NETWORK_ERROR" : "",
    shadowFailureKind: index % 5 === 2 ? "network" : "",
    legacyFailureKind: index % 5 === 4 ? "network" : "",
    shadowTransactionId: `shadow-${index}`,
    shadowUpdatedAt: new Date(Date.UTC(2026, 7, 14, 0, index)).toISOString(),
    checkedAt: new Date(Date.UTC(2026, 7, 14, 1, index)).toISOString(),
    token: "history-secret-token",
    endpoint: "http://127.0.0.1:54321"
  }));
  Object.assign(history[10], {
    shadowTarget: "https://secret.example/version",
    legacyTarget: "D:\\private\\version.txt",
    shadowState: "private-state",
    shadowErrorCode: "SHADOW_SECRET_TOKEN_QWERTY",
    legacyErrorCode: "LEGACY_SECRET_CODE",
    shadowFailureKind: "secret-kind",
    legacyFailureKind: "secret-kind",
    shadowTransactionId: "shadow-C:\\private\\transaction.txt",
    shadowUpdatedAt: "D:\\private\\time.txt"
  });
  const harness = createHarness({
    popoUpdateStatus: {
      state: "path_mismatch",
      currentVersion: "0.7.2",
      targetVersion: "D:\\private\\legacy-version.txt",
      message: "legacy message must not be exported",
      updatedAt: "2026-08-14T01:00:00.000Z"
    },
    popoAgentShadowStatus: {
      available: true,
      state: "checking",
      currentVersion: "0.7.2",
      targetVersion: "https://agent-secret.example/version",
      transactionId: "shadow-current",
      message: "C:\\private\\agent-error.log",
      errorCode: "AGENT_SECRET_TOKEN_QWERTY",
      protocol: 2,
      minimumProtocol: 1,
      updatedAt: "2026-08-14T01:01:00.000Z",
      token: "agent-secret-token",
      endpoint: "http://127.0.0.1:65432"
    },
    popoAgentShadowComparison: {
      ...history.at(-1),
      outcome: "mismatch",
      comparable: true,
      matches: false,
      shadowTransactionId: "shadow-latest",
      checkedAt: "2026-08-14T02:00:00.000Z",
      privatePath: "D:\\private\\package.zip"
    },
    popoAgentShadowComparisonHistory: history,
    popoUpdateReloadState: {
      targetVersion: "D:\\private\\target-version.txt",
      reloadRequired: true,
      reloadAttemptCount: 99,
      lastReloadRequestedAt: "D:\\private\\reload-time.txt"
    },
    popoUpdateHandoffLog: [{
      event: "UPDATE_RELOAD_REQUESTED",
      currentVersion: "0.7.2",
      targetVersion: "0.7.8",
      transactionId: "C:\\private\\transaction.txt",
      at: "2026-08-14T01:02:00.000Z",
      secret: "handoff-secret-token"
    }]
  }, {
    runtimeManifest: { version: "0.7.2", version_name: "0.7.2" }
  });
  try {
    const storedBefore = JSON.stringify(harness.stored);
    const response = await harness.send({ type: "GET_UPDATE_DIAGNOSTICS" });
    assert.equal(response.ok, true);
    assert.equal(response.diagnostics.schemaVersion, 1);
    assert.equal(response.diagnostics.phase, "shadow");
    assert.equal(response.diagnostics.productVersion, "0.7.2");
    assert.equal(response.diagnostics.history.length, 64);
    assert.equal(response.diagnostics.history[0].shadowTransactionId, "shadow-6");
    const poisoned = response.diagnostics.history[4];
    assert.equal(poisoned.shadowTarget, "");
    assert.equal(poisoned.legacyTarget, "");
    assert.equal(poisoned.shadowState, "unavailable");
    assert.equal(poisoned.shadowErrorCode, "");
    assert.equal(poisoned.legacyErrorCode, "");
    assert.equal(poisoned.shadowFailureKind, "");
    assert.equal(poisoned.legacyFailureKind, "");
    assert.equal(poisoned.shadowTransactionId, "");
    assert.equal(poisoned.shadowUpdatedAt, "");
    assert.equal(response.diagnostics.latestComparison.shadowTransactionId, "shadow-latest");
    assert.equal(response.diagnostics.agent.transactionId, "shadow-current");
    assert.equal(response.diagnostics.agent.protocol, 2);
    assert.equal(response.diagnostics.agent.targetVersion, "");
    assert.equal(response.diagnostics.agent.errorCode, "");
    assert.equal(response.diagnostics.legacyUpdate.state, "path_mismatch");
    assert.equal(response.diagnostics.legacyUpdate.targetVersion, "");
    assert.equal(response.diagnostics.updateHandoff.targetVersion, "");
    assert.equal(response.diagnostics.updateHandoff.reloadRequired, false);
    assert.equal(response.diagnostics.updateHandoff.reloadAttemptCount, 0);
    assert.equal(response.diagnostics.updateHandoff.lastReloadRequestedAt, "");
    assert.equal(response.diagnostics.updateHandoff.events.length, 1);
    assert.equal(response.diagnostics.updateHandoff.events[0].transactionId, "");
    assert.equal(response.diagnostics.summary.total, 64);
    assert.ok(response.diagnostics.summary.matched > 0);
    assert.ok(response.diagnostics.summary.mismatched > 0);
    assert.ok(response.diagnostics.summary.unavailable > 0);
    assert.ok(response.diagnostics.summary.failures > 0);
    assert.ok(Number.isFinite(Date.parse(response.diagnostics.generatedAt)));
    const exported = JSON.stringify(response.diagnostics);
    for (const sensitive of [
      "history-secret-token",
      "handoff-secret-token",
      "agent-secret-token",
      "127.0.0.1:54321",
      "127.0.0.1:65432",
      "legacy message must not be exported",
      "private\\agent-error.log",
      "private\\package.zip",
      "private\\transaction.txt",
      "private\\target-version.txt",
      "private\\reload-time.txt",
      "secret.example/version",
      "private\\version.txt",
      "private-state",
      "SECRET_TOKEN_QWERTY",
      "LEGACY_SECRET_CODE",
      "secret-kind",
      "private\\transaction.txt",
      "private\\time.txt",
      "private\\legacy-version.txt",
      "agent-secret.example/version"
    ]) {
      assert.equal(exported.includes(sensitive), false, sensitive);
    }
    assert.equal(JSON.stringify(harness.stored), storedBefore);
  } finally {
    harness.cleanup();
  }
});

test("agent target mismatch is diagnostic only and the legacy result remains authoritative", async () => {
  const harness = createHarness(
    {
      popoSettings: {},
      popoState: {
        version: 4,
        jobs: [],
        activeJobId: null,
        activeTransfers: [],
        mode: "idle",
        phase: "idle",
        settings: {}
      }
    },
    {
      runtimeManifest: { version: "0.7.2", version_name: "0.7.2" },
      async fetch() {
        return {
          ok: true,
          async json() {
            return {
              schemaVersion: 1,
              phase: "shadow",
              state: "available",
              currentVersion: "0.7.2",
              targetVersion: "0.7.3",
              transactionId: "shadow-mismatch",
              errorCode: "",
              protocol: 2,
              minimumProtocol: 1,
              updatedAt: "2026-08-14T00:00:00.000Z"
            };
          }
        };
      },
      async sendNativeMessage(_host, message) {
        if (message.action === "agent_connection") {
          return {
            ok: true,
            endpoint: "http://127.0.0.1:54321",
            token: "test-agent-token",
            protocol: 2,
            minimumProtocol: 1
          };
        }
        if (message.action === "check_update") {
          return {
            ok: true,
            available: false,
            currentVersion: "0.7.2",
            version: "0.7.2"
          };
        }
        throw new Error("unexpected native action " + message.action);
      }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-update");
    await waitUntil(() => harness.stored.popoUpdateStatus?.state === "up_to_date");
    assert.equal(harness.stored.popoAgentShadowComparison.outcome, "mismatch");
    assert.equal(harness.stored.popoAgentShadowComparison.comparable, true);
    assert.equal(harness.stored.popoAgentShadowComparison.matches, false);
    assert.equal(harness.stored.popoUpdateStatus.targetVersion, "0.7.2");
    assert.deepEqual(
      harness.nativeMessages.map(({ message }) => message.action),
      ["agent_connection", "check_update"]
    );
  } finally {
    harness.cleanup();
  }
});

test("legacy check failure is persisted before the existing update flow reports an error", async () => {
  const harness = createHarness(
    {
      popoSettings: {},
      popoState: {
        version: 4,
        jobs: [],
        activeJobId: null,
        activeTransfers: [],
        mode: "idle",
        phase: "idle",
        settings: {}
      }
    },
    {
      runtimeManifest: { version: "0.7.2", version_name: "0.7.2" },
      async fetch() {
        return {
          ok: true,
          async json() {
            return {
              schemaVersion: 1,
              phase: "shadow",
              state: "idle",
              currentVersion: "0.7.2",
              targetVersion: "0.7.2",
              transactionId: "shadow-legacy-failure",
              errorCode: "",
              protocol: 2,
              minimumProtocol: 1,
              updatedAt: "2026-08-14T00:00:00.000Z"
            };
          }
        };
      },
      async sendNativeMessage(_host, message) {
        if (message.action === "agent_connection") {
          return {
            ok: true,
            endpoint: "http://127.0.0.1:54321",
            token: "test-agent-token",
            protocol: 2,
            minimumProtocol: 1
          };
        }
        if (message.action === "check_update") {
          return {
            ok: false,
            error: "simulated signed manifest failure",
            errorCode: "LEGACY_MANIFEST_INVALID"
          };
        }
        throw new Error("unexpected native action " + message.action);
      }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-update");
    await waitUntil(() => harness.stored.popoUpdateStatus?.state === "failed");
    assert.equal(harness.stored.popoAgentShadowComparison.outcome, "legacy_failed");
    assert.equal(harness.stored.popoAgentShadowComparison.legacy.errorCode, "LEGACY_MANIFEST_INVALID");
    assert.equal(harness.stored.popoUpdateStatus.message, "simulated signed manifest failure");
    assert.deepEqual(
      harness.nativeMessages.map(({ message }) => message.action),
      ["agent_connection", "check_update"]
    );
  } finally {
    harness.cleanup();
  }
});

test("legacy native messaging transport failure is retained in shadow history", async () => {
  const harness = createHarness(
    {
      popoSettings: {},
      popoState: {
        version: 4,
        jobs: [],
        activeJobId: null,
        activeTransfers: [],
        mode: "idle",
        phase: "idle",
        settings: {}
      }
    },
    {
      runtimeManifest: { version: "0.7.2", version_name: "0.7.2" },
      async fetch() {
        return {
          ok: true,
          async json() {
            return {
              schemaVersion: 1,
              phase: "shadow",
              state: "idle",
              currentVersion: "0.7.2",
              targetVersion: "0.7.2",
              transactionId: "shadow-legacy-transport",
              errorCode: "",
              protocol: 2,
              minimumProtocol: 1,
              updatedAt: "2026-08-14T00:00:00.000Z"
            };
          }
        };
      },
      async sendNativeMessage(_host, message) {
        if (message.action === "agent_connection") {
          return {
            ok: true,
            endpoint: "http://127.0.0.1:54321",
            token: "test-agent-token",
            protocol: 2,
            minimumProtocol: 1
          };
        }
        if (message.action === "check_update") {
          throw new Error("legacy native host disconnected");
        }
        throw new Error("unexpected native action " + message.action);
      }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-update");
    await waitUntil(() => harness.stored.popoUpdateStatus?.state === "failed");
    assert.equal(harness.stored.popoAgentShadowComparison.outcome, "legacy_failed");
    assert.equal(harness.stored.popoAgentShadowComparison.legacy.failureKind, "transport");
    assert.equal(harness.stored.popoAgentShadowComparisonHistory.length, 1);
    assert.equal(harness.stored.popoAgentShadowComparisonHistory[0].legacyFailureKind, "transport");
    assert.equal(harness.stored.popoUpdateStatus.message, "legacy native host disconnected");
  } finally {
    harness.cleanup();
  }
});

test("agent and legacy signature failures compare by diagnostic category", async () => {
  const harness = createHarness(
    {
      popoSettings: {},
      popoState: {
        version: 4,
        jobs: [],
        activeJobId: null,
        activeTransfers: [],
        mode: "idle",
        phase: "idle",
        settings: {}
      }
    },
    {
      runtimeManifest: { version: "0.7.2", version_name: "0.7.2" },
      async fetch() {
        return {
          ok: true,
          async json() {
            return {
              schemaVersion: 1,
              phase: "shadow",
              state: "failed",
              currentVersion: "0.7.2",
              targetVersion: "",
              transactionId: "shadow-signature-failure",
              errorCode: "SHADOW_SIGNATURE_INVALID",
              protocol: 2,
              minimumProtocol: 1,
              updatedAt: "2026-08-14T00:00:00.000Z"
            };
          }
        };
      },
      async sendNativeMessage(_host, message) {
        if (message.action === "agent_connection") {
          return {
            ok: true,
            endpoint: "http://127.0.0.1:54321",
            token: "test-agent-token",
            protocol: 2,
            minimumProtocol: 1
          };
        }
        if (message.action === "check_update") {
          return {
            ok: false,
            error: "simulated legacy signature failure",
            errorCode: "LEGACY_SIGNATURE_INVALID"
          };
        }
        throw new Error("unexpected native action " + message.action);
      }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-update");
    await waitUntil(() => harness.stored.popoUpdateStatus?.state === "failed");
    assert.equal(harness.stored.popoAgentShadowComparison.outcome, "matched_failure");
    assert.equal(harness.stored.popoAgentShadowComparison.comparable, true);
    assert.equal(harness.stored.popoAgentShadowComparison.matches, true);
    assert.equal(harness.stored.popoAgentShadowComparison.shadow.failureKind, "signature");
    assert.equal(harness.stored.popoAgentShadowComparison.legacy.failureKind, "signature");
  } finally {
    harness.cleanup();
  }
});

test("后台在状态读取前拒绝格式错误的控制命令", async () => {
  const harness = createHarness();
  try {
    const missingJob = await harness.send({ type: "CANCEL_JOB", jobId: "" });
    assert.equal(missingJob.ok, false);
    assert.match(missingJob.error, /jobId/);
    assert.deepEqual(harness.stored, {});
  } finally {
    harness.cleanup();
  }
});

test("文件数量检查完成后无需确认即可自动进入 Gopeed 下载", async () => {
  const now = new Date().toISOString();
  const state = {
    version: 4,
    runToken: "run-auto-start",
    jobs: [{
      id: "job-auto-start",
      key: "key-auto-start",
      sourceTabId: 7,
      folderName: "母文件 A",
      folderItemIndex: "1",
      parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1",
      status: "scanning",
      cancelRequested: false,
      createdAt: now,
      counts: {},
      projectCount: 1
    }],
    activeJobId: "job-auto-start",
    mode: "scanning",
    phase: "scanning",
    triggerMode: "folder_button",
    sourceTabId: 7,
    selectedFolderName: "母文件 A",
    rootProjectCount: 1,
    workerFrameId: 42,
    workerReadyUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/folder1",
    settings: { concurrency: 5, gopeedConnections: 1 },
    items: [{
      id: "file-1",
      name: "a.mp4",
      selected: true,
      status: "pending",
      parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/folder1"
    }],
    activeTransfers: [],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    scannedFolderCount: 0,
    logs: [],
    startedAt: now,
    completedAt: ""
  };
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    { gopeedConfig: { downloadDir: "D:\\Downloads" } }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    for (let attempt = 0; attempt < 30 && harness.stored.popoState.mode !== "downloading"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(harness.stored.popoState.mode, "downloading");
    assert.equal(harness.stored.popoState.phase, "starting");
    assert.equal(harness.stored.popoState.jobs[0].status, "downloading");
    assert.equal(harness.stored.popoState.jobs[0].projectCount, 1);
  } finally {
    harness.cleanup();
  }
});

test("三个母文件夹可按点击顺序入队且重复点击不会新增任务", async () => {
  const harness = createHarness();
  try {
    const base = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
    const first = await harness.send({
      type: "START_FOLDER_SCAN",
      parentUrl: base,
      folderName: "母文件 A",
      folderItemIndex: "1"
    });
    const second = await harness.send({
      type: "START_FOLDER_SCAN",
      parentUrl: base,
      folderName: "母文件 B",
      folderItemIndex: "2"
    });
    const third = await harness.send({
      type: "START_FOLDER_SCAN",
      parentUrl: base,
      folderName: "母文件 C",
      folderItemIndex: "3"
    });
    const duplicate = await harness.send({
      type: "START_FOLDER_SCAN",
      parentUrl: `${base}#ignored`,
      folderName: "母文件 B",
      folderItemIndex: "2"
    });
    const rapidDuplicates = await Promise.all(Array.from({ length: 8 }, () => harness.send({
      type: "START_FOLDER_SCAN",
      parentUrl: base,
      folderName: "母文件 B",
      folderItemIndex: "2"
    })));

    assert.equal(first.ok, true);
    assert.equal(first.needsWorker, true);
    assert.equal(second.queuePosition, 1);
    assert.equal(third.queuePosition, 2);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.job.id, second.job.id);
    assert.ok(rapidDuplicates.every((response) => response.duplicate && response.job.id === second.job.id));

    const snapshot = await harness.send({ type: "GET_STATE" });
    assert.equal(snapshot.state.jobs.length, 3);
    assert.equal(snapshot.state.jobs[0].status, "waiting_worker");
    assert.deepEqual(snapshot.state.jobs.slice(1).map((job) => job.status), ["queued", "queued"]);

    await harness.send({ type: "CANCEL_JOB", jobId: second.job.id });
    await harness.send({ type: "CANCEL_JOB", jobId: first.job.id });
    const advanced = await harness.send({ type: "GET_STATE" });
    assert.equal(advanced.state.activeJobId, third.job.id);
    assert.equal(advanced.state.jobs.some((job) => job.id === second.job.id), false);
    assert.equal(harness.stored.popoState.jobs.find((job) => job.id === second.job.id).status, "cancelled");
    assert.equal(advanced.state.jobs.find((job) => job.id === third.job.id).status, "waiting_worker");
  } finally {
    harness.cleanup();
  }
});

test("一键下载核对完整页面后把每个文件夹分别加入持久化队列", async () => {
  const base = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
  const harness = createHarness({}, {
    async sendTabMessage(_tabId, message) {
      if (message.type !== "SCAN_DIRECTORY") return { ok: true };
      assert.equal(message.hiddenFrame, true);
      assert.equal(message.preserveScroll, undefined);
      return {
        ok: true,
        result: {
          url: base,
          directoryName: "整页素材",
          diagnostics: { expectedItemCount: 3 },
          items: [
            { type: "folder", name: "子文件夹 A", itemIndex: "1" },
            { type: "folder", name: "子文件夹 B", itemIndex: "2" },
            { type: "file", name: "说明.txt", itemIndex: "3" }
          ]
        }
      };
    }
  });
  try {
    const response = await harness.send({
      type: "START_PAGE_DOWNLOAD",
      parentUrl: base,
      pageName: "整页素材"
    });
    const duplicate = await harness.send({
      type: "START_PAGE_DOWNLOAD",
      parentUrl: `${base}#preview`,
      pageName: "整页素材"
    });
    const coveredFolder = await harness.send({
      type: "START_FOLDER_SCAN",
      parentUrl: base,
      folderName: "子文件夹 A",
      folderItemIndex: "1"
    });

    assert.equal(response.ok, true);
    assert.equal(response.needsWorker, true);
    assert.equal(response.addedCount, 2);
    assert.equal(response.folderCount, 2);
    assert.equal(response.countVerified, true);
    assert.match(response.batchId, /^batch-/);
    assert.equal(duplicate.addedCount, 0);
    assert.equal(duplicate.duplicateCount, 2);
    assert.equal(duplicate.batchId, response.batchId);
    assert.equal(coveredFolder.duplicate, true);
    assert.equal(coveredFolder.job.id, response.jobs[0].id);
    assert.equal(harness.stored.popoState.jobs.length, 2);
    assert.equal(harness.stored.popoState.mode, "waiting_worker");
    assert.deepEqual(harness.stored.popoState.jobs.map((job) => job.folderName), [
      "子文件夹 A",
      "子文件夹 B"
    ]);
    assert.deepEqual(harness.stored.popoState.jobs.map((job) => job.status), [
      "waiting_worker",
      "queued"
    ]);
    assert.deepEqual(harness.stored.popoState.jobs.map((job) => job.batchId), [
      response.batchId,
      response.batchId
    ]);
    assert.deepEqual(harness.stored.popoState.jobs.map((job) => job.batchPaused), [false, false]);
    assert.deepEqual(harness.stored.popoState.resolveQueue, [{
      key: response.jobs[0].key,
      rootUrl: base,
      parentUrl: base,
      parentPath: [],
      parentRoute: [],
      name: "子文件夹 A",
      itemIndex: "1"
    }]);
  } finally {
    harness.cleanup();
  }
});

test("一键下载批次可整体暂停继续和移除且不误伤单独任务", async () => {
  const base = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
  const harness = createHarness({}, {
    async sendTabMessage(_tabId, message) {
      if (message.type !== "SCAN_DIRECTORY") return { ok: true };
      return {
        ok: true,
        result: {
          url: base,
          directoryName: "整页素材",
          diagnostics: { expectedItemCount: 3 },
          items: [
            { type: "folder", name: "优先单独下载", itemIndex: "1" },
            { type: "folder", name: "批次文件夹 A", itemIndex: "2" },
            { type: "folder", name: "批次文件夹 B", itemIndex: "3" }
          ]
        }
      };
    }
  });
  try {
    const single = await harness.send({
      type: "START_FOLDER_SCAN",
      parentUrl: base,
      folderName: "优先单独下载",
      folderItemIndex: "1"
    });
    const batch = await harness.send({
      type: "START_PAGE_DOWNLOAD",
      parentUrl: base,
      pageName: "整页素材"
    });

    const paused = await harness.send({
      type: "PAUSE_DOWNLOAD_BATCH",
      batchId: batch.batchId
    });
    assert.equal(paused.ok, true);
    assert.equal(harness.stored.popoState.activeJobId, single.job.id);
    assert.equal(harness.stored.popoState.jobs[0].status, "waiting_worker");
    assert.deepEqual(
      harness.stored.popoState.jobs.slice(1).map((job) => job.batchPaused),
      [true, true]
    );

    await harness.send({ type: "CANCEL_JOB", jobId: single.job.id });
    assert.equal(harness.stored.popoState.activeJobId, null);
    assert.equal(harness.stored.popoState.mode, "idle");

    const resumed = await harness.send({
      type: "RESUME_DOWNLOAD_BATCH",
      batchId: batch.batchId
    });
    assert.equal(resumed.ok, true);
    assert.equal(harness.stored.popoState.activeJobId, batch.jobs[0].id);
    assert.equal(harness.stored.popoState.jobs.find((job) => job.id === batch.jobs[0].id).status, "waiting_worker");
    assert.deepEqual(
      harness.stored.popoState.jobs.filter((job) => job.batchId === batch.batchId)
        .map((job) => job.batchPaused),
      [false, false]
    );

    const removed = await harness.send({
      type: "REMOVE_DOWNLOAD_BATCH",
      batchId: batch.batchId
    });
    assert.equal(removed.ok, true);
    assert.equal(removed.removedCount, 2);
    assert.equal(harness.stored.popoState.jobs.some((job) => job.batchId === batch.batchId), false);
    assert.equal(harness.stored.popoState.activeJobId, null);
    assert.equal(harness.stored.popoState.mode, "idle");
    assert.deepEqual(harness.deletedGopeedTasks, []);
  } finally {
    harness.cleanup();
  }
});

test("一键下载批次暂停会同步暂停当前 Gopeed 任务并可整体继续", async () => {
  const state = transferState({ mode: "downloading", jobStatus: "downloading" });
  state.jobs[0].batchId = "batch-active";
  state.jobs[0].batchParentUrl = state.jobs[0].parentUrl;
  state.jobs[0].batchPaused = false;
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      async getGopeedTask() {
        return { status: "pause", progress: { downloaded: 1024, speed: 0 } };
      }
    }
  );
  try {
    const paused = await harness.send({
      type: "PAUSE_DOWNLOAD_BATCH",
      batchId: "batch-active"
    });
    assert.equal(paused.ok, true);
    assert.equal(paused.state.mode, "paused");
    assert.equal(paused.state.jobs[0].batchPaused, true);
    assert.deepEqual(harness.pausedGopeedTasks, ["task-active"]);

    const resumed = await harness.send({
      type: "RESUME_DOWNLOAD_BATCH",
      batchId: "batch-active"
    });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.state.mode, "downloading");
    assert.equal(resumed.state.jobs[0].batchPaused, false);
    assert.deepEqual(harness.continuedGopeedTasks, ["task-active"]);
  } finally {
    harness.cleanup();
  }
});

test("一键下载批次整体移除会保留已经交给 Gopeed 的文件", async () => {
  const state = transferState({ mode: "downloading", jobStatus: "downloading", includePending: true });
  state.jobs[0].batchId = "batch-remove-active";
  state.jobs[0].batchParentUrl = state.jobs[0].parentUrl;
  state.jobs[0].batchPaused = false;
  state.jobs.push({
    id: "job-batch-queued",
    key: "key-batch-queued",
    sourceTabId: 7,
    folderName: "后续文件夹",
    folderItemIndex: "2",
    parentUrl: state.rootUrl,
    batchId: "batch-remove-active",
    batchParentUrl: state.rootUrl,
    batchPaused: false,
    scope: "folder",
    status: "queued",
    cancelRequested: false,
    createdAt: new Date().toISOString(),
    counts: {}
  });
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      async getGopeedTask() {
        return { status: "running", progress: { downloaded: 1024, speed: 1024 } };
      }
    }
  );
  try {
    const removed = await harness.send({
      type: "REMOVE_DOWNLOAD_BATCH",
      batchId: "batch-remove-active"
    });
    assert.equal(removed.ok, true);
    assert.equal(removed.removedCount, 2);
    assert.equal(harness.stored.popoState.jobs.length, 0);
    assert.equal(harness.stored.popoState.activeJobId, null);
    assert.deepEqual(harness.deletedGopeedTasks, []);
    assert.deepEqual(harness.pausedGopeedTasks, []);
  } finally {
    harness.cleanup();
  }
});

test("一键下载保留已有单项任务优先级并让其余文件夹依次排队", async () => {
  const base = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
  const harness = createHarness({}, {
    async sendTabMessage(_tabId, message) {
      if (message.type !== "SCAN_DIRECTORY") return { ok: true };
      return {
        ok: true,
        result: {
          url: base,
          directoryName: "整页素材",
          diagnostics: { expectedItemCount: 3 },
          items: [
            { type: "folder", name: "优先单独下载", itemIndex: "3" },
            { type: "folder", name: "后续文件夹 A", itemIndex: "4" },
            { type: "folder", name: "后续文件夹 B", itemIndex: "5" }
          ]
        }
      };
    }
  });
  try {
    const folder = await harness.send({
      type: "START_FOLDER_SCAN",
      parentUrl: base,
      folderName: "优先单独下载",
      folderItemIndex: "3"
    });
    const page = await harness.send({
      type: "START_PAGE_DOWNLOAD",
      parentUrl: base,
      pageName: "整页素材"
    });

    assert.equal(page.addedCount, 2);
    assert.equal(page.duplicateCount, 1);
    assert.deepEqual(harness.stored.popoState.jobs.map((job) => job.scope), ["folder", "folder", "folder"]);
    assert.deepEqual(harness.stored.popoState.jobs.map((job) => job.folderName), [
      "优先单独下载",
      "后续文件夹 A",
      "后续文件夹 B"
    ]);

    await harness.send({ type: "CANCEL_JOB", jobId: folder.job.id });
    const state = harness.stored.popoState;
    assert.equal(state.activeJobId, page.jobs[0].id);
    assert.equal(state.jobs.find((job) => job.id === page.jobs[0].id).status, "waiting_worker");
    assert.deepEqual(state.scanQueue, []);
    assert.equal(state.resolveQueue[0].name, "后续文件夹 A");
  } finally {
    harness.cleanup();
  }
});

test("单独文件夹首次定位失败会自动重试且不会立即判定查找失败", async () => {
  const parentUrl = "https://docs.popo.netease.com/team/pc/team1/pageDetail/parent1";
  const childUrl = "https://docs.popo.netease.com/team/pc/team1/pageDetail/child1";
  const state = transferState({ mode: "scanning", jobStatus: "scanning" });
  state.triggerMode = "folder_button";
  state.phase = "resolving_selection";
  state.rootUrl = parentUrl;
  state.workerReadyUrl = parentUrl;
  state.selectedFolderName = "已下载文件夹";
  state.jobs[0].scope = "folder";
  state.jobs[0].folderName = "已下载文件夹";
  state.jobs[0].folderItemIndex = "8";
  state.jobs[0].parentUrl = parentUrl;
  state.items = [];
  state.activeTransfers = [];
  state.activeItemId = null;
  state.scanQueue = [];
  state.resolveQueue = [{
    key: "resolve-downloaded-folder",
    parentUrl,
    parentPath: [],
    name: "已下载文件夹",
    itemIndex: "8"
  }];
  state.scanFailures = [];

  let currentUrl = parentUrl;
  let openAttempts = 0;
  let sendRuntimeMessage;
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      async sendTabMessage(_tabId, message) {
        if (message.type === "NAVIGATE_WORKER") {
          currentUrl = message.url;
          setTimeout(() => {
            void sendRuntimeMessage(
              { type: "REGISTER_WORKER_FRAME", url: message.url },
              { tab: { id: 7, url: message.url }, url: message.url, frameId: 42 }
            );
          }, 0);
          return { ok: true };
        }
        if (message.type === "CLEAN_STATE") return { ok: true, result: {} };
        if (message.type === "PING") return { ok: true, result: { url: currentUrl } };
        if (message.type === "OPEN_ITEM") {
          openAttempts += 1;
          if (openAttempts === 1) {
            return { ok: true, result: { clicked: false, reason: "not_found" } };
          }
          currentUrl = childUrl;
          return { ok: true, result: { clicked: true } };
        }
        return { ok: true, result: {} };
      }
    }
  );
  sendRuntimeMessage = harness.send;

  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => harness.stored.popoState?.resolveQueue?.[0]?.resolveRetries === 1);
    assert.equal(openAttempts, 1);
    assert.deepEqual(harness.stored.popoState.scanFailures, []);
    assert.equal(harness.stored.popoState.jobs[0].status, "scanning");

    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => harness.stored.popoState?.scanQueue?.[0]?.url === childUrl);
    assert.equal(openAttempts, 2);
    assert.deepEqual(harness.stored.popoState.resolveQueue, []);
    assert.deepEqual(harness.stored.popoState.scanFailures, []);
  } finally {
    harness.cleanup();
  }
});

test("同一 URL 的多层子目录按完整路径扫描且不会合并同名文件", async () => {
  const rootUrl = "https://docs.popo.netease.com/team/pc/team1/pageDetail/same1";
  const state = transferState({ mode: "scanning", jobStatus: "scanning" });
  state.triggerMode = "folder_button";
  state.phase = "resolving_selection";
  state.rootUrl = rootUrl;
  state.workerReadyUrl = rootUrl;
  state.selectedFolderName = "河西版本";
  state.jobs[0] = {
    ...state.jobs[0],
    scope: "folder",
    folderName: "河西版本",
    folderItemIndex: "1",
    parentUrl: rootUrl
  };
  state.items = [];
  state.activeTransfers = [];
  state.activeItemId = null;
  state.scanQueue = [];
  state.resolveQueue = [{
    key: "same-url-root",
    rootUrl,
    parentUrl: rootUrl,
    parentPath: [],
    parentRoute: [],
    name: "河西版本",
    itemIndex: "1"
  }];
  state.scanFailures = [];
  state.settings = {
    ...state.settings,
    recursive: true,
    preserveStructure: true,
    timeouts: {
      directoryLoad: 200,
      itemLookup: 200,
      fileOpen: 200,
      scanList: 200
    }
  };

  let route = [];
  let sendRuntimeMessage;
  const routeKey = () => route.join("/");
  const directoryItems = {
    "河西版本": [{ type: "folder", name: "25年4月", itemIndex: "2" }],
    "河西版本/25年4月": [
      { type: "folder", name: "A", itemIndex: "3" },
      { type: "folder", name: "B", itemIndex: "4" }
    ],
    "河西版本/25年4月/A": [
      { type: "file", name: "desktop.ini", itemIndex: "5" }
    ],
    "河西版本/25年4月/B": [
      { type: "file", name: "desktop.ini", itemIndex: "5" }
    ]
  };
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      async sendTabMessage(_tabId, message) {
        if (message.type === "NAVIGATE_WORKER") {
          route = [];
          setTimeout(() => {
            void sendRuntimeMessage(
              { type: "REGISTER_WORKER_FRAME", url: rootUrl },
              { tab: { id: 7, url: rootUrl }, url: rootUrl, frameId: 42 }
            );
          }, 0);
          return { ok: true };
        }
        if (message.type === "CLEAN_STATE") return { ok: true, result: {} };
        if (message.type === "PING") {
          const directoryName = route.at(-1) || "根目录";
          return {
            ok: true,
            result: { url: rootUrl, directoryName, contextKey: `${rootUrl}\u0000${routeKey()}` }
          };
        }
        if (message.type === "OPEN_ITEM") {
          route.push(message.name);
          return { ok: true, result: { clicked: true } };
        }
        if (message.type === "SCAN_DIRECTORY") {
          const items = directoryItems[routeKey()] || [];
          return {
            ok: true,
            result: {
              directoryName: route.at(-1) || "根目录",
              url: rootUrl,
              diagnostics: { expectedItemCount: items.length },
              items
            }
          };
        }
        return { ok: true, result: {} };
      }
    }
  );
  sendRuntimeMessage = harness.send;

  try {
    for (let attempt = 0; attempt < 24; attempt += 1) {
      harness.fireAlarm("popo-stable-downloader-pump");
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (harness.stored.popoState?.jobs?.[0]?.status === "complete") break;
    }
    await waitUntil(() => harness.stored.popoState?.jobs?.[0]?.status === "complete");
    const storedItems = Object.entries(harness.stored)
      .filter(([key]) => key.startsWith("popoItems:job-gopeed-control:"))
      .flatMap(([, items]) => items);
    assert.equal(storedItems.length, 2);
    assert.deepEqual(
      storedItems.map((item) => item.directoryPath.join("/")).sort(),
      ["河西版本/25年4月/A", "河西版本/25年4月/B"]
    );
    assert.deepEqual(
      storedItems.map((item) => item.directoryRoute.map((step) => step.name).join("/")).sort(),
      ["河西版本/25年4月/A", "河西版本/25年4月/B"]
    );
    assert.equal(new Set(storedItems.map((item) => item.id)).size, 2);
    assert.equal(harness.stored.popoState.jobs[0].counts.scanFailures, 0);
    assert.equal(harness.stored.popoState.jobs[0].counts.unverifiedDirectories, 0);
  } finally {
    harness.cleanup();
  }
});

test("目录短暂读取失败自动重扫，耗尽后保留定位且继续队列", async () => {
  const rootUrl = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
  const state = transferState({ mode: "scanning", jobStatus: "scanning" });
  state.items = [];
  state.triggerMode = "folder_button";
  state.workerReadyUrl = rootUrl;
  state.activeTransfers = [];
  state.scanQueue = [{ url: rootUrl, path: ["素材"] }];
  let attempts = 0;
  let sendRuntimeMessage;
  const harness = createHarness({ popoState: state, popoSettings: state.settings }, {
    async sendTabMessage(_tabId, message) {
      if (message.type === "NAVIGATE_WORKER") {
        setTimeout(() => void sendRuntimeMessage(
          { type: "REGISTER_WORKER_FRAME", url: message.url },
          { tab: { id: 7, url: message.url }, url: message.url, frameId: 42 }
        ), 0);
      }
      if (message.type === "SCAN_DIRECTORY") {
        attempts += 1;
        return { ok: false, error: "目录加载超时" };
      }
      if (message.type === "PING") return { ok: true, result: { url: rootUrl } };
      return { ok: true, result: {} };
    }
  });
  sendRuntimeMessage = harness.send;
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      harness.fireAlarm("popo-stable-downloader-pump");
      await waitUntil(() => attempts >= attempt);
      await waitUntil(() => attempt < 3
        ? harness.stored.popoState.scanQueue[0]?.scanRetries === attempt
        : harness.stored.popoState.scanFailures.length === 1);
      assert.equal(harness.stored.popoState.scanFailures.length, attempt < 3 ? 0 : 1);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const response = await harness.send({ type: "GET_STATE" });
    assert.equal(response.state.jobs[0].failureEntries[0].kind, "directory");
    assert.deepEqual(response.state.jobs[0].failureEntries[0].path, ["素材"]);
    assert.equal(attempts, 3);
  } finally { harness.cleanup(); }
});

test("单项文件重试只读父目录，保留其他失败并拒绝伪造条目", async () => {
  const rootUrl = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
  const id = encodeURIComponent(`${rootUrl}\u0000素材\u00001\u0000a.png`);
  const failures = [
    { id, kind: "file", name: "a.png", path: ["素材"], retryKey: "key-a", url: rootUrl, rootUrl, route: [] },
    { id: "file-b", kind: "file", name: "b.png", path: ["素材"], retryKey: "key-b", url: rootUrl, rootUrl, route: [] }
  ];
  const source = { id: "source", key: "source-key", status: "failed", sourceTabId: 7,
    folderName: "素材", parentUrl: rootUrl, folderItemIndex: "1",
    counts: { files: 68, success: 66, failed: 2 }, failureEntries: failures, failureRetryKeys: ["key-a", "key-b"] };
  const harness = createHarness({ popoState: { version: 4, jobs: [source], mode: "idle" } });
  try {
    const invalid = await harness.send({ type: "RETRY_JOB_ITEM", jobId: "source", failureId: "fake" });
    assert.equal(invalid.ok, false);
    assert.equal(harness.stored.popoState.jobs.length, 1);
    const response = await harness.send({ type: "RETRY_JOB_ITEM", jobId: "source", failureId: id });
    assert.equal(response.ok, true, response.error);
    const retry = response.state.jobs.find((job) => job.retryOfJobId === "source");
    assert.equal(retry.retainedCounts.success, 66);
    assert.deepEqual(retry.retainedFailures, [failures[1]]);
    assert.equal(retry.retrySelection.id, id);
    assert.equal(harness.stored.popoState.resolveQueue.length, 0);
    assert.deepEqual(harness.stored.popoState.scanQueue[0].path, ["素材"]);
    await harness.send({ type: "RETRY_JOB_ITEM", jobId: "source", failureId: id });
    assert.equal(harness.stored.popoState.jobs.length, 2);
  } finally { harness.cleanup(); }
});

test("单项目录补下不受原任务失败文件筛选限制", async () => {
  const rootUrl = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
  const failure = { id: "dir-1", kind: "directory", name: "子目录", path: ["素材", "子目录"],
    url: rootUrl, rootUrl, route: [{ name: "子目录", itemIndex: "2" }] };
  const source = { id: "source-dir", key: "source-dir-key", status: "failed", sourceTabId: 7,
    folderName: "素材", parentUrl: rootUrl, folderItemIndex: "1",
    counts: { files: 2, success: 1, failed: 1, scanFailures: 1 },
    failureEntries: [failure], failureRetryKeys: ["failed-file-outside-directory"] };
  const harness = createHarness({ popoState: { version: 4, jobs: [source], mode: "idle" } });
  try {
    const response = await harness.send({ type: "RETRY_JOB_ITEM", jobId: source.id, failureId: failure.id });
    assert.equal(response.ok, true, response.error);
    const job = response.state.jobs.find((entry) => entry.retryOfJobId === source.id);
    assert.deepEqual(job.retryKeys, []);
    assert.deepEqual(harness.stored.popoState.scanQueue[0].route, failure.route);
  } finally { harness.cleanup(); }
});

for (const missing of [false, true]) {
  test(`单项补下实际扫描只选择目标文件，目标${missing ? "消失仍保留失败" : "存在时不进入兄弟目录"}`, async () => {
    const rootUrl = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
    const id = encodeURIComponent(`${rootUrl}\u0000素材\u00001\u0000a.png`);
    const target = { id, kind: "file", name: "a.png", path: ["素材"], retryKey: "key-a", url: rootUrl, rootUrl, route: [] };
    const other = { ...target, id: "file-b", name: "b.png", retryKey: "key-b" };
    const source = { id: "scan-source", key: "scan-source-key", status: "failed", sourceTabId: 7,
      folderName: "素材", parentUrl: rootUrl, folderItemIndex: "1",
      counts: { files: 68, success: 66, failed: 2 }, failureEntries: [target, other], failureRetryKeys: ["key-a", "key-b"] };
    let send;
    const harness = createHarness({ popoState: { version: 4, jobs: [source], mode: "idle" } }, {
      async sendTabMessage(_tabId, message) {
        if (message.type === "NAVIGATE_WORKER") setTimeout(() => void send(
          { type: "REGISTER_WORKER_FRAME", url: message.url },
          { tab: { id: 7, url: message.url }, url: message.url, frameId: 42 }
        ), 0);
        if (message.type === "PING") return { ok: true, result: { url: rootUrl, directoryName: "素材" } };
        if (message.type === "SCAN_DIRECTORY") {
          const items = [
            ...(!missing ? [{ name: "a.png", itemIndex: "1", type: "file" }] : []),
            { name: "b.png", itemIndex: "2", type: "file" }, { name: "兄弟目录", itemIndex: "3", type: "folder" }
          ];
          return { ok: true, result: { url: rootUrl, directoryName: "素材", items, diagnostics: { expectedItemCount: items.length } } };
        }
        return { ok: true, result: {} };
      }
    });
    send = harness.send;
    try {
      const result = await send({ type: "RETRY_JOB_ITEM", jobId: source.id, failureId: id });
      assert.equal(result.ok, true, result.error);
      const retryId = harness.stored.popoState.activeJobId;
      await send({ type: "REGISTER_WORKER_FRAME", url: rootUrl },
        { tab: { id: 7, url: rootUrl }, url: rootUrl, frameId: 42 });
      harness.fireAlarm("popo-stable-downloader-pump");
      await waitUntil(() => harness.stored.popoState.itemChunkCount > 0);
      const items = Object.entries(harness.stored).filter(([key]) => key.startsWith(`popoItems:${retryId}:`)).flatMap(([, entries]) => entries);
      assert.deepEqual(items.filter((item) => item.selected).map((item) => item.name), missing ? [] : ["a.png"]);
      assert.deepEqual(harness.stored.popoState.resolveQueue, []);
      assert.equal(harness.stored.popoState.jobs.find((job) => job.id === retryId).counts.success, 66);
      if (missing) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        harness.fireAlarm("popo-stable-downloader-pump");
        await waitUntil(() => harness.stored.popoState.jobs.find((job) => job.id === retryId).status === "failed");
        const failed = (await send({ type: "GET_STATE" })).state.jobs.find((job) => job.id === retryId);
        assert.ok(failed, JSON.stringify(harness.stored.popoState.jobs.map((job) => ({ id: job.id, status: job.status, retryOfJobId: job.retryOfJobId, createdAt: job.createdAt }))));
        assert.equal(failed.failureEntries.length, 2);
        assert.equal(failed.counts.failed, 2);
        assert.match(failed.failureEntries.find((entry) => entry.id === id).error, /未找到/);
      }
    } finally { harness.cleanup(); }
  });
}

test("遗漏目录可以重扫整个文件夹而不要求先有失败文件", async () => {
  const rootUrl = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
  const now = new Date().toISOString();
  const state = {
    version: 4,
    runToken: "run-directory-retry",
    jobs: [{
      id: "job-directory-incomplete",
      key: "folder-directory-incomplete",
      sourceTabId: 7,
      folderName: "25年4月",
      folderItemIndex: "3",
      parentUrl: rootUrl,
      status: "failed",
      createdAt: now,
      completedAt: now,
      counts: {
        files: 3,
        success: 3,
        failed: 0,
        scanFailures: 1,
        unverifiedDirectories: 1
      },
      failureRetryKeys: []
    }],
    activeJobId: null,
    mode: "idle",
    phase: "idle",
    settings: { concurrency: 1, gopeedConnections: 1 },
    items: [],
    activeTransfers: [],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    logs: []
  };
  const harness = createHarness({ popoSettings: state.settings, popoState: state });
  try {
    const response = await harness.send({
      type: "RETRY_JOB",
      jobId: "job-directory-incomplete"
    });
    assert.equal(response.ok, true);
    const retry = harness.stored.popoState.jobs.find(
      (job) => job.retryOfJobId === "job-directory-incomplete"
    );
    assert.ok(retry);
    assert.deepEqual(retry.retryKeys, []);
    assert.equal(retry.status, "waiting_worker");
    assert.equal(retry.displayName, "25年4月（重试未完成项）");
    assert.equal(harness.stored.popoState.resolveQueue[0].name, "25年4月");
  } finally {
    harness.cleanup();
  }
});

test("重试失败项目只选择未完成文件并保留原已完成记录", async () => {
  const now = new Date().toISOString();
  const parentUrl = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
  const failedKey = `${parentUrl}\u0000failed.jpg`;
  const source = {
    id: "job-retry-source", key: "folder-retry-source", sourceTabId: 7,
    folderName: "素材", folderItemIndex: "2", parentUrl,
    status: "failed", createdAt: now, completedAt: now,
    counts: { files: 2, success: 1, failed: 1, scanFailures: 0 },
    failureRetryKeys: [failedKey]
  };
  const state = {
    version: 4, runToken: "run-retry-only-missing", jobs: [source], activeJobId: null,
    mode: "idle", phase: "idle", settings: { concurrency: 1, gopeedConnections: 1 },
    items: [], activeTransfers: [], scanQueue: [], resolveQueue: [], scanFailures: [], logs: []
  };
  const harness = createHarness({ popoSettings: state.settings, popoState: state });
  try {
    const result = await harness.send({ type: "RETRY_JOB", jobId: source.id });
    assert.equal(result.ok, true);
    const retry = harness.stored.popoState.jobs.find((job) => job.retryOfJobId === source.id);
    assert.deepEqual(retry.retryKeys, [failedKey]);
    assert.equal(harness.stored.popoState.jobs.find((job) => job.id === source.id).counts.success, 1);
    assert.deepEqual(harness.stored.popoState.activeTransfers, []);
  } finally {
    harness.cleanup();
  }
});

test("两分钟内一键下载和单独点击都保留已有绿色完整性反馈", async () => {
  const base = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
  const completedKey = makeFolderJobKey({
    parentUrl: base,
    folderItemIndex: "1",
    folderName: "已下载文件夹"
  });
  const now = new Date().toISOString();
  const harness = createHarness({
    popoState: {
      version: 4,
      downloadReceiptVerificationVersion: 1,
      runToken: "run-receipt",
      jobs: [],
      folderReceipts: [{
        key: completedKey,
        parentUrl: base,
        folderItemIndex: "1",
        folderName: "已下载文件夹",
        completedAt: now,
        counts: { files: 6, discoveredFiles: 6, success: 6 }
      }],
      activeJobId: null,
      mode: "idle"
    }
  }, {
    async sendTabMessage(_tabId, message) {
      if (message.type !== "SCAN_DIRECTORY") return { ok: true };
      return {
        ok: true,
        result: {
          url: base,
          directoryName: "整页素材",
          diagnostics: { expectedItemCount: 2 },
          items: [
            { type: "folder", name: "已下载文件夹", itemIndex: "1" },
            { type: "folder", name: "待下载文件夹", itemIndex: "2" }
          ]
        }
      };
    }
  });
  try {
    const page = await harness.send({
      type: "START_PAGE_DOWNLOAD",
      parentUrl: base,
      pageName: "整页素材"
    });
    assert.equal(page.addedCount, 1);
    assert.equal(page.completedCount, 1);
    assert.equal(page.jobs[0].folderName, "待下载文件夹");
    assert.equal(page.state.folderReceipts[0].key, completedKey);

    const single = await harness.send({
      type: "START_FOLDER_SCAN",
      parentUrl: base,
      folderName: "已下载文件夹",
      folderItemIndex: "1"
    });
    assert.equal(single.duplicate, true);
    assert.equal(single.alreadyCompleted, true);
    assert.equal(single.needsWorker, false);
    assert.equal(single.job.status, "complete");
    assert.equal(single.job.verifiedCompletion, true);
    assert.equal(harness.stored.popoState.folderReceipts.length, 1);
    assert.equal(harness.stored.popoState.folderReceipts[0].key, completedKey);
    assert.deepEqual(harness.stored.popoState.jobs.map((job) => job.folderName), [
      "待下载文件夹"
    ]);
  } finally {
    harness.cleanup();
  }
});

test("升级到本机文件复核后清除旧版未复核的绿色凭证", async () => {
  const base = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
  const harness = createHarness({
    popoState: {
      version: 4,
      runToken: "run-unverified-receipt",
      jobs: [],
      folderReceipts: [{
        parentUrl: base,
        folderItemIndex: "1",
        folderName: "旧版已下载文件夹",
        completedAt: new Date().toISOString(),
        counts: { files: 2, discoveredFiles: 2, success: 2 }
      }],
      activeJobId: null,
      mode: "idle"
    }
  });
  try {
    const snapshot = await harness.send({ type: "GET_STATE" });
    assert.deepEqual(snapshot.state.folderReceipts, []);
  } finally {
    harness.cleanup();
  }
});

test("绿色完整性反馈超过两分钟后单独点击会重新扫描并保留历史凭证", async () => {
  const base = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
  const completedKey = makeFolderJobKey({
    parentUrl: base,
    folderItemIndex: "1",
    folderName: "已下载文件夹"
  });
  const harness = createHarness({
    popoState: {
      version: 4,
      downloadReceiptVerificationVersion: 1,
      runToken: "run-expired-receipt-single",
      jobs: [],
      folderReceipts: [{
        key: completedKey,
        parentUrl: base,
        folderItemIndex: "1",
        folderName: "已下载文件夹",
        completedAt: new Date(Date.now() - 120001).toISOString(),
        counts: { files: 6, discoveredFiles: 6, success: 6 }
      }],
      activeJobId: null,
      mode: "idle"
    }
  });
  try {
    const response = await harness.send({
      type: "START_FOLDER_SCAN",
      parentUrl: base,
      folderName: "已下载文件夹",
      folderItemIndex: "1"
    });
    assert.equal(response.duplicate, false);
    assert.equal(response.alreadyCompleted, false);
    assert.equal(response.needsWorker, true);
    assert.equal(response.job.status, "waiting_worker");
    assert.equal(harness.stored.popoState.folderReceipts.length, 1);
    assert.equal(harness.stored.popoState.folderReceipts[0].key, completedKey);
  } finally {
    harness.cleanup();
  }
});

test("绿色完整性反馈超过两分钟后一键下载会重新加入逐文件查重队列", async () => {
  const base = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
  const completedKey = makeFolderJobKey({
    parentUrl: base,
    folderItemIndex: "1",
    folderName: "已下载文件夹"
  });
  const harness = createHarness({
    popoState: {
      version: 4,
      downloadReceiptVerificationVersion: 1,
      runToken: "run-expired-receipt-page",
      jobs: [],
      folderReceipts: [{
        key: completedKey,
        parentUrl: base,
        folderItemIndex: "1",
        folderName: "已下载文件夹",
        completedAt: new Date(Date.now() - 120001).toISOString(),
        counts: { files: 6, discoveredFiles: 6, success: 6 }
      }],
      activeJobId: null,
      mode: "idle"
    }
  }, {
    async sendTabMessage(_tabId, message) {
      if (message.type !== "SCAN_DIRECTORY") return { ok: true };
      return {
        ok: true,
        result: {
          url: base,
          directoryName: "整页素材",
          diagnostics: { expectedItemCount: 1 },
          items: [{ type: "folder", name: "已下载文件夹", itemIndex: "1" }]
        }
      };
    }
  });
  try {
    const response = await harness.send({
      type: "START_PAGE_DOWNLOAD",
      parentUrl: base,
      pageName: "整页素材"
    });
    assert.equal(response.addedCount, 1);
    assert.equal(response.completedCount, 0);
    assert.equal(response.jobs[0].folderName, "已下载文件夹");
    assert.equal(harness.stored.popoState.folderReceipts.length, 1);
  } finally {
    harness.cleanup();
  }
});

test("一键下载无法核对页面总数时不会建立不完整队列", async () => {
  const base = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
  const harness = createHarness({}, {
    async sendTabMessage(_tabId, message) {
      if (message.type !== "SCAN_DIRECTORY") return { ok: true };
      return {
        ok: true,
        result: {
          url: base,
          directoryName: "整页素材",
          diagnostics: { expectedItemCount: null },
          items: [{ type: "folder", name: "无法闭环", itemIndex: "1" }]
        }
      };
    }
  });
  try {
    const response = await harness.send({
      type: "START_PAGE_DOWNLOAD",
      parentUrl: base,
      pageName: "整页素材"
    });
    assert.equal(response.ok, false);
    assert.match(response.error, /防止漏掉文件夹/);
    assert.equal(harness.stored.popoState, undefined);
  } finally {
    harness.cleanup();
  }
});

test("单独文件夹全部成功且数量闭环后写入持久化绿色凭证", async () => {
  const state = transferState();
  const job = state.jobs[0];
  job.key = makeFolderJobKey({
    parentUrl: job.parentUrl,
    folderItemIndex: job.folderItemIndex,
    folderName: job.folderName
  });
  job.scope = "folder";
  job.startedAt = "2026-11-17T10:00:00.000Z";
  job.scanCompletedAt = "2026-11-17T10:00:04.000Z";
  job.scanVia = "api";
  state.items = [{
    id: "completed-file",
    parentUrl: job.parentUrl,
    name: "completed.psd",
    selected: true,
    status: "success",
    attempts: 1,
    gopeedTaskId: "task-completed"
  }];
  state.activeTransfers = [];
  state.activeItemId = null;
  state.preparingItemId = null;
  state.scanQueue = [];
  state.resolveQueue = [];
  state.scanFailures = [];
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    { gopeedConfig: { downloadDir: "D:\\Downloads" } }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => harness.stored.popoState?.activeJobId == null);
    assert.equal(harness.stored.popoState.jobs[0].status, "complete");
    assert.equal(harness.stored.popoState.folderReceipts.length, 1);
    assert.equal(harness.stored.popoState.folderReceipts[0].key, job.key);
    assert.deepEqual(harness.stored.popoState.folderReceipts[0].counts, {
      files: 1,
      discoveredFiles: 1,
      folders: 0,
      success: 1,
      failed: 0,
      cancelled: 0,
      scanFailures: 0,
      verifiedDirectories: 0,
      unverifiedDirectories: 0
    });
    // 任务结束后从列表消失，用时与扫描方式随凭证保留，页面据此给出完成提示。
    const receipt = harness.stored.popoState.folderReceipts[0];
    assert.equal(receipt.startedAt, "2026-11-17T10:00:00.000Z");
    assert.equal(receipt.scanCompletedAt, "2026-11-17T10:00:04.000Z");
    assert.equal(receipt.scanVia, "api");
    const snapshot = await harness.send({ type: "GET_STATE" });
    assert.equal(snapshot.state.jobs.length, 0);
    assert.equal(snapshot.state.folderReceipts[0].folderName, job.folderName);
  } finally {
    harness.cleanup();
  }
});

test("下载前按稳定素材身份跨目录跳过 Gopeed 中已成功的单个文件", async () => {
  const state = transferState({ includePending: true });
  const pending = state.items.find((item) => item.id === "pending-file");
  pending.directoryPath = [state.selectedFolderName];
  const stableLabels = buildTaskIdentityLabels({
    jobId: "job-previous-download",
    taskIdentity: pending.id
  });
  state.items = [pending];
  state.activeTransfers = [];
  state.activeItemId = null;
  state.workerFrameId = null;
  state.jobs[0].counts = { files: 1 };
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      gopeedConfig: { downloadDir: "D:\\Downloads" },
      gopeedTasks: [{
        id: "task-already-done",
        status: "done",
        meta: {
          req: { labels: { source: "popo-stable-downloader", ...stableLabels } },
          opts: {
            path: "D:\\Downloads\\POPO稳定下载\\旧的目录层级",
            name: "pending.mp4"
          },
          res: { files: [{ name: "pending.mp4", size: 2048 }] }
        }
      }],
      async sendNativeMessage(_host, message) {
        assert.equal(message.action, "verify_files");
        return {
          ok: true,
          files: message.files.map((file) => ({
            key: file.key,
            exists: true,
            size: 2048,
            sizeMatches: true
          }))
        };
      }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() =>
      harness.stored["popoItems:job-gopeed-control:0"]?.[0]?.status === "success"
    );
    const storedItem = harness.stored["popoItems:job-gopeed-control:0"][0];
    assert.equal(storedItem.stage, "已成功下载，已跳过");
    assert.equal(storedItem.deduplicated, true);
    assert.equal(storedItem.attempts, 0);
    assert.equal(harness.stored.popoState.jobs[0].downloadDedupeSkipped, 1);
    assert.equal(harness.stored.popoState.jobs[0].downloadDedupeIdentityCount, 1);
    assert.equal(harness.stored.popoState.jobs[0].downloadDedupeTargetCount, 1);
    assert.ok(harness.stored.popoState.jobs[0].downloadDedupeLoadedAt);
    assert.equal(harness.sentTabMessages.some(({ message }) => message.type === "OPEN_ITEM"), false);
    const snapshot = await harness.send({ type: "GET_STATE" });
    assert.equal(snapshot.state.jobs[0].successfulGopeedTargetKeys, undefined);
  } finally {
    harness.cleanup();
  }
});

test("Gopeed 旧成功记录对应文件已不存在时不会误判已下载", async () => {
  const state = transferState({ includePending: true });
  const pending = state.items.find((item) => item.id === "pending-file");
  pending.directoryPath = [state.selectedFolderName];
  const stableLabels = buildTaskIdentityLabels({
    jobId: "job-previous-download",
    taskIdentity: pending.id
  });
  state.items = [pending];
  state.activeTransfers = [];
  state.activeItemId = null;
  state.workerFrameId = null;
  state.jobs[0].counts = { files: 1 };
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      gopeedConfig: { downloadDir: "D:\\Downloads" },
      gopeedTasks: [{
        id: "task-stale-done",
        status: "done",
        meta: {
          req: { labels: { source: "popo-stable-downloader", ...stableLabels } },
          opts: {
            path: "D:\\Downloads\\POPO稳定下载\\已删除目录",
            name: "pending.mp4"
          },
          res: { files: [{ name: "pending.mp4", size: 2048 }] }
        }
      }],
      async sendNativeMessage(_host, message) {
        assert.equal(message.action, "verify_files");
        return {
          ok: true,
          files: message.files.map((file) => ({
            key: file.key,
            exists: false,
            size: 0,
            sizeMatches: false
          }))
        };
      }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => harness.stored.popoState?.logs?.some((entry) =>
      entry.code === "DOWNLOAD_DEDUPE_STALE_RECORD"
    ));
    const storedItem = harness.stored["popoItems:job-gopeed-control:0"][0];
    assert.equal(storedItem.status, "pending");
    assert.notEqual(storedItem.deduplicated, true);
    assert.equal(storedItem.attempts, 1);
    assert.equal(Number(harness.stored.popoState.jobs[0].downloadDedupeSkipped) || 0, 0);
  } finally {
    harness.cleanup();
  }
});

test("本机去重核对多次失败时停止该文件并保留重试，避免重复创建任务", async () => {
  const state = transferState({ includePending: true });
  const pending = state.items.find((item) => item.id === "pending-file");
  pending.directoryPath = [state.selectedFolderName];
  const stableLabels = buildTaskIdentityLabels({
    jobId: "job-previous-download",
    taskIdentity: pending.id
  });
  state.items = [pending];
  state.activeTransfers = [];
  state.activeItemId = null;
  state.workerFrameId = null;
  state.jobs[0].counts = { files: 1 };
  let verifyAttempts = 0;
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      gopeedConfig: { downloadDir: "D:\\Downloads" },
      gopeedTasks: [{
        id: "task-stale-done",
        status: "done",
        meta: {
          req: { labels: { source: "popo-stable-downloader", ...stableLabels } },
          opts: {
            path: "D:\\Downloads\\POPO稳定下载\\已删除目录",
            name: "pending.mp4"
          },
          res: { files: [{ name: "pending.mp4", size: 2048 }] }
        }
      }],
      async sendNativeMessage(_host, message) {
        if (message.action === "verify_files") {
          verifyAttempts += 1;
          throw new Error("native host pipe disconnected");
        }
        return { ok: true };
      }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => harness.stored.popoState?.phase === "checking_download_files");
    assert.equal(verifyAttempts, 1);

    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => verifyAttempts === 2);

    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => harness.stored.popoState?.logs?.some((entry) =>
      entry.code === "DOWNLOAD_DEDUPE_VERIFY_FAILED"
    ));
    assert.ok(harness.stored.popoState.logs.some((entry) =>
      entry.code === "DOWNLOAD_DEDUPE_VERIFY_FAILED"
    ));
    const storedItem = harness.stored["popoItems:job-gopeed-control:0"][0];
    assert.equal(storedItem.status, "failed");
    assert.equal(storedItem.failureStage, "本地文件核对");
    assert.equal(storedItem.attempts, 0);
    assert.equal(harness.sentTabMessages.some(({ message }) => message.type === "OPEN_ITEM"), false);
  } finally {
    harness.cleanup();
  }
});

test("目录扫描完成后任务带目录汇总（预计、实际、核对状态）", async () => {
  const state = transferState({ mode: "scanning", jobStatus: "scanning" });
  state.items = [];
  state.triggerMode = "folder_button";
  state.workerReadyUrl = state.rootUrl;
  state.activeTransfers = [];
  state.activeItemId = null;
  state.scanQueue = [{ url: state.rootUrl, path: ["素材"] }];
  let send;
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      async sendTabMessage(_tabId, message) {
        if (message.type === "NAVIGATE_WORKER") setTimeout(() => void send(
          { type: "REGISTER_WORKER_FRAME", url: message.url },
          { tab: { id: 7, url: message.url }, url: message.url, frameId: 42 }
        ), 0);
        if (message.type === "PING") return { ok: true, result: { url: state.rootUrl, directoryName: "素材" } };
        if (message.type === "SCAN_DIRECTORY") {
          const items = [{ name: "a.png", itemIndex: "0", type: "file" }, { name: "b.png", itemIndex: "1", type: "file" }];
          return { ok: true, result: { url: state.rootUrl, directoryName: "素材", items, diagnostics: { expectedItemCount: 2 } } };
        }
        return { ok: true, result: {} };
      }
    }
  );
  send = harness.send;
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => harness.stored.popoState?.directoryScans?.length === 1);
    const snapshot = await harness.send({ type: "GET_STATE" });
    const directory = snapshot.state.jobs[0].directories[0];
    assert.deepEqual(
      { path: directory.path, expected: directory.expected, found: directory.found, status: directory.status },
      { path: ["素材"], expected: 2, found: 2, status: "verified" }
    );
  } finally {
    harness.cleanup();
  }
});

function failingJobState({ reason = "operation_failed", autoRetryRound, withBatchPeer = false } = {}) {
  const state = transferState();
  const rootUrl = state.rootUrl;
  state.items = [{
    id: "failed-file", name: "x.png", itemIndex: "1", selected: true, status: "failed",
    failureStage: "目录加载失败", error: "超时", failureReason: reason, attempts: 3,
    directoryPath: ["素材"], parentUrl: rootUrl, rootUrl, directoryRoute: []
  }];
  state.activeTransfers = [];
  state.activeItemId = null;
  state.jobs[0].scope = "folder";
  if (autoRetryRound) {
    state.jobs[0].autoRetryRound = autoRetryRound;
    state.jobs[0].retryOfJobId = "original-job";
  }
  if (withBatchPeer) {
    state.jobs[0].batchId = "batch-1";
    state.jobs.push({
      id: "peer-job", key: "peer-key", sourceTabId: 7, folderName: "另一个", folderItemIndex: "5",
      parentUrl: rootUrl, status: "queued", batchId: "batch-1", cancelRequested: false,
      createdAt: new Date(Date.now() + 1000).toISOString(), counts: {}
    });
  }
  return state;
}

async function runUntilJobFinished(state) {
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    { gopeedConfig: { downloadDir: "D:\\Downloads" }, gopeedTasks: [] }
  );
  harness.fireAlarm("popo-stable-downloader-pump");
  // 全量并行运行时 400ms 的默认等待偶尔不够，这里放宽到 4 秒。
  const sourceStatus = () => harness.stored.popoState?.jobs?.find((job) => job.id === "job-gopeed-control")?.status;
  for (let round = 0; round < 800 && sourceStatus() !== "failed"; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(sourceStatus(), "failed");
  return harness;
}

test("失败明细最多保存 200 项，其余只记数量，批量重试键不受限", async () => {
  const state = failingJobState({ reason: "permission_denied" });
  const template = state.items[0];
  state.items = Array.from({ length: 250 }, (_, index) => ({
    ...template, id: `failed-${index}`, name: `f${index}.png`, itemIndex: String(index)
  }));
  const harness = await runUntilJobFinished(state);
  try {
    const job = harness.stored.popoState.jobs.find((entry) => entry.id === "job-gopeed-control");
    assert.equal(job.failureEntries.length, 200);
    assert.equal(job.failureEntriesOmitted, 50);
    assert.equal(job.failureRetryKeys.length, 250);
  } finally { harness.cleanup(); }
});

test("任务失败结束后自动补一轮，并记录事件", async () => {
  const harness = await runUntilJobFinished(failingJobState());
  try {
    const jobs = harness.stored.popoState.jobs;
    const retry = jobs.find((job) => job.retryOfJobId === "job-gopeed-control");
    assert.ok(retry, JSON.stringify(jobs.map((job) => [job.id, job.status])));
    assert.equal(retry.autoRetryRound, 1);
    assert.ok(["queued", "scanning", "waiting_worker", "starting"].includes(retry.status));
    assert.ok(harness.stored.popoState.logs.some((entry) => entry.code === "AUTO_RETRY_QUEUED"));
  } finally { harness.cleanup(); }
});

test("权限类失败不自动补", async () => {
  const harness = await runUntilJobFinished(failingJobState({ reason: "permission_denied" }));
  try {
    assert.equal(harness.stored.popoState.jobs.length, 1);
  } finally { harness.cleanup(); }
});

test("自动补下的任务自己失败后不再自动补", async () => {
  const harness = await runUntilJobFinished(failingJobState({ autoRetryRound: 1 }));
  try {
    assert.equal(harness.stored.popoState.jobs.length, 1);
  } finally { harness.cleanup(); }
});

test("用户手动发起的补下失败后不再自动补", async () => {
  const state = failingJobState();
  state.jobs[0].retryOfJobId = "original-job";
  const harness = await runUntilJobFinished(state);
  try {
    assert.equal(harness.stored.popoState.jobs.length, 1);
  } finally { harness.cleanup(); }
});

test("批量任务中自动补下排在同批后续任务之后，不阻塞它们", async () => {
  const harness = await runUntilJobFinished(failingJobState({ withBatchPeer: true }));
  try {
    const state = harness.stored.popoState;
    assert.equal(state.activeJobId, "peer-job");
    assert.ok(state.jobs.some((job) => job.retryOfJobId === "job-gopeed-control" && job.autoRetryRound === 1));
  } finally { harness.cleanup(); }
});

test("连续 3 次准备失败后冷却，触发冷却的失败不消耗文件重试次数", async () => {
  const state = transferState({ includePending: true });
  const first = state.items.find((item) => item.id === "pending-file");
  first.directoryPath = [state.selectedFolderName];
  state.items = ["p1", "p2", "p3", "p4"].map((name, index) => ({
    ...first, id: `${name}-file`, name: `${name}.mp4`, itemIndex: String(index + 1)
  }));
  state.triggerMode = "folder_button";
  state.workerReadyUrl = state.rootUrl;
  state.activeTransfers = [];
  state.activeItemId = null;
  state.jobs[0].counts = { files: 4 };
  const opened = [];
  let send;
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      gopeedConfig: { downloadDir: "D:\\Downloads" },
      gopeedTasks: [],
      async sendTabMessage(_tabId, message) {
        if (message.type === "NAVIGATE_WORKER") setTimeout(() => void send(
          { type: "REGISTER_WORKER_FRAME", url: message.url },
          { tab: { id: 7, url: message.url }, url: message.url, frameId: 42 }
        ), 0);
        if (message.type === "PING") return { ok: true, result: { url: state.rootUrl } };
        if (message.type === "OPEN_ITEM") { opened.push(message.name); return { ok: false, error: "目录加载超时" }; }
        return { ok: true, result: {} };
      }
    }
  );
  send = harness.send;
  try {
    for (let round = 1; round <= 3; round += 1) {
      harness.fireAlarm("popo-stable-downloader-pump");
      await waitUntil(() => opened.length === round);
      await waitUntil(() => !harness.stored.popoState.preparingItemId);
    }
    assert.ok(harness.stored.popoState.prepareCooldownUntil > Date.now(), "第 3 次失败后必须进入冷却");
    const third = harness.stored["popoItems:job-gopeed-control:0"].find((item) => item.name === "p3.mp4");
    assert.equal(third.attempts, 0, "触发冷却的失败不消耗重试次数");
    assert.equal(third.status, "pending");
    harness.fireAlarm("popo-stable-downloader-pump");
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(opened.length, 3, "冷却期内不得再准备任何文件");
  } finally {
    harness.cleanup();
  }
});

function sameDirectoryHarness({ returnDirectoryName, firstFileFails = false } = {}) {
  const state = transferState({ includePending: true });
  const first = state.items.find((item) => item.id === "pending-file");
  Object.assign(first, { directoryPath: [state.selectedFolderName], rootUrl: state.rootUrl, directoryRoute: [] });
  state.items = ["a", "b"].map((name, index) => ({
    ...first, id: `${name}-file`, name: `${name}.mp4`, itemIndex: String(index + 1)
  }));
  state.settings = { ...state.settings, concurrency: 5 };
  state.triggerMode = "folder_button";
  state.workerReadyUrl = state.rootUrl;
  state.teamSpaceId = "space-real";
  state.activeTransfers = [];
  state.activeItemId = null;
  state.gopeedConnected = true;
  state.gopeedDownloadDir = "D:\\Downloads";
  state.jobs[0].counts = { files: 2 };
  const calls = [];
  const tab = { url: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1" };
  let currentUrl = state.rootUrl;
  let openCount = 0;
  let send;
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      getTab: async (tabId) => ({ id: tabId, url: tab.url }),
      gopeedConfig: { downloadDir: "D:\\Downloads" },
      async getGopeedTask(_settings, taskId) {
        return { id: taskId, status: "running", progress: { downloaded: 1, speed: 1 }, meta: { req: { labels: {} } } };
      },
      gopeedTasks: [1, 2].map((n) => ({
        id: `task-${n}`, status: "running", progress: { downloaded: n, speed: 1 }, meta: { req: { labels: {} } }
      })),
      async startOrReplaceGopeedTask() { return { taskId: `task-${openCount}`, replacedMissingTask: false }; },
      async sendTabMessage(_tabId, message) {
        calls.push(message.type);
        if (message.type === "NAVIGATE_WORKER") {
          currentUrl = message.url;
          setTimeout(() => void send(
            { type: "REGISTER_WORKER_FRAME", url: message.url },
            { tab: { id: 7, url: message.url }, url: message.url, frameId: 42 }
          ), 0);
        }
        if (message.type === "RETURN_TO_DIRECTORY") currentUrl = state.rootUrl;
        if (message.type === "PING") {
          const atDirectory = currentUrl === state.rootUrl;
          return { ok: true, result: {
            url: currentUrl,
            directoryName: atDirectory ? (returnDirectoryName ?? state.selectedFolderName) : ""
          } };
        }
        if (message.type === "OPEN_ITEM") {
          openCount += 1;
          currentUrl = `https://docs.popo.netease.com/team/pc/team1/pageDetail/file${openCount}`;
          return { ok: true, result: { clicked: true } };
        }
        if (message.type === "GET_PREVIEW_INFO") {
          if (firstFileFails && openCount === 1) return { ok: false, error: "预览读取失败" };
          return { ok: true, result: {
            titleCandidates: [`${openCount === 1 ? "a" : "b"}.mp4`],
            media: [{ src: `https://bucket.s3v2.nie.netease.com/file${openCount}.mp4?sig=1` }],
            downloadButtonCount: 1, loadingCount: 0, previewElementCount: 1, pageId: `file${openCount}`
          } };
        }
        return { ok: true, result: {} };
      }
    }
  );
  send = harness.send;
  const prepared = () => harness.stored["popoItems:job-gopeed-control:0"] || [];
  return { harness, calls, prepared, tab };
}

for (const scenario of [
  { name: "用户在原页面切换目录后不复用目录页，避免返回键带走用户页面", sourceUrlChanges: true, expectNavigations: 2, expectReturn: 0 },
  { name: "同一目录的下一个文件复用目录页，不重新加载", expectNavigations: 1, expectReturn: 1 },
  { name: "返回后目录名不符时回退完整加载", returnDirectoryName: "别的目录", expectNavigations: 2, expectReturn: 1 },
  { name: "上一个文件失败后下一个文件做完整加载", firstFileFails: true, expectNavigations: 2, expectReturn: 0 }
]) {
  test(scenario.name, async () => {
    const { harness, calls, prepared, tab } = sameDirectoryHarness(scenario);
    try {
      harness.fireAlarm("popo-stable-downloader-pump");
      await waitUntil(() => calls.filter((type) => type === "OPEN_ITEM").length === 1);
      await waitUntil(() => !harness.stored.popoState.preparingItemId);
      // 第一个文件准备完成后，用户在原页面里切换了目录。
      if (scenario.sourceUrlChanges) tab.url = "https://docs.popo.netease.com/team/pc/team1/pageDetail/user-moved";
      // 反复触发 pump，直到第二个文件被打开（第一个文件失败时它要先退避；回退路径要先等满 3 秒目录确认）。
      for (let round = 0; round < 400 && calls.filter((type) => type === "OPEN_ITEM").length < 2; round += 1) {
        harness.fireAlarm("popo-stable-downloader-pump");
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      assert.equal(calls.filter((type) => type === "OPEN_ITEM").length, 2, JSON.stringify({ calls, items: prepared().map((i) => [i.name, i.status, i.stage]) }));
      assert.equal(calls.filter((type) => type === "NAVIGATE_WORKER").length, scenario.expectNavigations, JSON.stringify(calls));
      assert.equal(calls.filter((type) => type === "RETURN_TO_DIRECTORY").length, scenario.expectReturn, JSON.stringify(calls));
      assert.ok(prepared().length === 2);
    } finally {
      harness.cleanup();
    }
  });
}

test("页面结构诊断由后台清洗后保存，弹窗可读取，非 POPO 页面来源被拒绝", async () => {
  const harness = createHarness();
  try {
    const hostile = {
      apis: [{ method: "GET", path: "/api/x/0123456789abcdef0123456789abcdef", status: 200,
        shape: { "icon_bubble_a.png": "https://bucket.s3v2.nie.netease.com/a.png?sig=1" } }],
      rows: { attributeNames: ["data-item-index"], hasPageDetailLink: false }
    };
    const refused = await harness.send(
      { type: "PAGE_PROBE_REPORT", report: hostile },
      { tab: { id: 7, url: "https://evil.example/team/pc/t/pageDetail/x" }, url: "https://evil.example/team/pc/t/pageDetail/x", frameId: 0 }
    );
    assert.equal(refused.ok, false);
    const accepted = await harness.send({ type: "PAGE_PROBE_REPORT", report: hostile });
    assert.equal(accepted.ok, true, accepted.error);
    const read = await harness.send({ type: "GET_PAGE_PROBE" }, { url: "chrome-extension://abc/popup.html", frameId: 0 });
    assert.equal(read.ok, true, read.error);
    const text = JSON.stringify(read.probe);
    assert.equal(/icon_bubble|https|0123456789abcdef/.test(text), false, text);
    assert.equal(read.probe.report.apis[0].path, "/api/x/:id");
  } finally {
    harness.cleanup();
  }
});

// ── 接口扫描：folderSubList 列目录、按文件 ID 建立条目；任何不确定回退页面扫描。
const API_ROOT_URL = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
const apiItem = (overrides) => ({
  pageId: "x", pageName: "x", pageType: 3, hasChildren: 0, pageSize: 10, pageMajorVersion: 1, ...overrides
});
const apiListing = (list, extra = {}) => ({
  status: 200, data: { pageList: list, more: false, total: list.length, ...extra }
});

function apiScanHarness({ listings, settings = {}, retrySelection = null, listDelayMs = 0 } = {}) {
  const state = transferState({ mode: "scanning", jobStatus: "scanning" });
  state.items = [];
  state.activeTransfers = [];
  state.activeItemId = null;
  state.triggerMode = "folder_button";
  state.rootUrl = API_ROOT_URL;
  state.workerReadyUrl = API_ROOT_URL;
  state.teamSpaceKey = "team1";
  state.teamSpaceId = "space-real";
  state.selectedFolderName = "素材包";
  state.settings = { ...state.settings, ...settings };
  state.jobs[0].scope = "folder";
  state.jobs[0].folderName = "素材包";
  state.jobs[0].folderItemIndex = "1";
  state.jobs[0].parentUrl = API_ROOT_URL;
  state.scanQueue = [];
  state.resolveQueue = [{
    key: "k", rootUrl: API_ROOT_URL, parentUrl: API_ROOT_URL, parentPath: [], parentRoute: [],
    name: "素材包", itemIndex: "1"
  }];
  if (retrySelection) {
    state.jobs[0].retrySelection = retrySelection;
    state.jobs[0].retryOfJobId = "orig";
    state.resolveQueue = [];
    state.scanQueue = [{ url: retrySelection.url, path: retrySelection.path, rootUrl: API_ROOT_URL, route: retrySelection.route }];
  }
  const calls = [];
  const dirUrls = {};
  const listing = { inFlight: 0, max: 0 };
  let currentUrl = API_ROOT_URL;
  let send;
  state.gopeedConnected = true;
  state.gopeedDownloadDir = "D:\\Downloads";
  const harness = createHarness({ popoSettings: state.settings, popoState: state }, {
    gopeedConfig: { downloadDir: "D:\\Downloads" },
    gopeedTasks: [],
    async startOrReplaceGopeedTask() { return { taskId: "task-api", replacedMissingTask: false }; },
    async sendTabMessage(_tabId, message) {
      calls.push(message.type + (message.type === "LIST_FOLDER" ? `:${message.pageId}` : ""));
      if (message.type === "NAVIGATE_WORKER") {
        currentUrl = message.url;
        setTimeout(() => void send({ type: "REGISTER_WORKER_FRAME", url: message.url },
          { tab: { id: 7, url: message.url }, url: message.url, frameId: 42 }), 0);
      }
      if (message.type === "LIST_FOLDER") {
        listing.inFlight += 1;
        listing.max = Math.max(listing.max, listing.inFlight);
        if (listDelayMs) await new Promise((resolve) => setTimeout(resolve, listDelayMs));
        listing.inFlight -= 1;
        const body = listings[message.pageId];
        return { ok: true, result: body ? { ok: true, status: 200, body } : { ok: false, status: 0, error: "no_template" } };
      }
      if (message.type === "PING") {
        const id = currentUrl.match(/pageDetail\/([a-z0-9]+)/i)?.[1];
        return { ok: true, result: { url: currentUrl, directoryName: dirUrls[id] || "素材包" } };
      }
      if (message.type === "SCAN_DIRECTORY") {
        const id = currentUrl.match(/pageDetail\/([a-z0-9]+)/i)?.[1];
        const items = (listings[id]?.data.pageList || []).map((entry, index) => ({
          name: entry.pageName, itemIndex: String(index), type: entry.pageType === 0 ? "folder" : "file"
        }));
        return { ok: true, result: { url: currentUrl, directoryName: dirUrls[id] || "素材包", items,
          diagnostics: { expectedItemCount: items.length } } };
      }
      return { ok: true, result: {} };
    }
  });
  send = harness.send;
  const items = () => Object.entries(harness.stored)
    .filter(([key]) => key.startsWith("popoItems:job-gopeed-control:")).flatMap(([, value]) => value);
  return { harness, calls, dirUrls, items, state, listing };
}

const standardListings = () => ({
  root1: apiListing([apiItem({ pageId: "folderA", pageName: "素材包", pageType: 0, hasChildren: 1, pageMajorVersion: 3 }),
    apiItem({ pageId: "other", pageName: "无关文件.txt" })]),
  folderA: apiListing([apiItem({ pageId: "x1", pageName: "a.png" }),
    apiItem({ pageId: "folderB", pageName: "子目录", pageType: 0, hasChildren: 1 })]),
  folderB: apiListing([apiItem({ pageId: "x2", pageName: "b.png" })])
});

async function pumpUntil(harness, predicate, rounds = 120) {
  for (let round = 0; round < rounds && !predicate(); round += 1) {
    harness.fireAlarm("popo-stable-downloader-pump");
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  const state = harness.stored.popoState || {};
  assert.ok(predicate(), `等待条件超时：${JSON.stringify({
    mode: state.mode, phase: state.phase, apiScanQueue: state.apiScanQueue, started: state.apiScanStarted,
    disabled: state.apiScanDisabled, resolveQueue: (state.resolveQueue || []).length, scanQueue: (state.scanQueue || []).length,
    logs: (state.logs || []).slice(-4).map((entry) => [entry.code, entry.message, entry.details])
  })}`);
}

test("接口扫描：两层目录带文件 ID，数量取自 total，不使用页面扫描与点击", async () => {
  const { harness, calls, items } = apiScanHarness({ listings: standardListings() });
  try {
    await pumpUntil(harness, () => (harness.stored.popoState?.directoryScans || []).length === 2);
    await pumpUntil(harness, () => items().length === 2);
    const byName = Object.fromEntries(items().map((item) => [item.name, item]));
    assert.equal(byName["a.png"].pageId, "x1");
    assert.deepEqual(byName["a.png"].directoryPath, ["素材包"]);
    assert.equal(byName["b.png"].pageId, "x2");
    assert.deepEqual(byName["b.png"].directoryPath, ["素材包", "子目录"]);
    assert.equal(byName["b.png"].directoryDirect, true);
    assert.equal(byName["b.png"].parentUrl, "https://docs.popo.netease.com/team/pc/team1/pageDetail/folderB");
    const scans = harness.stored.popoState.directoryScans;
    assert.deepEqual(scans.map((scan) => [scan.path.join("/"), scan.expected, scan.found, scan.verified]),
      [["素材包", 2, 2, true], ["素材包/子目录", 1, 1, true]]);
    assert.equal(calls.some((type) => ["SCAN_DIRECTORY", "OPEN_ITEM"].includes(type)), false, calls.join(","));
    assert.deepEqual(scans.map((scan) => scan.via), ["api", "api"]);
    await pumpUntil(harness, () => Boolean(harness.stored.popoState.jobs[0].scanCompletedAt));
    const job = harness.stored.popoState.jobs[0];
    assert.ok(Date.parse(job.scanCompletedAt) >= Date.parse(job.startedAt), "扫描完成时间不早于开始时间");
  } finally { harness.cleanup(); }
});

test("接口扫描：某子目录 more 为 true 时该目录转页面扫描，其余条目保留并记录回退", async () => {
  const listings = standardListings();
  listings.folderB = apiListing([apiItem({ pageId: "x2", pageName: "b.png" })], { more: true });
  const { harness, calls, dirUrls, items } = apiScanHarness({ listings });
  dirUrls.folderB = "子目录";
  try {
    await pumpUntil(harness, () => items().length === 2);
    const byName = Object.fromEntries(items().map((item) => [item.name, item]));
    assert.equal(byName["a.png"].pageId, "x1");
    assert.equal(byName["b.png"].pageId, undefined, "页面扫描的条目没有文件 ID");
    assert.ok(calls.includes("SCAN_DIRECTORY"));
    const fallback = harness.stored.popoState.logs.find((entry) => entry.code === "API_SCAN_FALLBACK");
    assert.ok(fallback, "必须记录回退事件");
    assert.equal(fallback.context.reason, "more");
    assert.equal(fallback.context.more, 1);
    assert.equal(fallback.context.length, 1);
  } finally { harness.cleanup(); }
});

test("接口扫描：同名文件夹不唯一时整体回退页面扫描并保留原定位队列", async () => {
  const listings = standardListings();
  listings.root1 = apiListing([
    apiItem({ pageId: "f1", pageName: "素材包", pageType: 0 }), apiItem({ pageId: "f2", pageName: "素材包", pageType: 0 })
  ]);
  const { harness, calls } = apiScanHarness({ listings });
  try {
    await pumpUntil(harness, () => calls.includes("OPEN_ITEM"));
    assert.equal(harness.stored.popoState.apiScanDisabled, true);
    assert.equal(calls.filter((type) => type.startsWith("LIST_FOLDER")).length, 1);
    assert.equal(harness.stored.popoState.logs.find((entry) => entry.code === "API_SCAN_FALLBACK").context.reason, "ambiguous_folder");
  } finally { harness.cleanup(); }
});

test("接口扫描：目录接口返回业务错误时，回退事件带业务码与提示，便于定位", async () => {
  const listings = standardListings();
  listings.root1 = { status: 405, message: "没有权限操作", data: null };
  const { harness, calls } = apiScanHarness({ listings });
  try {
    await pumpUntil(harness, () => calls.includes("OPEN_ITEM"));
    const fallback = harness.stored.popoState.logs.find((entry) => entry.code === "API_SCAN_FALLBACK");
    assert.equal(fallback.context.reason, "business_error");
    assert.equal(fallback.context.businessStatus, 405);
    assert.equal(fallback.context.detail, "没有权限操作");
  } finally { harness.cleanup(); }
});

test("接口扫描：桥返回传输层失败（如没有请求模板）时，回退事件带 HTTP 状态与原因", async () => {
  const { harness, calls } = apiScanHarness({ listings: {} });
  try {
    await pumpUntil(harness, () => calls.includes("OPEN_ITEM"));
    const fallback = harness.stored.popoState.logs.find((entry) => entry.code === "API_SCAN_FALLBACK");
    assert.equal(fallback.context.reason, "api_error");
    assert.equal(fallback.context.detail, "no_template");
    assert.equal(fallback.context.httpStatus, 0);
  } finally { harness.cleanup(); }
});

test("接口扫描：同级目录并行列出（最多 4 个），结果仍按目录顺序写入且一个目录回退不影响其余", async () => {
  const listings = {
    root1: apiListing([apiItem({ pageId: "folderA", pageName: "素材包", pageType: 0, hasChildren: 1 })]),
    folderA: apiListing(["s1", "s2", "s3", "s4", "s5"].map((id) =>
      apiItem({ pageId: id, pageName: `目录${id}`, pageType: 0, hasChildren: 1 })))
  };
  for (const id of ["s1", "s2", "s3", "s4", "s5"]) {
    listings[id] = apiListing([apiItem({ pageId: `file-${id}`, pageName: `${id}.png` })]);
  }
  listings.s3 = apiListing([apiItem({ pageId: "file-s3", pageName: "s3.png" })], { more: true });
  const { harness, calls, listing, dirUrls } = apiScanHarness({ listings, listDelayMs: 25 });
  dirUrls.s3 = "目录s3";
  try {
    await pumpUntil(harness, () => (harness.stored.popoState?.directoryScans || []).length === 6, 300);
    assert.equal(listing.max, 4, "同级目录应并行列出，上限 4");
    const paths = harness.stored.popoState.directoryScans.map((scan) => scan.path.join("/"));
    assert.deepEqual(paths, ["素材包", "素材包/目录s1", "素材包/目录s2", "素材包/目录s4", "素材包/目录s5", "素材包/目录s3"],
      "接口目录按顺序写入，回退的目录最后由页面扫描补上");
    assert.ok(calls.includes("SCAN_DIRECTORY"), "回退的目录走页面扫描");
    assert.equal(harness.stored.popoState.logs.filter((entry) => entry.code === "API_SCAN_FALLBACK").length, 1);
  } finally { harness.cleanup(); }
});

test("接口扫描：设置 useApiScan 为 false 时完全走页面流程", async () => {
  const { harness, calls } = apiScanHarness({ listings: standardListings(), settings: { useApiScan: false } });
  try {
    await pumpUntil(harness, () => calls.includes("OPEN_ITEM"));
    assert.equal(calls.some((type) => type.startsWith("LIST_FOLDER")), false);
  } finally { harness.cleanup(); }
});

test("接口扫描：补下任务按名称与目录路径找到目标，不依赖页面行号标识", async () => {
  const listings = standardListings();
  const failure = {
    id: "stale-dom-id", kind: "file", name: "b.png", path: ["素材包", "子目录"],
    url: "https://docs.popo.netease.com/team/pc/team1/pageDetail/folderB", rootUrl: API_ROOT_URL,
    route: [{ name: "素材包", itemIndex: "1" }, { name: "子目录", itemIndex: "2" }]
  };
  const { harness, calls, items } = apiScanHarness({ listings, retrySelection: failure });
  try {
    await pumpUntil(harness, () => items().length === 1);
    assert.equal(items()[0].name, "b.png");
    assert.equal(items()[0].selected, true);
    assert.equal(items()[0].pageId, "x2");
    assert.ok(calls.includes("LIST_FOLDER:folderB"));
  } finally { harness.cleanup(); }
});

// ── 按文件 ID 取址：条目带 pageId 时直接请求下载地址，不打开预览页。
function byIdHarness({ item = {}, directBody, settings = {}, previewMedia, observedUrl = "" } = {}) {
  const state = transferState({ includePending: true });
  const first = state.items.find((entry) => entry.id === "pending-file");
  state.items = [{
    ...first, id: "id-file", name: "f.mp4", itemIndex: "", pageId: "page-f1",
    directoryPath: [state.selectedFolderName], rootUrl: state.rootUrl, directoryRoute: [], ...item
  }];
  state.settings = { ...state.settings, concurrency: 5, ...settings };
  state.triggerMode = "folder_button";
  state.workerReadyUrl = state.rootUrl;
  state.teamSpaceKey = "team1";
  state.teamSpaceId = "space-real";
  state.activeTransfers = [];
  state.activeItemId = null;
  state.gopeedConnected = true;
  state.gopeedDownloadDir = "D:\\Downloads";
  state.jobs[0].counts = { files: 1 };
  const calls = [];
  const definitions = [];
  let currentUrl = state.rootUrl;
  let send;
  const harness = createHarness({ popoSettings: state.settings, popoState: state }, {
    gopeedConfig: { downloadDir: "D:\\Downloads" },
    gopeedTasks: [{ id: "task-1", status: "running", progress: { downloaded: 1, speed: 1 }, meta: { req: { labels: {} } } }],
    async getGopeedTask(_settings, taskId) {
      return { id: taskId, status: "running", progress: { downloaded: 1, speed: 1 }, meta: { req: { labels: {} } } };
    },
    async startOrReplaceGopeedTask(_settings, _taskId, definition) {
      definitions.push(definition);
      return { taskId: "task-1", replacedMissingTask: false };
    },
    async sendTabMessage(_tabId, message) {
      calls.push(message.type);
      if (message.type === "NAVIGATE_WORKER") {
        currentUrl = message.url;
        setTimeout(() => void send({ type: "REGISTER_WORKER_FRAME", url: message.url },
          { tab: { id: 7, url: message.url }, url: message.url, frameId: 42 }), 0);
      }
      if (message.type === "PING") return { ok: true, result: { url: currentUrl, directoryName: state.selectedFolderName } };
      if (message.type === "OPEN_ITEM") {
        currentUrl = "https://docs.popo.netease.com/team/pc/team1/pageDetail/page-f1";
        return { ok: true, result: { clicked: true } };
      }
      if (message.type === "GET_PREVIEW_INFO") return { ok: true, result: {
        titleCandidates: ["f.mp4"],
        media: previewMedia ?? [{ src: "https://bucket.s3v2.nie.netease.com/page.mp4?sig=1" }],
        downloadButtonCount: 1, loadingCount: 0, previewElementCount: 1, pageId: "page-f1"
      } };
      if (message.type === "REQUEST_DIRECT_DOWNLOAD") return { ok: true, result: { ok: true, status: 200, body: directBody } };
      if (message.type === "GET_OBSERVED_DOWNLOAD_URL") return { ok: true, result: { url: observedUrl } };
      return { ok: true, result: {} };
    }
  });
  send = harness.send;
  const stored = () => harness.stored["popoItems:job-gopeed-control:0"]?.[0];
  return { harness, calls, stored, definitions };
}

const PAGE_FLOW_CALLS = ["NAVIGATE_WORKER", "OPEN_ITEM", "GET_PREVIEW_INFO", "CLEAN_STATE"];
const directBodyWithUrl = { code: 0, data: { url: "https://bucket.s3v2.nie.netease.com/direct.mp4?sig=2" } };

test("按文件 ID 取址：只请求下载地址，不加载目录、不点开文件、不等预览", async () => {
  const { harness, calls, stored } = byIdHarness({ directBody: directBodyWithUrl });
  try {
    await pumpUntil(harness, () => stored()?.status === "transferring");
    assert.ok(calls.includes("REQUEST_DIRECT_DOWNLOAD"));
    for (const type of PAGE_FLOW_CALLS) assert.equal(calls.includes(type), false, `${type}：${calls.join(",")}`);
    assert.equal(stored().apiFallback, undefined);
  } finally { harness.cleanup(); }
});

test("按文件 ID 取址失败（接口没有返回地址）：标记回退并在同一次尝试改走页面流程", async () => {
  const { harness, calls, stored } = byIdHarness({ directBody: { code: 0, data: {} } });
  try {
    await pumpUntil(harness, () => stored()?.status === "transferring", 400);
    assert.equal(stored().apiFallback, true);
    assert.ok(calls.includes("OPEN_ITEM") && calls.includes("GET_PREVIEW_INFO"), calls.join(","));
    assert.ok(harness.stored.popoState.logs.some((entry) => entry.code === "API_SCAN_FALLBACK" && entry.context.reason === "download_url"));
  } finally { harness.cleanup(); }
});

test("按文件 ID 取址被拒绝（405）：改走页面流程，预览里有媒体地址时仍能下载", async () => {
  const { harness, calls, stored } = byIdHarness({ directBody: { status: 405, message: "没有权限操作" } });
  try {
    await pumpUntil(harness, () => stored()?.status === "transferring", 300);
    assert.equal(stored().apiFallback, true);
    assert.ok(calls.includes("OPEN_ITEM") && calls.includes("GET_PREVIEW_INFO"), calls.join(","));
  } finally { harness.cleanup(); }
});

test("按文件 ID 取址被拒绝（405）且页面流程也没有地址：标记权限失败", async () => {
  const { harness, stored } = byIdHarness({ directBody: { status: 405, message: "没有权限操作" }, previewMedia: [] });
  try {
    await pumpUntil(harness, () => stored()?.status === "failed", 300);
    assert.equal(stored().failureReason, "permission_denied");
  } finally { harness.cleanup(); }
});

test("按文件 ID 取址不使用页面里按文件名观察到的旧地址", async () => {
  const { harness, calls, stored, definitions } = byIdHarness({
    directBody: { code: 0, data: {} }, observedUrl: "https://bucket.s3v2.nie.netease.com/OTHER-DIRECTORY-same-name.mp4?sig=9"
  });
  try {
    await pumpUntil(harness, () => stored()?.status === "transferring", 400);
    assert.ok(calls.includes("OPEN_ITEM"), "应改走页面流程");
    assert.equal(definitions.some((definition) => definition.url.includes("OTHER-DIRECTORY")), false, JSON.stringify(definitions));
  } finally { harness.cleanup(); }
});

test("已标记 apiFallback 的文件、以及 useApiScan 关闭时，不再按文件 ID 取址", async () => {
  for (const config of [{ item: { apiFallback: true } }, { settings: { useApiScan: false } }]) {
    const { harness, calls, stored } = byIdHarness({ directBody: directBodyWithUrl, ...config });
    try {
      await pumpUntil(harness, () => stored()?.status === "transferring", 200);
      assert.equal(calls.includes("REQUEST_DIRECT_DOWNLOAD"), false, calls.join(","));
      assert.ok(calls.includes("OPEN_ITEM"));
    } finally { harness.cleanup(); }
  }
});

const apiQueueEntry = {
  pageId: "folderB", pageMajorVersion: 1, path: ["素材包", "子目录"],
  url: "https://docs.popo.netease.com/team/pc/team1/pageDetail/folderB",
  route: [{ name: "素材包", itemIndex: "1" }, { name: "子目录", itemIndex: "" }]
};

test("接口扫描：页面工作区恢复超限时，队列里未扫的目录记为失败而不是被静默丢弃", async () => {
  const state = transferState({ mode: "waiting_worker", jobStatus: "waiting_worker", includePending: true });
  state.triggerMode = "folder_button";
  state.workerFrameId = null;
  state.workerRecoveryStartedAt = Date.now() - 6 * 60_000;
  state.workerRecoveryCount = 2;
  state.workerRecoveryPending = false;
  state.workerDeadline = Date.now() - 1;
  state.activeTransfers = [];
  state.scanQueue = [];
  state.resolveQueue = [];
  state.apiScanQueue = [structuredClone(apiQueueEntry)];
  state.apiScanStarted = true;
  const harness = createHarness({ popoSettings: state.settings, popoState: state });
  try {
    harness.fireAlarm("popo-stable-downloader-watchdog");
    await waitUntil(() => harness.stored.popoState?.jobs?.[0]?.status === "failed");
    const job = harness.stored.popoState.jobs[0];
    assert.equal(job.counts.scanFailures, 1);
    const entry = job.failureEntries.find((candidate) => candidate.kind === "directory");
    assert.deepEqual(entry.path, ["素材包", "子目录"]);
    assert.deepEqual(harness.stored.popoState.apiScanQueue, []);
  } finally { harness.cleanup(); }
});

test("接口扫描：中途关闭 useApiScan 时，队列里的目录转页面扫描而不是丢失", async () => {
  const { harness, calls, dirUrls, state } = apiScanHarness({
    listings: standardListings(), settings: { useApiScan: false }
  });
  dirUrls.folderB = "子目录";
  harness.stored.popoState.resolveQueue = [];
  harness.stored.popoState.apiScanStarted = true;
  harness.stored.popoState.apiScanQueue = [structuredClone(apiQueueEntry)];
  try {
    await pumpUntil(harness, () => (harness.stored.popoState?.directoryScans || []).length === 1);
    assert.ok(calls.includes("SCAN_DIRECTORY"), calls.join(","));
    assert.deepEqual(harness.stored.popoState.directoryScans[0].path, ["素材包", "子目录"]);
    assert.deepEqual(harness.stored.popoState.apiScanQueue, []);
  } finally { harness.cleanup(); }
});

test("先扫完再下：接口扫描尚有目录未列出时，不处理已有的待下载文件", async () => {
  const { harness, calls } = apiScanHarness({ listings: standardListings() });
  const pending = {
    id: "early", name: "early.mp4", itemIndex: "", pageId: "early1", selected: true, status: "pending", attempts: 0,
    directoryPath: ["素材包"], parentUrl: API_ROOT_URL, rootUrl: API_ROOT_URL, directoryRoute: []
  };
  harness.stored.popoState.items = [pending];
  harness.stored.popoState.workflow = {
    version: 1, sequence: 1, value: { scan: "running", handoff: "idle", transfer: "idle" },
    nextAction: "handoff", reservedItemId: "", counts: {}, updatedAt: new Date().toISOString()
  };
  try {
    await pumpUntil(harness, () => (harness.stored.popoState?.directoryScans || []).length === 2);
    const firstRequest = calls.indexOf("REQUEST_DIRECT_DOWNLOAD");
    const lastList = calls.map((type, index) => type.startsWith("LIST_FOLDER") ? index : -1).reduce((a, b) => Math.max(a, b), -1);
    assert.ok(firstRequest === -1 || firstRequest > lastList, `扫描未完成前不得取址：${calls.join(",")}`);
  } finally { harness.cleanup(); }
});

test("接口扫描：目录声称有子项却返回空列表时回退页面扫描，而不是记为已核对的空目录", async () => {
  const listings = standardListings();
  listings.folderB = apiListing([]);
  listings.folderA = apiListing([
    apiItem({ pageId: "x1", pageName: "a.png" }),
    apiItem({ pageId: "folderB", pageName: "子目录", pageType: 0, hasChildren: 1 })
  ]);
  const { harness, calls, dirUrls } = apiScanHarness({ listings });
  dirUrls.folderB = "子目录";
  try {
    await pumpUntil(harness, () => harness.stored.popoState.logs.some((entry) => entry.code === "API_SCAN_FALLBACK"));
    const fallback = harness.stored.popoState.logs.find((entry) => entry.code === "API_SCAN_FALLBACK");
    assert.equal(fallback.context.reason, "empty_unverified");
    await pumpUntil(harness, () => calls.includes("SCAN_DIRECTORY"));
  } finally { harness.cleanup(); }
});

test("接口扫描：单文件补下不递归子目录，也不会因子目录回退把成功的补下记成失败", async () => {
  const listings = standardListings();
  listings.folderB = apiListing([
    apiItem({ pageId: "x2", pageName: "b.png" }),
    apiItem({ pageId: "folderC", pageName: "更深", pageType: 0, hasChildren: 1 })
  ]);
  const failure = {
    id: "stale", kind: "file", name: "b.png", path: ["素材包", "子目录"],
    url: "https://docs.popo.netease.com/team/pc/team1/pageDetail/folderB", rootUrl: API_ROOT_URL,
    route: [{ name: "素材包", itemIndex: "1" }, { name: "子目录", itemIndex: "2" }]
  };
  const { harness, calls, items } = apiScanHarness({ listings, retrySelection: failure });
  try {
    await pumpUntil(harness, () => items().length === 1);
    assert.equal(calls.includes("LIST_FOLDER:folderC"), false, calls.join(","));
    assert.deepEqual(harness.stored.popoState.apiScanQueue, []);
  } finally { harness.cleanup(); }
});

test("先扫完再下：扫描队列清空前不处理待下载文件", async () => {
  const state = transferState({ mode: "scanning", jobStatus: "scanning", includePending: true });
  const pending = state.items.find((item) => item.id === "pending-file");
  pending.directoryPath = [state.selectedFolderName];
  pending.itemIndex = "1";
  state.items = [pending];
  state.triggerMode = "folder_button";
  state.workerReadyUrl = state.rootUrl;
  state.activeTransfers = [];
  state.activeItemId = null;
  state.scanQueue = [{ url: state.rootUrl, path: [state.selectedFolderName] }];
  state.workflow = {
    version: 1, sequence: 1, value: { scan: "running", handoff: "idle", transfer: "idle" },
    nextAction: "handoff", reservedItemId: "", counts: {}, updatedAt: new Date().toISOString()
  };
  const events = [];
  let send;
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      gopeedConfig: { downloadDir: "D:\\Downloads" },
      gopeedTasks: [],
      async sendTabMessage(_tabId, message) {
        if (message.type === "NAVIGATE_WORKER") setTimeout(() => void send(
          { type: "REGISTER_WORKER_FRAME", url: message.url },
          { tab: { id: 7, url: message.url }, url: message.url, frameId: 42 }
        ), 0);
        if (message.type === "PING") return { ok: true, result: { url: state.rootUrl, directoryName: state.selectedFolderName } };
        if (message.type === "SCAN_DIRECTORY") {
          events.push("SCAN_DIRECTORY");
          return { ok: true, result: { url: state.rootUrl, directoryName: state.selectedFolderName,
            items: [{ name: "pending.mp4", itemIndex: "1", type: "file" }], diagnostics: { expectedItemCount: 1 } } };
        }
        if (message.type === "OPEN_ITEM") {
          events.push(`OPEN_ITEM:${message.name}`);
          return { ok: false, error: "测试到此为止" };
        }
        return { ok: true, result: {} };
      }
    }
  );
  send = harness.send;
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => events.length > 0);
    assert.equal(events[0], "SCAN_DIRECTORY", `扫描完成前不得处理文件：${events.join(",")}`);
  } finally {
    harness.cleanup();
  }
});

test("文件准备失败后退避重试，先处理其他待下载文件", async () => {
  const state = transferState({ includePending: true });
  const first = state.items.find((item) => item.id === "pending-file");
  first.directoryPath = [state.selectedFolderName];
  first.itemIndex = "1";
  const second = { ...first, id: "second-file", name: "second.mp4", itemIndex: "2" };
  state.items = [first, second];
  state.triggerMode = "folder_button";
  state.workerReadyUrl = state.rootUrl;
  state.activeTransfers = [];
  state.activeItemId = null;
  state.jobs[0].counts = { files: 2 };
  const opened = [];
  let send;
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      gopeedConfig: { downloadDir: "D:\\Downloads" },
      gopeedTasks: [],
      async sendTabMessage(_tabId, message) {
        if (message.type === "NAVIGATE_WORKER") setTimeout(() => void send(
          { type: "REGISTER_WORKER_FRAME", url: message.url },
          { tab: { id: 7, url: message.url }, url: message.url, frameId: 42 }
        ), 0);
        if (message.type === "PING") return { ok: true, result: { url: state.rootUrl } };
        if (message.type === "OPEN_ITEM") {
          opened.push(message.name);
          return { ok: false, error: "目录加载超时" };
        }
        return { ok: true, result: {} };
      }
    }
  );
  send = harness.send;
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => opened.length === 1);
    await waitUntil(() => !harness.stored.popoState.preparingItemId);
    const deferred = harness.stored["popoItems:job-gopeed-control:0"][0];
    assert.equal(deferred.status, "pending");
    assert.ok(deferred.retryNotBefore > Date.now(), "失败文件必须带退避时间");
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => opened.length === 2);
    assert.deepEqual(opened, ["pending.mp4", "second.mp4"]);
    await waitUntil(() => !harness.stored.popoState.preparingItemId);
    harness.fireAlarm("popo-stable-downloader-pump");
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(opened.length, 2, "退避期内不得立即重试");
    assert.equal(harness.stored.popoState.jobs[0].status, "downloading");
  } finally {
    harness.cleanup();
  }
});

for (const titleMatches of [true, false]) {
  test(`目录有独立地址时${titleMatches ? "直接打开，不从根目录逐层点击" : "若目录名不符则回退逐层进入"}`, async () => {
    const childUrl = "https://docs.popo.netease.com/team/pc/team1/pageDetail/child1";
    const state = transferState({ includePending: true });
    const pending = state.items.find((item) => item.id === "pending-file");
    Object.assign(pending, {
      directoryPath: [state.selectedFolderName, "子目录"], itemIndex: "3",
      rootUrl: state.rootUrl, parentUrl: childUrl, directoryDirect: true,
      directoryRoute: [{ name: "子目录", itemIndex: "1" }]
    });
    state.items = [pending];
    state.triggerMode = "folder_button";
    state.workerReadyUrl = state.rootUrl;
    state.activeTransfers = [];
    state.activeItemId = null;
    state.jobs[0].counts = { files: 1 };
    const navigated = [];
    const opened = [];
    let currentUrl = state.rootUrl;
    let send;
    const harness = createHarness(
      { popoSettings: state.settings, popoState: state },
      {
        gopeedConfig: { downloadDir: "D:\\Downloads" },
        gopeedTasks: [],
        async sendTabMessage(_tabId, message) {
          if (message.type === "NAVIGATE_WORKER") {
            navigated.push(message.url);
            currentUrl = message.url;
            setTimeout(() => void send(
              { type: "REGISTER_WORKER_FRAME", url: message.url },
              { tab: { id: 7, url: message.url }, url: message.url, frameId: 42 }
            ), 0);
          }
          if (message.type === "PING") {
            return { ok: true, result: {
              url: currentUrl,
              directoryName: currentUrl === childUrl && titleMatches ? "子目录" : "别的目录",
              contextKey: currentUrl
            } };
          }
          if (message.type === "OPEN_ITEM") {
            opened.push(`${message.expectedType}:${message.name}`);
            if (message.expectedType === "folder") {
              currentUrl = childUrl;
              return { ok: true, result: { clicked: true } };
            }
            return { ok: false, error: "测试到此为止" };
          }
          return { ok: true, result: {} };
        }
      }
    );
    send = harness.send;
    try {
      harness.fireAlarm("popo-stable-downloader-pump");
      // 回退路径要先等满目录身份确认时限（3 秒）。
      for (let round = 0; round < 1000 && !opened.includes("file:pending.mp4"); round += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      assert.ok(opened.includes("file:pending.mp4"), "没有走到定位文件");
      if (titleMatches) {
        assert.deepEqual(navigated, [childUrl]);
        assert.deepEqual(opened, ["file:pending.mp4"]);
      } else {
        assert.deepEqual(navigated, [childUrl, state.rootUrl]);
        assert.deepEqual(opened, ["folder:子目录", "file:pending.mp4"]);
      }
    } finally {
      harness.cleanup();
    }
  });
}

test("Gopeed 成功记录读取失败时保持排队且不创建下载", async () => {
  const state = transferState({ includePending: true });
  const pending = state.items.find((item) => item.id === "pending-file");
  pending.directoryPath = [state.selectedFolderName];
  state.items = [pending];
  state.activeTransfers = [];
  state.activeItemId = null;
  state.jobs[0].counts = { files: 1 };
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      gopeedConfig: { downloadDir: "D:\\Downloads" },
      async listGopeedTasks() { throw new Error("history unavailable"); }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => harness.stored.popoState?.phase === "checking_download_history");
    const storedItem = harness.stored["popoItems:job-gopeed-control:0"][0];
    assert.equal(storedItem.status, "pending");
    assert.equal(storedItem.attempts, 0);
    assert.equal(harness.sentTabMessages.some(({ message }) => message.type === "OPEN_ITEM"), false);
    assert.ok(harness.stored.popoState.logs.some((entry) =>
      entry.code === "DOWNLOAD_DEDUPE_HISTORY_ERROR"
    ));
  } finally {
    harness.cleanup();
  }
});

test("旧版本保存过的筛选不会跳过文件夹中的其他格式", async () => {
  const harness = createHarness({
    popoSettings: {
      recursive: false,
      formats: ".mp4",
      includeKeywords: "成片",
      excludeKeywords: "源文件",
      preserveStructure: false,
      concurrency: 2
    }
  });
  try {
    const response = await harness.send({
      type: "START_FOLDER_SCAN",
      parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1",
      folderName: "混合格式素材",
      folderItemIndex: "1"
    });

    assert.equal(response.ok, true);
    assert.equal(harness.stored.popoState.settings.recursive, true);
    assert.equal(harness.stored.popoState.settings.formats, "");
    assert.equal(harness.stored.popoState.settings.includeKeywords, "");
    assert.equal(harness.stored.popoState.settings.excludeKeywords, "");
    assert.equal(harness.stored.popoState.settings.preserveStructure, true);
    assert.equal(harness.stored.popoState.settings.concurrency, 2);

    const snapshot = await harness.send({ type: "GET_STATE" });
    assert.equal(snapshot.settings.formats, "");
    assert.equal(snapshot.settings.includeKeywords, "");
    assert.equal(snapshot.settings.excludeKeywords, "");
  } finally {
    harness.cleanup();
  }
});

test("空闲时并行下载数可在 1 到 5 之间持久化", async () => {
  const harness = createHarness({ popoSettings: { concurrency: 5 } });
  try {
    const response = await harness.send({
      type: "SET_DOWNLOAD_CONCURRENCY",
      concurrency: 2
    });

    assert.equal(response.ok, true);
    assert.equal(response.settings.concurrency, 2);
    assert.equal(response.state.settings.concurrency, 2);
    assert.equal(harness.stored.popoSettings.concurrency, 2);
    assert.equal(harness.stored.popoState.settings.concurrency, 2);
    assert.equal(
      harness.stored.popoState.logs.at(-1).code,
      "DOWNLOAD_CONCURRENCY_CHANGED"
    );

    const snapshot = await harness.send({ type: "GET_STATE" });
    assert.equal(snapshot.settings.concurrency, 2);
  } finally {
    harness.cleanup();
  }
});

test("任务运行或暂停时拒绝调整并行下载数", async () => {
  for (const mode of ["downloading", "paused"]) {
    const state = transferState({ mode, jobStatus: mode });
    const harness = createHarness({
      popoSettings: state.settings,
      popoState: state
    });
    try {
      const response = await harness.send({
        type: "SET_DOWNLOAD_CONCURRENCY",
        concurrency: 4
      });
      assert.equal(response.ok, false);
      assert.match(response.error, /任务进行或暂停时不能调整并行下载数/);
      assert.equal(harness.stored.popoSettings.concurrency, 1);
      assert.equal(harness.stored.popoState.settings.concurrency, 1);

      const legacyResponse = await harness.send({
        type: "SAVE_SETTINGS",
        settings: { ...state.settings, concurrency: 4 }
      });
      assert.equal(legacyResponse.ok, false);
      assert.match(legacyResponse.error, /任务进行或暂停时不能调整并行下载数/);
      assert.equal(harness.stored.popoSettings.concurrency, 1);
      assert.equal(harness.stored.popoState.settings.concurrency, 1);
    } finally {
      harness.cleanup();
    }
  }
});

test("一键下载当前文件夹有未完成项时记录失败并继续剩余批次", async () => {
  const state = transferState();
  const current = state.jobs[0];
  current.batchId = "batch-incomplete";
  current.batchParentUrl = current.parentUrl;
  current.scope = "folder";
  state.jobs.push({
    id: "job-next-folder",
    key: "key-next-folder",
    sourceTabId: 7,
    folderName: "第二个文件夹",
    folderItemIndex: "2",
    parentUrl: current.parentUrl,
    scope: "folder",
    batchId: current.batchId,
    batchParentUrl: current.parentUrl,
    batchPaused: false,
    status: "queued",
    cancelRequested: false,
    createdAt: new Date().toISOString(),
    counts: {}
  });
  state.items = [
    {
      id: "failed-file-1",
      parentUrl: current.parentUrl,
      name: "未完成-1.psd",
      selected: true,
      status: "failed",
      attempts: 3
    },
    {
      id: "failed-file-2",
      parentUrl: current.parentUrl,
      name: "未完成-2.psd",
      selected: true,
      status: "failed",
      attempts: 3
    }
  ];
  state.activeTransfers = [];
  state.activeItemId = null;
  state.preparingItemId = null;
  state.scanQueue = [];
  state.resolveQueue = [];
  state.scanFailures = [];
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    { gopeedConfig: { downloadDir: "D:\\Downloads" } }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => harness.stored.popoState?.activeJobId === "job-next-folder");
    const stored = harness.stored.popoState;
    const failedJob = stored.jobs.find((job) => job.id === current.id);
    const queuedJob = stored.jobs.find((job) => job.id === "job-next-folder");
    assert.equal(failedJob.status, "failed");
    assert.equal(failedJob.counts.failed, 2);
    assert.equal(queuedJob.status, "scanning");
    assert.equal(queuedJob.batchPaused, false);
    assert.equal(stored.folderReceipts.length, 0);
    assert.ok(stored.logs.some((entry) =>
      entry.code === "DOWNLOAD_BATCH_CONTINUED_AFTER_INCOMPLETE_FOLDER"
    ));
  } finally {
    harness.cleanup();
  }
});

test("弹窗检查 Gopeed 连接不会覆盖正在变化的下载状态", async () => {
  const now = new Date().toISOString();
  const state = {
    version: 4,
    runToken: "run-readonly-check",
    jobs: [],
    activeJobId: null,
    mode: "idle",
    phase: "idle",
    settings: { concurrency: 5, gopeedConnections: 1 },
    items: [],
    activeTransfers: [],
    logs: [],
    updatedAt: now
  };
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    { gopeedConfig: { downloadDir: "D:\\Downloads" } }
  );
  try {
    const before = structuredClone(harness.stored.popoState);
    const response = await harness.send({ type: "CHECK_GOPEED" });
    assert.equal(response.ok, true);
    assert.equal(response.connection.connected, true);
    assert.deepEqual(harness.stored.popoState, before);
  } finally {
    harness.cleanup();
  }
});

test("后台再次运行时自动恢复遗留在准备中的文件", async () => {
  const now = new Date().toISOString();
  const state = {
    version: 4,
    runToken: "run-interrupted-preparation",
    jobs: [{
      id: "job-interrupted-preparation",
      key: "key-interrupted-preparation",
      sourceTabId: 7,
      folderName: "混合格式素材",
      folderItemIndex: "1",
      parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1",
      status: "downloading",
      cancelRequested: false,
      createdAt: now,
      counts: {}
    }],
    activeJobId: "job-interrupted-preparation",
    mode: "downloading",
    phase: "preview_loading",
    triggerMode: "folder_button",
    sourceTabId: 7,
    selectedFolderName: "混合格式素材",
    workerFrameId: 42,
    workerReadyUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/folder1",
    settings: { concurrency: 5, gopeedConnections: 1 },
    items: [{
      id: "orphan-preparing-file",
      name: "动画.gif",
      selected: true,
      status: "preparing",
      stage: "建立 Gopeed 任务",
      attempts: 1,
      failureStage: "",
      error: ""
    }],
    preparingItemId: "orphan-preparing-file",
    activeItemId: "orphan-preparing-file",
    activeTransfers: [],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    scannedFolderCount: 0,
    gopeedConnected: true,
    logs: [],
    startedAt: now,
    completedAt: ""
  };
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    { gopeedTasks: [] }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    for (let attempt = 0; attempt < 30 && harness.stored.popoState.preparingItemId; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(harness.stored.popoState.preparingItemId, null);
    assert.equal(harness.stored.popoState.activeItemId, null);
    const recovered = harness.stored["popoItems:job-interrupted-preparation:0"][0];
    assert.equal(recovered.status, "pending");
    assert.equal(recovered.attempts, 0);
    assert.match(recovered.stage, /自动接续/);
  } finally {
    harness.cleanup();
  }
});

test("服务工作线程中断后按稳定标签重新挂接已创建的 Gopeed 任务", async () => {
  const now = new Date().toISOString();
  const itemId = "orphan-after-gopeed-create";
  const jobId = "job-reconcile-created-task";
  const labels = buildTaskIdentityLabels({ jobId, taskIdentity: itemId });
  const state = {
    version: 4,
    runToken: "run-reconcile-created-task",
    jobs: [{
      id: jobId,
      key: "key-reconcile-created-task",
      sourceTabId: 7,
      folderName: "母文件 A",
      folderItemIndex: "1",
      parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1",
      status: "downloading",
      cancelRequested: false,
      createdAt: now,
      counts: {}
    }],
    activeJobId: jobId,
    mode: "downloading",
    phase: "download_start",
    triggerMode: "folder_button",
    sourceTabId: 7,
    selectedFolderName: "母文件 A",
    workerFrameId: 42,
    workerReadyUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/folder1",
    settings: { concurrency: 5, gopeedConnections: 1 },
    items: [{
      id: itemId,
      parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/folder1",
      itemIndex: "7",
      name: "动画.gif",
      selected: true,
      status: "preparing",
      stage: "建立 Gopeed 任务",
      attempts: 1,
      startedAt: now,
      failureStage: "",
      error: ""
    }],
    preparingItemId: itemId,
    activeItemId: itemId,
    activeTransfers: [],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    scannedFolderCount: 0,
    gopeedConnected: true,
    logs: [],
    startedAt: now,
    completedAt: ""
  };
  const gopeedTasks = [{
    id: "task-reconciled",
    status: "running",
    progress: { downloaded: 1024, speed: 128 },
    meta: {
      req: { labels: { source: "popo-stable-downloader", ...labels } }
    }
  }];
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    { gopeedTasks }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    for (let attempt = 0; attempt < 30 && !harness.stored.popoState?.activeTransfers?.length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(harness.stored.popoState.preparingItemId, null);
    assert.deepEqual(harness.stored.popoState.activeTransfers, [{
      itemId,
      taskId: "task-reconciled",
      pollFailures: 0,
      lastObservedStatus: "active",
      resumeAfterReconnect: false,
      restartResumeFailures: 0,
      externalPaused: false,
      startedAt: now,
      reconciledAt: harness.stored.popoState.activeTransfers[0].reconciledAt
    }]);
    const recovered = harness.stored[`popoItems:${jobId}:0`][0];
    assert.equal(recovered.status, "transferring");
    assert.equal(recovered.gopeedTaskId, "task-reconciled");
    assert.match(recovered.stage, /已恢复关联/);
    assert.equal(harness.stored.popoState.runtimeHealth.reconciliation.recoveredCount, 1);
    assert.equal(harness.stored.popoState.runtimeHealth.lastEventCode, "GOPEED_TASK_RECONCILED");
    assert.ok(harness.stored.popoState.logs.some(
      (entry) => entry.code === "GOPEED_TASK_RECONCILED" && entry.context.taskKey === labels.popoTaskKey
    ));
    const snapshot = await harness.send({ type: "GET_STATE" });
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.state.runtimeHealth.reconciliation.lastOutcome, "recovered");
    assert.equal(snapshot.state.runtimeHealth.eventCounts.GOPEED_TASK_RECONCILED, 1);
  } finally {
    harness.cleanup();
  }
});

test("Gopeed 对账接口失败时保留准备状态并等待重试", async () => {
  const now = new Date().toISOString();
  const itemId = "orphan-waiting-reconciliation";
  const jobId = "job-reconciliation-error";
  const state = {
    version: 4,
    runToken: "run-reconciliation-error",
    jobs: [{
      id: jobId,
      key: "key-reconciliation-error",
      sourceTabId: 7,
      folderName: "母文件 B",
      folderItemIndex: "2",
      parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1",
      status: "downloading",
      cancelRequested: false,
      createdAt: now,
      counts: {}
    }],
    activeJobId: jobId,
    mode: "downloading",
    phase: "download_start",
    triggerMode: "folder_button",
    sourceTabId: 7,
    selectedFolderName: "母文件 B",
    workerFrameId: 42,
    settings: { concurrency: 5, gopeedConnections: 1 },
    items: [{
      id: itemId,
      name: "设计源文件.psd",
      selected: true,
      status: "preparing",
      stage: "建立 Gopeed 任务",
      attempts: 1
    }],
    preparingItemId: itemId,
    activeItemId: itemId,
    activeTransfers: [],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    scannedFolderCount: 0,
    gopeedConnected: true,
    logs: [],
    startedAt: now,
    completedAt: ""
  };
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    { listGopeedTasks: async () => { throw new Error("temporary list failure"); } }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    for (let attempt = 0; attempt < 30 && !harness.stored.popoState?.runtimeHealth; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(harness.stored.popoState.preparingItemId, itemId);
    assert.deepEqual(harness.stored.popoState.activeTransfers, []);
    assert.equal(harness.stored.popoState.phase, "reconciling_gopeed");
    assert.equal(harness.stored.popoState.runtimeHealth.reconciliation.lastOutcome, "error");
    assert.equal(harness.stored.popoState.runtimeHealth.reconciliation.errorCount, 1);
    assert.equal(harness.stored.popoState.runtimeHealth.lastEventCode, "GOPEED_RECONCILIATION_ERROR");
  } finally {
    harness.cleanup();
  }
});

test("扫描未结束时可恢复已交付的 Gopeed 任务并继续保持扫描态", async () => {
  const now = new Date().toISOString();
  const jobId = "job-persistent-pipeline";
  const itemId = "https://docs.popo.netease.com/folder\u00007\u0000动画.gif";
  const labels = buildTaskIdentityLabels({ jobId, taskIdentity: itemId });
  const state = {
    version: 4,
    runToken: "run-persistent-pipeline",
    jobs: [{
      id: jobId,
      key: "key-persistent-pipeline",
      sourceTabId: 7,
      folderName: "大型母文件",
      folderItemIndex: "2",
      parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1",
      status: "scanning",
      cancelRequested: false,
      createdAt: now,
      counts: {}
    }],
    activeJobId: jobId,
    mode: "scanning",
    phase: "scanning_and_downloading",
    triggerMode: "folder_button",
    sourceTabId: 7,
    selectedFolderName: "大型母文件",
    workerFrameId: 42,
    workerReadyUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/folder1",
    settings: { concurrency: 5, gopeedConnections: 1 },
    items: [{
      id: itemId,
      parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/folder1",
      itemIndex: "7",
      name: "动画.gif",
      selected: true,
      status: "preparing",
      stage: "建立 Gopeed 任务",
      attempts: 1,
      startedAt: now,
      failureStage: "",
      error: ""
    }],
    preparingItemId: itemId,
    activeItemId: itemId,
    activeTransfers: [],
    scanQueue: [{
      url: "https://docs.popo.netease.com/team/pc/team1/pageDetail/folder-next",
      path: ["大型母文件", "下一层"]
    }],
    resolveQueue: [],
    scanFailures: [],
    scannedFolderCount: 0,
    gopeedConnected: true,
    workflow: {
      version: 1,
      sequence: 3,
      value: { scan: "running", handoff: "preparing", transfer: "idle" },
      nextAction: "handoff",
      reservedItemId: itemId,
      counts: { discovered: 1, selected: 1, preparing: 1 },
      updatedAt: now
    },
    logs: [],
    startedAt: now,
    completedAt: ""
  };
  const gopeedTasks = [{
    id: "task-pipeline-recovered",
    status: "running",
    progress: { downloaded: 2048, speed: 256 },
    meta: { req: { labels: { source: "popo-stable-downloader", ...labels } } }
  }];
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    { gopeedTasks }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    for (let attempt = 0; attempt < 30 && !harness.stored.popoState?.activeTransfers?.length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(harness.stored.popoState.mode, "scanning");
    assert.equal(harness.stored.popoState.scanQueue.length, 1);
    assert.equal(harness.stored.popoState.preparingItemId, null);
    assert.equal(harness.stored.popoState.activeTransfers[0].taskId, "task-pipeline-recovered");
    assert.deepEqual(harness.stored.popoState.workflow.value, {
      scan: "running",
      handoff: "idle",
      transfer: "active"
    });
    assert.equal(harness.stored.popoState.workflow.nextAction, "scan");
    assert.equal(harness.stored.popoState.jobs[0].counts.handedOff, 1);
  } finally {
    harness.cleanup();
  }
});

test("opening the extension finalizes a cancelled job with a paused Gopeed transfer", async () => {
  const now = new Date().toISOString();
  const state = {
    version: 4,
    runToken: "run-stuck-cancel",
    jobs: [{
      id: "job-stuck-cancel",
      key: "key-stuck-cancel",
      sourceTabId: 7,
      folderName: "cancelled folder",
      folderItemIndex: "1",
      parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1",
      status: "draining_paused",
      cancelRequested: true,
      createdAt: now,
      counts: {}
    }],
    activeJobId: "job-stuck-cancel",
    mode: "draining_paused",
    phase: "draining_paused",
    triggerMode: "folder_button",
    sourceTabId: 7,
    selectedFolderName: "cancelled folder",
    settings: { concurrency: 5, gopeedConnections: 1 },
    items: [{
      id: "started-file",
      name: "started.mp4",
      selected: true,
      status: "paused",
      gopeedTaskId: "gopeed-task-1"
    }],
    activeTransfers: [{ itemId: "started-file", taskId: "gopeed-task-1" }],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    scannedFolderCount: 0,
    logs: [],
    startedAt: now,
    completedAt: ""
  };
  const harness = createHarness({ popoSettings: state.settings, popoState: state });
  try {
    const response = await harness.send({ type: "GET_STATE" });
    assert.equal(response.ok, true);
    assert.equal(response.state.activeJobId, null);
    assert.equal(response.state.mode, "idle");
    assert.deepEqual(response.state.jobs, []);
    assert.equal(harness.stored.popoState.jobs[0].status, "cancelled");
    assert.deepEqual(harness.deletedGopeedTasks, []);
  } finally {
    harness.cleanup();
  }
});

test("取消活动任务仅取消未开始文件并保留 Gopeed 传输", async () => {
  const now = new Date().toISOString();
  const settings = { concurrency: 5, gopeedConnections: 1 };
  const state = {
    version: 4,
    runToken: "run-seeded",
    jobs: [{
      id: "job-a",
      key: "key-a",
      sourceTabId: 7,
      folderName: "母文件 A",
      folderItemIndex: "1",
      parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1",
      status: "downloading",
      cancelRequested: false,
      createdAt: now,
      counts: {}
    }],
    activeJobId: "job-a",
    mode: "downloading",
    phase: "preview_loading",
    triggerMode: "folder_button",
    sourceTabId: 7,
    selectedFolderName: "母文件 A",
    settings,
    items: [
      { id: "active", parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/folder1", name: "active.mp4", selected: true, status: "transferring", gopeedTaskId: "task-1" },
      { id: "pending", parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/folder1", name: "pending.mp4", selected: true, status: "pending", gopeedTaskId: null }
    ],
    activeTransfers: [{ itemId: "active", taskId: "task-1" }],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    scannedFolderCount: 0,
    logs: [],
    startedAt: now,
    completedAt: ""
  };
  const harness = createHarness({ popoSettings: settings, popoState: state });
  try {
    const response = await harness.send({ type: "CANCEL_JOB", jobId: "job-a" });
    assert.equal(response.ok, true);
    assert.equal(response.state.mode, "idle");
    assert.equal(response.state.jobs.length, 1);
    assert.equal(response.state.jobs[0].status, "cancelled");
    assert.deepEqual(response.state.jobs[0].cancelledRetryKeys, [
      "https://docs.popo.netease.com/team/pc/team1/pageDetail/folder1\u0000pending.mp4"
    ]);
    assert.deepEqual(harness.deletedGopeedTasks, []);
    assert.equal(harness.stored.popoState.jobs[0].status, "cancelled");
    assert.equal(harness.stored.popoState.jobs[0].cancelRequested, true);
    assert.deepEqual(harness.stored.popoState.activeTransfers, []);
  } finally {
    harness.cleanup();
  }
});

test("移除终止任务只清理扩展记录且不删除下载任务或文件", async () => {
  const now = new Date().toISOString();
  const settings = { concurrency: 5, gopeedConnections: 1 };
  const state = {
    version: 4,
    runToken: "run-dismiss-terminal",
    jobs: [{
      id: "job-cancelled",
      key: "folder-a",
      folderName: "母文件 A",
      status: "cancelled",
      createdAt: now,
      completedAt: now,
      counts: { files: 3, success: 1, failed: 0, cancelled: 2 },
      cancelledRetryKeys: ["folder\u0000a.psd", "folder\u0000b.psd"]
    }, {
      id: "job-cancelled-retry",
      key: "folder-a",
      restoreOfJobId: "job-cancelled",
      folderName: "母文件 A",
      status: "failed",
      createdAt: now,
      completedAt: now,
      counts: { files: 0, success: 0, failed: 0, cancelled: 0 }
    }, {
      id: "job-unrelated-failure",
      key: "folder-b",
      folderName: "母文件 B",
      status: "failed",
      createdAt: now,
      completedAt: now,
      counts: { files: 1, success: 0, failed: 1, cancelled: 0 },
      failureRetryKeys: ["folder\u0000broken.psd"]
    }],
    activeJobId: null,
    mode: "idle",
    phase: "idle",
    settings,
    activeTransfers: [],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    logs: []
  };
  const harness = createHarness({ popoSettings: settings, popoState: state });
  try {
    const response = await harness.send({ type: "DISMISS_JOB", jobId: "job-cancelled" });
    assert.equal(response.ok, true);
    assert.deepEqual(harness.stored.popoState.jobs.map((job) => job.id), ["job-unrelated-failure"]);
    assert.deepEqual(response.state.jobs.map((job) => job.id), ["job-unrelated-failure"]);
    assert.deepEqual(harness.deletedGopeedTasks, []);
  } finally {
    harness.cleanup();
  }
});

test("进行中的显式重试任务不能被移除", async () => {
  const now = new Date().toISOString();
  const settings = { concurrency: 5, gopeedConnections: 1 };
  const state = {
    version: 4,
    runToken: "run-dismiss-active",
    jobs: [{
      id: "job-old-failure",
      key: "folder-a",
      folderName: "母文件 A",
      status: "failed",
      createdAt: now,
      completedAt: now,
      counts: { files: 1, success: 0, failed: 1, cancelled: 0 }
    }, {
      id: "job-active-retry",
      key: "folder-a",
      retryOfJobId: "job-old-failure",
      folderName: "母文件 A",
      status: "paused",
      createdAt: now,
      counts: { files: 1, success: 0, failed: 0, cancelled: 0 }
    }],
    activeJobId: "job-active-retry",
    mode: "paused",
    phase: "paused",
    settings,
    items: [],
    activeTransfers: [],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    logs: []
  };
  const harness = createHarness({ popoSettings: settings, popoState: state });
  try {
    const response = await harness.send({ type: "DISMISS_JOB", jobId: "job-old-failure" });
    assert.equal(response.ok, false);
    assert.match(response.error, /仍在进行/);
    assert.equal(harness.stored.popoState.jobs.length, 2);
  } finally {
    harness.cleanup();
  }
});

test("同一文件夹后来创建的独立任务不会阻止移除旧记录", async () => {
  const now = new Date().toISOString();
  const settings = { concurrency: 5, gopeedConnections: 1 };
  const state = {
    version: 4,
    runToken: "run-dismiss-independent-same-folder",
    jobs: [{
      id: "job-old-cancelled",
      key: "folder-a",
      folderName: "母文件 A",
      status: "cancelled",
      createdAt: now,
      completedAt: now,
      counts: { files: 1, success: 0, failed: 0, cancelled: 1 },
      cancelledRetryKeys: ["folder\u0000old.psd"]
    }, {
      id: "job-new-independent",
      key: "folder-a",
      folderName: "母文件 A",
      status: "paused",
      createdAt: now,
      counts: { files: 2, success: 0, failed: 0, cancelled: 0 }
    }],
    activeJobId: "job-new-independent",
    mode: "paused",
    phase: "paused",
    settings,
    items: [],
    activeTransfers: [],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    logs: []
  };
  const harness = createHarness({ popoSettings: settings, popoState: state });
  try {
    const response = await harness.send({ type: "DISMISS_JOB", jobId: "job-old-cancelled" });
    assert.equal(response.ok, true);
    assert.deepEqual(response.state.jobs.map((job) => job.id), ["job-new-independent"]);
    assert.deepEqual(harness.stored.popoState.jobs.map((job) => job.id), ["job-new-independent"]);
  } finally {
    harness.cleanup();
  }
});

test("升级后可从旧版取消状态中只恢复未开始文件", async () => {
  const now = new Date().toISOString();
  const parentUrl = "https://docs.popo.netease.com/team/pc/team1/pageDetail/folder1";
  const state = {
    version: 4,
    runToken: "run-legacy-cancelled",
    jobs: [{
      id: "job-legacy-cancelled",
      key: "key-legacy-cancelled",
      sourceTabId: 7,
      folderName: "母文件 A",
      folderItemIndex: "1",
      parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1",
      status: "cancelled",
      cancelRequested: true,
      createdAt: now,
      completedAt: now,
      counts: { files: 3, success: 1, failed: 0, cancelled: 2 }
    }],
    activeJobId: null,
    mode: "idle",
    phase: "idle",
    itemStorageJobId: "idle",
    itemChunkCount: 1,
    itemChunkHashes: [],
    activeTransfers: [],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    settings: { concurrency: 5, gopeedConnections: 1 },
    logs: []
  };
  const items = [
    { id: "done", parentUrl, name: "done.psd", selected: true, status: "success" },
    { id: "cancelled-1", parentUrl, name: "remaining.gif", selected: true, status: "cancelled" },
    { id: "cancelled-2", parentUrl, name: "remaining.bin", selected: true, status: "cancelled" }
  ];
  const harness = createHarness({
    popoSettings: state.settings,
    popoState: state,
    "popoItems:idle:0": items
  });
  try {
    const response = await harness.send({
      type: "RESTORE_CANCELLED_JOB",
      jobId: "job-legacy-cancelled"
    });
    assert.equal(response.ok, true);
    assert.equal(response.state.mode, "waiting_worker");
    assert.equal(response.state.jobs.length, 1);
    assert.match(response.state.jobs[0].displayName, /恢复未开始文件/);
    const storedJobs = harness.stored.popoState.jobs;
    const source = storedJobs.find((job) => job.id === "job-legacy-cancelled");
    const restored = storedJobs.find((job) => job.restoreOfJobId === source.id);
    assert.deepEqual(source.cancelledRetryKeys, [
      `${parentUrl}\u0000remaining.gif`,
      `${parentUrl}\u0000remaining.bin`
    ]);
    assert.deepEqual(restored.retryKeys, source.cancelledRetryKeys);
    assert.equal(restored.status, "waiting_worker");
    assert.equal(harness.deletedGopeedTasks.length, 0);
    assert.ok(harness.sentTabMessages.some(({ message }) => message.type === "ENSURE_WORKER_FRAME"));
  } finally {
    harness.cleanup();
  }
});

test("从弹窗恢复时改用当前打开的 POPO 页面承载隐藏工作区", async () => {
  const now = new Date().toISOString();
  const state = {
    version: 4,
    runToken: "run-popup-restore",
    jobs: [{
      id: "job-popup-restore",
      key: "key-popup-restore",
      sourceTabId: 99,
      folderName: "母文件 A",
      folderItemIndex: "1",
      parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1",
      status: "cancelled",
      cancelRequested: true,
      createdAt: now,
      completedAt: now,
      counts: { files: 2, success: 1, failed: 0, cancelled: 1 },
      cancelledRetryKeys: [
        "https://docs.popo.netease.com/team/pc/team1/pageDetail/folder1\u0000remaining.psd"
      ]
    }],
    activeJobId: null,
    mode: "idle",
    phase: "idle",
    itemStorageJobId: "idle",
    itemChunkCount: 0,
    activeTransfers: [],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    settings: { concurrency: 5, gopeedConnections: 1 },
    logs: []
  };
  const harness = createHarness({ popoSettings: state.settings, popoState: state });
  try {
    const response = await harness.send(
      { type: "RESTORE_CANCELLED_JOB", jobId: "job-popup-restore", sourceTabId: 7 },
      { url: "chrome-extension://coocdgkmbpkacapjlmnmemebmmdahjaa/popup.html", frameId: 0 }
    );
    assert.equal(response.ok, true);
    const source = harness.stored.popoState.jobs.find((job) => job.id === "job-popup-restore");
    const restored = harness.stored.popoState.jobs.find(
      (job) => job.restoreOfJobId === "job-popup-restore"
    );
    assert.equal(source.sourceTabId, 7);
    assert.equal(restored.sourceTabId, 7);
    assert.ok(harness.sentTabMessages.some(({ tabId, message }) =>
      tabId === 7 && message.type === "ENSURE_WORKER_FRAME"
    ));
  } finally {
    harness.cleanup();
  }
});

test("旧版取消任务丢失明细时按 Gopeed 已有保存路径恢复缺失文件", async () => {
  const now = new Date().toISOString();
  const state = {
    version: 4,
    runToken: "run-legacy-no-items",
    jobs: [{
      id: "job-legacy-no-items",
      key: "key-legacy-no-items",
      sourceTabId: 7,
      folderName: "母文件 A",
      folderItemIndex: "1",
      parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1",
      status: "cancelled",
      cancelRequested: true,
      createdAt: now,
      completedAt: now,
      counts: { files: 3, success: 1, failed: 0, cancelled: 2 }
    }],
    activeJobId: null,
    mode: "idle",
    phase: "idle",
    itemStorageJobId: "",
    itemChunkCount: 0,
    activeTransfers: [],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    settings: { downloadRoot: "POPO稳定下载", concurrency: 5, gopeedConnections: 1 },
    logs: []
  };
  const gopeedTasks = [{
    status: "done",
    name: "done.psd",
    meta: {
      req: { labels: { source: "popo-stable-downloader" } },
      opts: {
        path: "D:\\Downloads\\POPO稳定下载\\母文件 A",
        name: "done.psd"
      }
    }
  }];
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      gopeedConfig: { downloadDir: "D:\\Downloads" },
      gopeedTasks
    }
  );
  try {
    const response = await harness.send({
      type: "RESTORE_CANCELLED_JOB",
      jobId: "job-legacy-no-items"
    });
    assert.equal(response.ok, true);
    assert.equal(response.state.mode, "waiting_worker");
    const source = harness.stored.popoState.jobs.find((job) => job.id === "job-legacy-no-items");
    const restored = harness.stored.popoState.jobs.find((job) => job.restoreOfJobId === source.id);
    assert.deepEqual(restored.retryKeys, []);
    assert.equal(restored.restoreStrategy, "missing_from_gopeed");
    assert.equal(restored.restoreExpectedCount, 2);
    assert.deepEqual(restored.existingGopeedTargetKeys, [
      "popo稳定下载/母文件 a/done.psd"
    ]);
    assert.equal(response.state.jobs[0].existingGopeedTargetCount, 1);
    assert.equal(response.state.jobs[0].existingGopeedTargetKeys, undefined);
    assert.ok(harness.sentTabMessages.some(({ message }) => message.type === "ENSURE_WORKER_FRAME"));
  } finally {
    harness.cleanup();
  }
});

test("刷新 POPO 页面会恢复准备中的文件且保留已开始的 Gopeed 下载", async () => {
  const now = new Date().toISOString();
  const settings = { concurrency: 5, gopeedConnections: 1 };
  const state = {
    version: 4,
    runToken: "run-refresh",
    jobs: [{
      id: "job-refresh",
      key: "key-refresh",
      sourceTabId: 7,
      folderName: "母文件 A",
      folderItemIndex: "1",
      parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1",
      status: "downloading",
      cancelRequested: false,
      createdAt: now,
      counts: {}
    }],
    activeJobId: "job-refresh",
    mode: "downloading",
    phase: "preview_loading",
    triggerMode: "folder_button",
    sourceTabId: 7,
    selectedFolderName: "母文件 A",
    rootUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1",
    workerFrameId: 42,
    workerReadyUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/folder1",
    settings,
    items: [
      { id: "active", name: "active.mp4", selected: true, status: "transferring", gopeedTaskId: "task-1" },
      { id: "preparing", name: "preparing.mp4", selected: true, status: "preparing", attempts: 2 }
    ],
    preparingItemId: "preparing",
    activeTransfers: [{ itemId: "active", taskId: "task-1" }],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    scannedFolderCount: 0,
    logs: [],
    startedAt: now,
    completedAt: ""
  };
  const harness = createHarness({ popoSettings: settings, popoState: state });
  try {
    const response = await harness.send({
      type: "SOURCE_PAGE_READY",
      url: state.rootUrl
    });
    assert.equal(response.ok, true);
    assert.equal(response.needsWorker, true);
    assert.equal(response.workerUrl, state.rootUrl);
    assert.equal(harness.stored.popoState.mode, "downloading");
    assert.equal(harness.stored.popoState.workerFrameId, null);
    assert.equal(harness.stored.popoState.preparingItemId, null);
    assert.deepEqual(harness.stored.popoState.activeTransfers, [{ itemId: "active", taskId: "task-1" }]);
    const items = harness.stored["popoItems:job-refresh:0"];
    assert.equal(items.find((item) => item.id === "active").status, "transferring");
    assert.equal(items.find((item) => item.id === "preparing").status, "pending");
    assert.equal(items.find((item) => item.id === "preparing").attempts, 1);
    assert.equal(items.find((item) => item.id === "preparing").failureStage, "");
    assert.equal(harness.actionState.text, "0%");
    assert.match(harness.actionState.title, /0\/2（0%）/);
  } finally {
    harness.cleanup();
  }
});

test("原 POPO 标签页关闭后可在其他团队空间的 POPO 标签页恢复任务", async () => {
  const now = new Date().toISOString();
  const rootUrl = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
  const state = {
    version: 4,
    runToken: "run-reopen",
    jobs: [{
      id: "job-reopen",
      key: "key-reopen",
      sourceTabId: 7,
      folderName: "母文件 A",
      folderItemIndex: "1",
      parentUrl: rootUrl,
      status: "downloading",
      cancelRequested: false,
      createdAt: now,
      counts: { files: 1 }
    }],
    activeJobId: "job-reopen",
    mode: "downloading",
    phase: "waiting_worker",
    triggerMode: "folder_button",
    sourceTabId: 7,
    selectedFolderName: "母文件 A",
    rootUrl,
    teamSpaceKey: "team1",
    workerFrameId: null,
    settings: { concurrency: 5, gopeedConnections: 1 },
    items: [{ id: "pending", name: "pending.mp4", selected: true, status: "pending", attempts: 0 }],
    activeTransfers: [],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    scannedFolderCount: 0,
    logs: [],
    startedAt: now,
    completedAt: ""
  };
  const harness = createHarness({ popoSettings: state.settings, popoState: state });
  try {
    const response = await harness.send(
      { type: "SOURCE_PAGE_READY", url: "https://docs.popo.netease.com/team/pc/team2/pageDetail/another1" },
      {
        tab: { id: 9, url: "https://docs.popo.netease.com/team/pc/team2/pageDetail/another1" },
        url: "https://docs.popo.netease.com/team/pc/team2/pageDetail/another1",
        frameId: 0
      }
    );
    assert.equal(response.ok, true);
    assert.equal(response.needsWorker, true);
    assert.equal(harness.stored.popoState.sourceTabId, 9);
    assert.equal(harness.stored.popoState.jobs[0].sourceTabId, 9);
    assert.match(harness.stored.popoState.lastMessage, /恢复任务/);
  } finally {
    harness.cleanup();
  }
});

test("继续下载时会主动重建失联的页面工作区", async () => {
  const now = new Date().toISOString();
  const rootUrl = "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1";
  const state = {
    version: 4,
    runToken: "run-paused-worker-missing",
    jobs: [{
      id: "job-paused-worker-missing",
      key: "key-paused-worker-missing",
      sourceTabId: 7,
      folderName: "母文件 A",
      folderItemIndex: "1",
      parentUrl: rootUrl,
      status: "paused",
      cancelRequested: false,
      createdAt: now,
      counts: { files: 1, success: 0, failed: 0, cancelled: 0 }
    }],
    activeJobId: "job-paused-worker-missing",
    mode: "paused",
    phase: "paused",
    triggerMode: "folder_button",
    sourceTabId: 7,
    selectedFolderName: "母文件 A",
    rootUrl,
    teamSpaceKey: "team1",
    workerFrameId: null,
    settings: { concurrency: 5, gopeedConnections: 1 },
    items: [{
      id: "pending",
      parentUrl: rootUrl,
      name: "pending.psd",
      selected: true,
      status: "pending",
      attempts: 0
    }],
    activeTransfers: [],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    scannedFolderCount: 0,
    logs: [],
    startedAt: now,
    completedAt: ""
  };
  const harness = createHarness({ popoSettings: state.settings, popoState: state });
  try {
    const response = await harness.send({ type: "RESUME" });
    assert.equal(response.ok, true);
    assert.equal(response.state.mode, "downloading");
    assert.ok(harness.sentTabMessages.some(({ tabId, message }) =>
      tabId === 7 && message.type === "ENSURE_WORKER_FRAME" && message.url === rootUrl
    ));
  } finally {
    harness.cleanup();
  }
});

test("旧版 chrome.storage 文件分块首次读取后迁移到 IndexedDB", async () => {
  const restoreIndexedDb = installFakeIndexedDb();
  const runtime = require("../runtime/popo-runtime.cjs");
  await runtime.taskStore.resetDatabaseForTests();
  const now = new Date().toISOString();
  const jobId = "job-legacy-storage";
  const legacyKey = "popoItems:" + jobId + ":0";
  const items = [{
    id: "legacy-item",
    parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1",
    name: "legacy.psd",
    selected: true,
    status: "pending",
    attempts: 0
  }];
  const state = {
    version: 4,
    runToken: "run-legacy-storage",
    jobs: [{
      id: jobId,
      key: "legacy-storage-key",
      sourceTabId: null,
      folderName: "旧版大任务",
      folderItemIndex: "1",
      parentUrl: items[0].parentUrl,
      status: "downloading",
      cancelRequested: false,
      createdAt: now,
      counts: { files: 1 }
    }],
    activeJobId: jobId,
    mode: "downloading",
    phase: "starting",
    triggerMode: "folder_button",
    sourceTabId: null,
    settings: { concurrency: 5, gopeedConnections: 1 },
    itemStorageBackend: "chrome-storage-fallback",
    itemStorageGeneration: "",
    itemStorageJobId: jobId,
    itemChunkCount: 1,
    itemChunkHashes: [],
    activeTransfers: [],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    scannedFolderCount: 0,
    logs: [],
    startedAt: now,
    completedAt: ""
  };
  const harness = createHarness({
    popoSettings: state.settings,
    popoState: state,
    [legacyKey]: items
  });
  try {
    const response = await harness.send({ type: "PAUSE" });
    assert.equal(response.ok, true);
    assert.equal(harness.stored.popoState.itemStorageBackend, "indexeddb");
    assert.match(harness.stored.popoState.itemStorageGeneration, /^v1-/);
    assert.equal(legacyKey in harness.stored, false);
    assert.ok(harness.stored.popoState.runtimeHealth.storage.lastMigrationAt);
    const restored = await runtime.taskStore.readItemChunks({
      jobId,
      generation: harness.stored.popoState.itemStorageGeneration,
      chunkCount: 1,
      hashes: harness.stored.popoState.itemChunkHashes
    });
    assert.deepEqual(restored, items);
  } finally {
    harness.cleanup();
    await runtime.taskStore.resetDatabaseForTests();
    restoreIndexedDb();
  }
});

test("万级文件状态按块持久化且公开状态不传输完整文件数组", async () => {
  const restoreIndexedDb = installFakeIndexedDb();
  const runtime = require("../runtime/popo-runtime.cjs");
  await runtime.taskStore.resetDatabaseForTests();
  const now = new Date().toISOString();
  const items = Array.from({ length: 10000 }, (_, index) => ({
    id: `item-${index}`,
    name: `video-${index}.mp4`,
    parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/folder1",
    selected: true,
    status: "pending"
  }));
  const state = {
    version: 4,
    runToken: "run-large",
    jobs: [{
      id: "job-large",
      key: "key-large",
      sourceTabId: 7,
      folderName: "超大母文件",
      folderItemIndex: "8",
      parentUrl: "https://docs.popo.netease.com/team/pc/team1/pageDetail/root1",
      status: "downloading",
      cancelRequested: false,
      createdAt: now,
      counts: {}
    }],
    activeJobId: "job-large",
    mode: "downloading",
    phase: "starting",
    triggerMode: "folder_button",
    sourceTabId: 7,
    selectedFolderName: "超大母文件",
    settings: { concurrency: 5, gopeedConnections: 1 },
    items,
    activeTransfers: [],
    scanQueue: [],
    resolveQueue: [],
    scanFailures: [],
    scannedFolderCount: 50,
    logs: [],
    startedAt: now,
    completedAt: ""
  };
  const harness = createHarness({ popoState: state, popoSettings: state.settings });
  try {
    const paused = await harness.send({ type: "PAUSE" });
    assert.equal(paused.ok, true);
    assert.equal(harness.stored.popoState.itemChunkCount, 50);
    assert.equal(harness.stored.popoState.itemStorageBackend, "indexeddb");
    assert.match(harness.stored.popoState.itemStorageGeneration, /^v1-/);
    assert.equal("items" in harness.stored.popoState, false);
    assert.equal("popoItems:job-large:0" in harness.stored, false);
    const restoredItems = await runtime.taskStore.readItemChunks({
      jobId: "job-large",
      generation: harness.stored.popoState.itemStorageGeneration,
      chunkCount: 50,
      hashes: harness.stored.popoState.itemChunkHashes
    });
    assert.equal(restoredItems.length, 10000);
    assert.equal(restoredItems[9999].id, "item-9999");
    const snapshot = await harness.send({ type: "GET_STATE" });
    assert.equal("items" in snapshot.state, false);
    assert.equal(snapshot.state.jobs[0].counts.files, 10000);
    assert.equal(snapshot.state.jobs[0].counts.projects, 10050);
  } finally {
    harness.cleanup();
    await runtime.taskStore.resetDatabaseForTests();
    restoreIndexedDb();
  }
});

test("手动暂停和继续 Gopeed 任务时项目保持运行并持续对账", async () => {
  const state = transferState();
  let gopeedStatus = "pause";
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      async getGopeedTask() {
        return { status: gopeedStatus, progress: { downloaded: 1024, speed: 0 } };
      }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => harness.stored.popoState?.activeTransfers?.[0]?.externalPaused === true);
    assert.equal(harness.stored.popoState.mode, "downloading");
    assert.equal(harness.stored["popoItems:job-gopeed-control:0"][0].status, "paused");

    gopeedStatus = "running";
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => harness.stored.popoState?.activeTransfers?.[0]?.externalPaused === false);
    assert.equal(harness.stored.popoState.mode, "downloading");
    assert.equal(harness.stored["popoItems:job-gopeed-control:0"][0].status, "transferring");
    assert.ok(harness.stored.popoState.logs.some((entry) =>
      entry.code === "GOPEED_TASK_RESUMED_EXTERNALLY"
    ));
  } finally {
    harness.cleanup();
  }
});

test("Gopeed 数据契约连续异常会暂停项目而不误报断线或重建任务", async () => {
  const state = transferState();
  state.gopeedConnected = true;
  const harness = createHarness({ popoSettings: state.settings, popoState: state }, {
    async getGopeedTask() { throw new Error("Gopeed SDK 返回数据不符合约定：meta.res Invalid input"); }
  });
  try {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      harness.fireAlarm("popo-stable-downloader-pump");
      await waitUntil(() => harness.stored.popoState?.activeTransfers?.[0]?.contractFailures === attempt);
    }
    const saved = harness.stored.popoState;
    assert.equal(saved.mode, "paused");
    assert.equal(saved.pauseOrigin, "gopeed_contract");
    assert.equal(saved.activeTransfers[0].taskId, "task-active");
    assert.equal(saved.logs.some((entry) => entry.code === "GOPEED_CONNECTION_LOST"), false);
    assert.equal(saved.logs.some((entry) => entry.code === "GOPEED_DATA_INVALID"), true);
  } finally {
    harness.cleanup();
  }
});

test("页面工作区恢复超时保留已完成文件并标记未完成项可重试", async () => {
  const state = transferState({ mode: "waiting_worker", jobStatus: "waiting_worker", includePending: true });
  state.triggerMode = "folder_button";
  state.workerFrameId = null;
  state.workerRecoveryStartedAt = Date.now() - 6 * 60_000;
  state.workerRecoveryCount = 2;
  state.workerRecoveryPending = false;
  state.workerDeadline = Date.now() - 1;
  state.items[0].status = "success";
  state.activeTransfers = [];
  state.scanQueue = [{ url: state.rootUrl, path: ["未扫描目录"] }];
  const harness = createHarness({ popoSettings: state.settings, popoState: state });
  try {
    harness.fireAlarm("popo-stable-downloader-watchdog");
    await waitUntil(() => harness.stored.popoState?.jobs?.[0]?.status === "failed");
    const saved = harness.stored.popoState;
    assert.equal(saved.jobs[0].counts.success, 1);
    assert.equal(saved.jobs[0].counts.failed, 1);
    assert.equal(saved.jobs[0].counts.scanFailures, 1);
    assert.equal(saved.jobs[0].failureRetryKeys.length, 1);
    assert.equal(saved.logs.find((entry) => entry.code === "WORKER_RECOVERY_PENDING")?.context?.recoveryCount, 3);
    assert.equal(saved.logs.some((entry) => entry.code === "WORKER_RECOVERY_EXHAUSTED"), true);
  } finally {
    harness.cleanup();
  }
});

for (const businessField of ["code", "status"]) {
  test(`POPO 取址 ${businessField} 405 立即标记权限失败且不借页面观察地址继续`, async () => {
  const state = transferState({ includePending: true });
  state.items = [{ ...state.items[1], name: "denied.jpg", itemIndex: "5" }];
  state.activeTransfers = [];
  state.activeItemId = null;
  state.triggerMode = "folder_button";
  state.teamSpaceId = "space-real";
  state.gopeedConnected = true;
  state.gopeedDownloadDir = "D:\\Downloads";
  let currentUrl = state.rootUrl;
  let requestCount = 0;
  let observedCount = 0;
  let sendRuntimeMessage;
  const harness = createHarness({ popoSettings: state.settings, popoState: state }, {
    async listGopeedTasks() { return []; },
    async sendTabMessage(_tabId, message) {
      if (message.type === "NAVIGATE_WORKER") {
        currentUrl = message.url;
        setTimeout(() => {
          void sendRuntimeMessage(
            { type: "REGISTER_WORKER_FRAME", url: message.url },
            { tab: { id: 7, url: message.url }, url: message.url, frameId: 42 }
          );
        }, 0);
        return { ok: true };
      }
      if (message.type === "PING") return { ok: true, result: { url: currentUrl } };
      if (message.type === "OPEN_ITEM") {
        currentUrl = "https://docs.popo.netease.com/team/pc/team1/pageDetail/denied1";
        return { ok: true, result: { clicked: true } };
      }
      if (message.type === "GET_PREVIEW_INFO") return { ok: true, result: {
        titleCandidates: ["denied.jpg"], media: [], downloadButtonCount: 1,
        loadingCount: 0, previewElementCount: 1, pageId: "denied1"
      } };
      if (message.type === "RESOLVE_TEAM_SPACE_ID") return {
        ok: true, result: { ok: true, status: 200, body: { code: 0, data: "space-real" } }
      };
      if (message.type === "REQUEST_DIRECT_DOWNLOAD") {
        requestCount += 1;
        return { ok: true, result: { ok: true, status: 200, body: {
          [businessField]: 405, message: "没有权限操作", data: { url: "https://example.com/should-not-use" }
        } } };
      }
      if (message.type === "GET_OBSERVED_DOWNLOAD_URL") {
        observedCount += 1;
        return { ok: true, result: { url: "https://example.com/should-not-use" } };
      }
      return { ok: true, result: {} };
    }
  });
  sendRuntimeMessage = harness.send;
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    try {
      await waitUntil(() => harness.stored.popoState?.jobs?.[0]?.counts?.failed === 1);
    } catch (error) {
      assert.fail(`${error.message}: ${JSON.stringify({
        mode: harness.stored.popoState?.mode,
        phase: harness.stored.popoState?.phase,
        logs: harness.stored.popoState?.logs?.slice(-3),
        messages: harness.sentTabMessages.map((entry) => entry.message.type)
      })}`);
    }
    assert.equal(requestCount, 1);
    assert.equal(observedCount, 0);
    assert.equal(harness.stored.popoState.jobs[0].failureRetryKeys.length, 1);
    assert.equal(harness.stored.popoState.logs.some((entry) => entry.code === "DOWNLOAD_PERMISSION_DENIED"), true);
    const denial = harness.stored.popoState.logs.find((entry) => entry.code === "DOWNLOAD_PERMISSION_DENIED");
    assert.equal(denial?.context?.businessCode, 405);
    assert.match(denial?.details || "", new RegExp(`${businessField} 405`));
    const diagnostic = harness.stored.popoState.pendingDiagnostics.find(
      (entry) => entry.code === "DOWNLOAD_PERMISSION_DENIED"
    );
    assert.equal(diagnostic?.context?.httpStatus, 200);
    assert.equal(diagnostic?.context?.businessCode, 405);
  } finally {
    harness.cleanup();
  }
  });
}

test("Gopeed 关闭并自动重启后只恢复断线前正在运行的 POPO 任务", async () => {
  const state = transferState({ includePending: true });
  state.settings = {
    ...state.settings,
    concurrency: 2,
    gopeedEndpoint: "http://127.0.0.1:9999"
  };
  state.items[1] = {
    ...state.items[1],
    id: "manual-paused-file",
    name: "manual-paused.mp4",
    status: "paused",
    stage: "已在 Gopeed 暂停",
    attempts: 1,
    gopeedTaskId: "task-manual-paused"
  };
  state.activeTransfers[0].lastObservedStatus = "active";
  state.activeTransfers.push({
    itemId: "manual-paused-file",
    taskId: "task-manual-paused",
    pollFailures: 0,
    lastObservedStatus: "paused",
    externalPaused: true
  });
  let gopeedRestarted = false;
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      async getGopeedTask() {
        if (!gopeedRestarted) throw new Error("连接被拒绝");
        return { status: "pause", progress: { downloaded: 1024, speed: 0 } };
      },
      async getGopeedConfig(settings) {
        if (settings.gopeedEndpoint.endsWith(":9999")) throw new Error("连接被拒绝");
        return { downloadDir: "D:\\Downloads" };
      },
      async sendNativeMessage(_host, message) {
        assert.equal(message.action, "ensure_gopeed");
        assert.equal(message.apiToken, state.settings.gopeedToken || "");
        gopeedRestarted = true;
        return {
          ok: true,
          endpoint: "http://127.0.0.1:32123",
          apiToken: state.settings.gopeedToken || ""
        };
      }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => harness.stored.popoState?.logs?.some((entry) =>
      entry.code === "GOPEED_RESTART_RECOVERY_COMPLETED"
    ));
    assert.deepEqual(harness.continuedGopeedTasks, ["task-active"]);
    assert.equal(harness.stored.popoState.mode, "downloading");
    assert.equal(harness.stored.popoState.gopeedRecoveryPending, false);
    assert.equal(harness.stored.popoState.settings.gopeedEndpoint, "http://127.0.0.1:32123");
    const storedItems = harness.stored["popoItems:job-gopeed-control:0"];
    assert.equal(storedItems.find((item) => item.id === "active-file").status, "transferring");
    assert.equal(storedItems.find((item) => item.id === "manual-paused-file").status, "paused");
  } finally {
    harness.cleanup();
  }
});

test("Gopeed 重启时原本手动暂停的任务保持暂停且网页状态收敛", async () => {
  const state = transferState();
  state.settings = { ...state.settings, gopeedEndpoint: "http://127.0.0.1:9999" };
  state.items[0].status = "paused";
  state.items[0].stage = "已在 Gopeed 暂停";
  state.activeTransfers[0].lastObservedStatus = "paused";
  state.activeTransfers[0].externalPaused = true;
  let gopeedRestarted = false;
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      async getGopeedTask() {
        if (!gopeedRestarted) throw new Error("连接被拒绝");
        return { status: "pause", progress: { downloaded: 1024, speed: 0 } };
      },
      async getGopeedConfig(settings) {
        if (settings.gopeedEndpoint.endsWith(":9999")) throw new Error("连接被拒绝");
        return { downloadDir: "D:\\Downloads" };
      },
      async sendNativeMessage() {
        gopeedRestarted = true;
        return { ok: true, endpoint: "http://127.0.0.1:32123" };
      }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => harness.stored.popoState?.mode === "paused");
    assert.deepEqual(harness.continuedGopeedTasks, []);
    assert.equal(harness.stored.popoState.pauseOrigin, "gopeed_restart");
    assert.equal(harness.stored.popoState.pauseResumeMode, "downloading");
    assert.ok(harness.stored.popoState.logs.some((entry) =>
      entry.code === "GOPEED_RESTART_RECOVERY_BLOCKED"
    ));
  } finally {
    harness.cleanup();
  }
});

test("Gopeed 重启后连续恢复失败会暂停项目并提供继续入口", async () => {
  const state = transferState();
  state.settings = { ...state.settings, gopeedEndpoint: "http://127.0.0.1:9999" };
  state.activeTransfers[0].lastObservedStatus = "active";
  let gopeedRestarted = false;
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      async getGopeedTask() {
        if (!gopeedRestarted) throw new Error("连接被拒绝");
        return { status: "pause", progress: { downloaded: 1024, speed: 0 } };
      },
      async getGopeedConfig(settings) {
        if (settings.gopeedEndpoint.endsWith(":9999")) throw new Error("连接被拒绝");
        return { downloadDir: "D:\\Downloads" };
      },
      async sendNativeMessage() {
        gopeedRestarted = true;
        return { ok: true, endpoint: "http://127.0.0.1:32123" };
      },
      async continueGopeedTask() {
        throw new Error("任务尚未准备好");
      }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => harness.stored.popoState?.activeTransfers?.[0]?.restartResumeFailures === 1);
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => harness.stored.popoState?.activeTransfers?.[0]?.restartResumeFailures === 2);
    harness.fireAlarm("popo-stable-downloader-pump");
    await waitUntil(() => harness.stored.popoState?.mode === "paused");
    assert.equal(harness.stored.popoState.phase, "gopeed_recovery_blocked");
    assert.equal(harness.stored.popoState.pauseOrigin, "gopeed_restart");
    assert.equal(harness.stored["popoItems:job-gopeed-control:0"][0].status, "paused");
  } finally {
    harness.cleanup();
  }
});

test("旧版项目因 Gopeed 手动暂停卡住后会在任务完成时自动接续", async () => {
  const state = transferState({ mode: "paused", jobStatus: "paused", includePending: true });
  state.items[0].status = "paused";
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      async getGopeedTask() {
        return { status: "done", progress: { downloaded: 2048, speed: 0 } };
      }
    }
  );
  try {
    harness.fireAlarm("popo-stable-downloader-watchdog");
    await waitUntil(() => harness.stored.popoState?.mode === "downloading");
    assert.equal(harness.stored.popoState.activeTransfers.length, 0);
    assert.equal(harness.stored["popoItems:job-gopeed-control:0"][0].status, "success");
    assert.ok(harness.stored.popoState.logs.some((entry) =>
      entry.code === "GOPEED_PROJECT_RECONCILED"
    ));
  } finally {
    harness.cleanup();
  }
});

test("POPO 页面暂停具有明确归属且扫描阶段也能暂停后继续", async () => {
  const state = transferState({ mode: "scanning", jobStatus: "scanning" });
  let queriedGopeed = 0;
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      async getGopeedTask() {
        queriedGopeed += 1;
        return { status: "pause", progress: { downloaded: 1024, speed: 0 } };
      }
    }
  );
  try {
    const paused = await harness.send({ type: "PAUSE" });
    assert.equal(paused.ok, true);
    assert.equal(paused.state.mode, "paused");
    assert.equal(paused.state.pauseOrigin, "popo");
    assert.equal(paused.state.pauseResumeMode, "scanning");
    assert.deepEqual(harness.pausedGopeedTasks, ["task-active"]);

    harness.fireAlarm("popo-stable-downloader-watchdog");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(harness.stored.popoState.mode, "paused");
    assert.equal(queriedGopeed, 0);

    const resumed = await harness.send({ type: "RESUME" });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.state.mode, "scanning");
    assert.equal(resumed.state.pauseOrigin, "");
    assert.deepEqual(harness.continuedGopeedTasks, ["task-active"]);
  } finally {
    harness.cleanup();
  }
});

test("网页暂停后若 Gopeed 已手动完成，继续前先对账且不重复恢复", async () => {
  const state = transferState({ mode: "paused", jobStatus: "paused", includePending: true });
  state.pauseOrigin = "popo";
  state.pauseResumeMode = "downloading";
  state.items[0].status = "paused";
  state.items[0].stage = "已暂停";
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      async getGopeedTask() {
        return { status: "done", progress: { downloaded: 2048, speed: 0 } };
      }
    }
  );
  try {
    const response = await harness.send({ type: "RESUME" });
    assert.equal(response.ok, true);
    assert.equal(response.state.mode, "downloading");
    assert.deepEqual(harness.continuedGopeedTasks, []);
    assert.equal(harness.stored.popoState.activeTransfers.length, 0);
    assert.equal(harness.stored["popoItems:job-gopeed-control:0"][0].status, "success");
    assert.equal(harness.stored.popoState.jobs[0].counts.success, 1);
    assert.equal(harness.stored.popoState.jobs[0].counts.failed, 0);
  } finally {
    harness.cleanup();
  }
});

test("停止卡住项目时先核对 Gopeed 完成状态再取消未开始文件", async () => {
  const state = transferState({ mode: "paused", jobStatus: "paused", includePending: true });
  state.items[0].status = "paused";
  const harness = createHarness(
    { popoSettings: state.settings, popoState: state },
    {
      async getGopeedTask() {
        return { status: "done", progress: { downloaded: 2048, speed: 0 } };
      }
    }
  );
  try {
    const response = await harness.send({ type: "CANCEL" });
    assert.equal(response.ok, true);
    const job = harness.stored.popoState.jobs.find((candidate) => candidate.id === "job-gopeed-control");
    assert.equal(job.status, "cancelled");
    assert.equal(job.counts.success, 1);
    assert.equal(job.counts.cancelled, 1);
    assert.equal(harness.stored.popoState.activeJobId, null);
  } finally {
    harness.cleanup();
  }
});
