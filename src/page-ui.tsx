import { createDirectorySkeleton } from "./ui/directory-skeleton";
import { UiActionsProvider } from "./ui/actions";
import { ProjectCount, PageDownloadButton, FolderDownloadButton, QueueDock, ToastViewport } from "./ui/page-components";
import { globalStyles, SHADOW_STYLES } from "./ui/page-styles";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import {
  Check,
  CircleX,
  Clock3,
  Download,
  FileQuestion,
  Folder,
  LoaderCircle,
  Pause,
  Play,
  Search,
  Trash2,
  TriangleAlert,
  type LucideIcon
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  attentionJobs,
  failedRetryCount,
  findPageDownloadBatch,
  findMatchingFolderJob,
  findMatchingFolderReceipt,
  folderReceiptFeedbackRemaining,
  folderButtonDisplay,
  inferVirtualListItemCount,
  jobDetail,
  jobIsActive,
  jobIsTerminal,
  jobName,
  jobProgress,
  liveJobs,
  MODE_LABELS,
  networkHealthSummary,
  networkReminderVisible,
  nextNetworkNotice,
  nextServiceNotice,
  notificationForTransition,
  recoverableCount,
  summarizeLiveJobs,
  userFacingError,
  type QueueJob,
  type QueueState,
  type NetworkNoticeTracker,
  type ServiceNoticeTracker,
  type GopeedConnection,
  type UiNotification
} from "./ui-model";

const SELECTORS = {
  scroller: '[data-test-id="virtuoso-scroller"], [data-virtuoso-scroller="true"]',
  row: "[data-item-index]",
  name: '[class*="topName"]',
  nameHost: '[class*="pageName"]',
  folderIcon: '[class*="drive-icon-folder"]',
  actions: '[class*="listMore"]'
} as const;

const ROOT_ID = "popo-react-page-root";
const GLOBAL_STYLE_ID = "popo-react-page-global-style";
const PROJECT_COUNT_ID = "popo-stable-project-count";
const DIRECTORY_TRANSITION_OVERLAY_ID = "popo-directory-transition-overlay";
const DIRECTORY_TRANSITION_ATTRIBUTE = "data-popo-directory-transition";
const DIRECTORY_POINTER_INTENT_ATTRIBUTE = "data-popo-directory-pointer-intent";
const DOWNLOAD_ANCHOR_CLASS = "popo-react-download-anchor";
const DOWNLOAD_BUTTON_CLASS = "popo-stable-download-button";
const DOWNLOAD_HOST_ATTRIBUTE = "data-popo-download-host";
const OWNED_SELECTOR = [
  "#" + ROOT_ID,
  "#" + GLOBAL_STYLE_ID,
  "#" + PROJECT_COUNT_ID,
  "#" + DIRECTORY_TRANSITION_OVERLAY_ID,
  "." + DOWNLOAD_ANCHOR_CLASS,
  "." + DOWNLOAD_BUTTON_CLASS
].join(",");
const ENSURE_WORKER_EVENT = "popo-stable-download:ensure-worker";
const PAGE_ROUTE_CHANGE_EVENT = "popo-stable-download:page-route-change";
const PAGE_DETAIL_PATTERN = /\/pageDetail\/[a-z0-9]+/i;
const DIRECTORY_CONTENT_SETTLE_MS = 80;
const DIRECTORY_TRANSITION_TIMEOUT_MS = 5000;
const DIRECTORY_POINTER_INTENT_TIMEOUT_MS = 700;

interface FolderItem {
  name: string;
  itemIndex: string;
  parentUrl: string;
}

interface FolderPortalTarget {
  key: string;
  target: HTMLElement;
  item: FolderItem;
}

interface PageSnapshot {
  url: string;
  pageName: string;
  rawCount: number | null;
  countTarget: HTMLElement | null;
  folderTargets: FolderPortalTarget[];
}

interface DirectoryFingerprint {
  pageName: string;
  scroller: HTMLElement | null;
  rows: HTMLElement[];
  scrollerId: number;
  rowSignature: string;
  ready: boolean;
  explicitEmpty: boolean;
  contradictory: boolean;
}

interface ToastRecord extends UiNotification {
  receivedAt: number;
  mergedCount: number;
}

interface PageUiGlobal {
  __POPO_REACT_PAGE_CLEANUP__?: (() => void) | undefined;
}

function normalizeText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function currentDirectoryName(): string {
  const title = normalizeText(document.title);
  if (title && title !== "POPO") return title;
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(
    '[class*="titleInput"], [class*="breadcrumb"]'
  )).map((element) => normalizeText(element.textContent)).filter(Boolean);
  return candidates[candidates.length - 1] || "POPO目录";
}

function isElementRenderable(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.visibility === "collapse" ||
      Number(style.opacity) === 0
    ) return false;
  }
  return true;
}

function isRowRenderable(element: HTMLElement): boolean {
  return element.isConnected && element.offsetParent !== null && element.getClientRects().length > 0;
}

function parseFolderRow(row: Element): FolderItem | null {
  const name = normalizeText(row.querySelector(SELECTORS.name)?.textContent);
  if (!name || !row.querySelector(SELECTORS.folderIcon)) return null;
  const itemIndex = String(
    row.getAttribute("data-item-index") ||
    row.getAttribute("data-index") ||
    ""
  );
  if (!itemIndex) return null;
  return { name, itemIndex, parentUrl: location.href };
}

function directoryScrollers(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(SELECTORS.scroller))
    .filter(isElementRenderable)
    .sort((left, right) => {
      const rowDifference =
        right.querySelectorAll(SELECTORS.row).length -
        left.querySelectorAll(SELECTORS.row).length;
      if (rowDifference) return rowDifference;
      return (right.scrollHeight - right.clientHeight) -
        (left.scrollHeight - left.clientHeight);
    });
}

function currentDirectoryScroller(): HTMLElement | null {
  return directoryScrollers()[0] || null;
}

function hasExplicitEmptyState(): boolean {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(
    '[class*="empty"], [class*="Empty"], [data-testid*="empty"], [data-test-id*="empty"]'
  )).slice(0, 30);
  return candidates.some((element) => {
    const text = normalizeText(element.textContent);
    return element.offsetParent !== null && /暂无|空文件夹|没有文件|无内容|empty/i.test(text);
  });
}

function currentVirtualListItemCount(
  scroller: HTMLElement | null = currentDirectoryScroller(),
  rows = Array.from(scroller?.querySelectorAll<HTMLElement>(SELECTORS.row) || [])
    .filter(isRowRenderable)
): number | null {
  const explicitEmpty = hasExplicitEmptyState();
  if (explicitEmpty && rows.length) return null;
  if (explicitEmpty) return 0;
  if (!scroller) return null;
  const itemList = scroller.querySelector<HTMLElement>('[data-test-id="virtuoso-item-list"]');
  if (!rows.length || !itemList) return null;
  return inferVirtualListItemCount({
    indices: rows.map((row) =>
      row.getAttribute("data-item-index") || row.getAttribute("data-index")
    ),
    knownSizes: rows.map((row) => row.getAttribute("data-known-size")),
    paddingBottom: getComputedStyle(itemList).paddingBottom,
    explicitEmpty: false
  });
}

function projectCountPlacement(): { host: HTMLElement; leftControl: HTMLElement } | null {
  const label = Array.from(document.querySelectorAll<HTMLElement>("span"))
    .find((element) => normalizeText(element.textContent) === "所有类型");
  const leftControl = label?.parentElement;
  const host = leftControl?.parentElement;
  if (!host || !leftControl || !host.contains(leftControl)) return null;
  return { host, leftControl };
}

function ensureProjectCountTarget(): HTMLElement | null {
  if (!PAGE_DETAIL_PATTERN.test(location.href)) {
    document.getElementById(PROJECT_COUNT_ID)?.remove();
    return null;
  }
  const placement = projectCountPlacement();
  if (!placement) {
    document.getElementById(PROJECT_COUNT_ID)?.remove();
    return null;
  }
  let target = document.getElementById(PROJECT_COUNT_ID);
  if (!target) {
    target = document.createElement("span");
    target.id = PROJECT_COUNT_ID;
  }
  target.dataset.popoReactOwned = "true";
  target.setAttribute("aria-live", "polite");
  if (
    target.parentElement !== placement.host ||
    target.previousElementSibling !== placement.leftControl
  ) {
    placement.host.insertBefore(target, placement.leftControl.nextSibling);
  }
  return target;
}

function clearFolderTargets(): void {
  for (const anchor of document.querySelectorAll("." + DOWNLOAD_ANCHOR_CLASS)) anchor.remove();
  for (const host of document.querySelectorAll(`[${DOWNLOAD_HOST_ATTRIBUTE}]`)) {
    host.removeAttribute(DOWNLOAD_HOST_ATTRIBUTE);
  }
}

function clearDirectoryTransitionOverlay(): void {
  document.documentElement.removeAttribute(DIRECTORY_TRANSITION_ATTRIBUTE);
  document.getElementById(DIRECTORY_TRANSITION_OVERLAY_ID)?.remove();
}

function setDirectoryPointerIntent(active: boolean): void {
  if (active) document.documentElement.setAttribute(DIRECTORY_POINTER_INTENT_ATTRIBUTE, "true");
  else document.documentElement.removeAttribute(DIRECTORY_POINTER_INTENT_ATTRIBUTE);
}

function ensureDirectoryTransitionOverlay(
  expectedName = "",
  blockInteraction = false
): HTMLElement | null {
  if (!PAGE_DETAIL_PATTERN.test(location.href)) {
    clearDirectoryTransitionOverlay();
    return null;
  }
  document.documentElement.setAttribute(DIRECTORY_TRANSITION_ATTRIBUTE, "true");
  let overlay = document.getElementById(DIRECTORY_TRANSITION_OVERLAY_ID);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = DIRECTORY_TRANSITION_OVERLAY_ID;
    overlay.dataset.popoReactOwned = "true";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.setAttribute("aria-busy", "true");

    const shell = createDirectorySkeleton();
    overlay.append(shell);
    (document.body || document.documentElement).append(overlay);
  }
  if (blockInteraction) overlay.dataset.blockInteraction = "true";
  else if (!overlay.dataset.blockInteraction) overlay.dataset.blockInteraction = "false";
  const label = overlay.querySelector<HTMLElement>(".popo-directory-transition-label");
  if (label) {
    const target = normalizeText(expectedName);
    label.textContent = target ? `正在打开“${target}”…` : "正在加载目录…";
  }
  return overlay;
}

function ensureFolderTargets(
  scroller: HTMLElement | null = currentDirectoryScroller(),
  rows = Array.from(scroller?.querySelectorAll<HTMLElement>(SELECTORS.row) || [])
): FolderPortalTarget[] {
  const activeAnchors = new Set<HTMLElement>();
  const activeHosts = new Set<HTMLElement>();
  const targets: FolderPortalTarget[] = [];
  for (const row of rows) {
    const item = parseFolderRow(row);
    const existing = row.querySelector<HTMLElement>("." + DOWNLOAD_ANCHOR_CLASS);
    if (!item || !isRowRenderable(row)) {
      existing?.remove();
      for (const host of row.querySelectorAll<HTMLElement>(`[${DOWNLOAD_HOST_ATTRIBUTE}]`)) {
        host.removeAttribute(DOWNLOAD_HOST_ATTRIBUTE);
      }
      continue;
    }
    const nameNode = row.querySelector<HTMLElement>(SELECTORS.name);
    const nameHost = row.querySelector<HTMLElement>(SELECTORS.nameHost) || nameNode?.parentElement;
    if (!nameNode || !nameHost || !isRowRenderable(nameNode) || !isRowRenderable(nameHost)) {
      existing?.remove();
      continue;
    }
    let anchor = existing;
    if (!anchor) {
      anchor = document.createElement("span");
      anchor.className = DOWNLOAD_ANCHOR_CLASS;
    }
    anchor.dataset.popoReactOwned = "true";
    nameHost.setAttribute(DOWNLOAD_HOST_ATTRIBUTE, "true");
    if (anchor.parentElement !== nameHost || anchor !== nameHost.lastElementChild) {
      nameHost.append(anchor);
    }
    const key = [item.parentUrl, item.itemIndex, item.name].join("\u0000");
    anchor.dataset.popoKey = key;
    activeAnchors.add(anchor);
    activeHosts.add(nameHost);
    targets.push({ key, target: anchor, item });
  }
  for (const anchor of document.querySelectorAll<HTMLElement>("." + DOWNLOAD_ANCHOR_CLASS)) {
    if (!activeAnchors.has(anchor)) anchor.remove();
  }
  for (const host of document.querySelectorAll<HTMLElement>(`[${DOWNLOAD_HOST_ATTRIBUTE}]`)) {
    if (!activeHosts.has(host)) host.removeAttribute(DOWNLOAD_HOST_ATTRIBUTE);
  }
  return targets;
}

function elementForNode(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE
    ? node as Element
    : node.parentElement;
}

function isOwnedNode(node: Node): boolean {
  const element = elementForNode(node);
  if (!element) return false;
  return element.matches(OWNED_SELECTOR) || Boolean(element.closest(OWNED_SELECTOR));
}

function mutationNeedsReconcile(mutation: MutationRecord): boolean {
  if (isOwnedNode(mutation.target)) return false;
  const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
  return nodes.length === 0 || !nodes.every(isOwnedNode);
}

function createDirectoryFingerprintReader(): () => DirectoryFingerprint {
  const scrollerIds = new WeakMap<HTMLElement, number>();
  let nextScrollerId = 1;
  return () => {
    const pageName = currentDirectoryName();
    const rawExplicitEmpty = hasExplicitEmptyState();
    const scroller = currentDirectoryScroller();
    if (!scroller) {
      return {
        pageName,
        scroller: null,
        rows: [],
        scrollerId: 0,
        rowSignature: "",
        ready: rawExplicitEmpty,
        explicitEmpty: rawExplicitEmpty,
        contradictory: false
      };
    }
    let scrollerId = scrollerIds.get(scroller);
    if (!scrollerId) {
      scrollerId = nextScrollerId;
      nextScrollerId += 1;
      scrollerIds.set(scroller, scrollerId);
    }
    const renderedRows = Array.from(scroller.querySelectorAll<HTMLElement>(SELECTORS.row))
      .filter(isRowRenderable);
    const itemList = scroller.querySelector<HTMLElement>('[data-test-id="virtuoso-item-list"]');
    const nativeRows = renderedRows.filter((row) =>
      normalizeText(row.querySelector(SELECTORS.name)?.textContent)
    );
    const rowSignature = nativeRows.map((row) => {
      const itemIndex = row.getAttribute("data-item-index") || row.getAttribute("data-index") || "";
      const name = normalizeText(row.querySelector(SELECTORS.name)?.textContent);
      const type = row.querySelector(SELECTORS.folderIcon) ? "folder" : "file";
      return `${itemIndex}:${type}:${name}`;
    }).join("\u001e");
    const hasRows = Boolean(itemList && nativeRows.length && rowSignature);
    const contradictory = rawExplicitEmpty && hasRows;
    return {
      pageName,
      scroller,
      rows: nativeRows,
      scrollerId,
      rowSignature,
      ready: !contradictory && (rawExplicitEmpty || hasRows),
      explicitEmpty: rawExplicitEmpty && !hasRows,
      contradictory
    };
  };
}

function createPageDomAdapter(onSnapshot: (snapshot: PageSnapshot) => void): () => void {
  let frame = 0;
  let disposed = false;
  let observedUrl = location.href;
  let routeReady = false;
  let acceptedFingerprint: DirectoryFingerprint | null = null;
  let transitionBaseline: DirectoryFingerprint | null = null;
  let expectedPageName = "";
  let transitionStartedAt = 0;
  let candidateSignature = "";
  let candidateSince = 0;
  let candidateRounds = 0;
  let settleTimer = 0;
  let pointerIntentTimer = 0;
  const readFingerprint = createDirectoryFingerprintReader();

  const clearSettleTimer = () => {
    if (!settleTimer) return;
    window.clearTimeout(settleTimer);
    settleTimer = 0;
  };

  const clearPointerIntent = () => {
    if (pointerIntentTimer) {
      window.clearTimeout(pointerIntentTimer);
      pointerIntentTimer = 0;
    }
    setDirectoryPointerIntent(false);
  };

  const armPointerIntent = () => {
    clearPointerIntent();
    setDirectoryPointerIntent(true);
    pointerIntentTimer = window.setTimeout(() => {
      pointerIntentTimer = 0;
      setDirectoryPointerIntent(false);
    }, DIRECTORY_POINTER_INTENT_TIMEOUT_MS);
  };

  const beginRouteTransition = (
    nextUrl = location.href,
    expectedName = "",
    showOverlay = true,
    blockInteraction = false
  ) => {
    clearPointerIntent();
    observedUrl = nextUrl;
    routeReady = false;
    transitionBaseline = acceptedFingerprint;
    expectedPageName = normalizeText(expectedName) || expectedPageName;
    transitionStartedAt = Date.now();
    candidateSignature = "";
    candidateSince = 0;
    candidateRounds = 0;
    clearSettleTimer();
    document.getElementById(PROJECT_COUNT_ID)?.remove();
    clearFolderTargets();
    if (showOverlay) ensureDirectoryTransitionOverlay(expectedPageName, blockInteraction);
    onSnapshot({
      url: nextUrl,
      pageName: currentDirectoryName(),
      rawCount: null,
      countTarget: null,
      folderTargets: []
    });
  };

  const reconcile = () => {
    frame = 0;
    if (disposed) return;
    if (observedUrl !== location.href) {
      beginRouteTransition(location.href, expectedPageName, true, true);
    }
    const isDirectoryPage = PAGE_DETAIL_PATTERN.test(location.href);
    const fingerprint = readFingerprint();
    if (
      routeReady &&
      acceptedFingerprint &&
      fingerprint.pageName !== acceptedFingerprint.pageName
    ) {
      beginRouteTransition(location.href, fingerprint.pageName, true, true);
    }
    if (routeReady && (!fingerprint.ready || fingerprint.contradictory)) {
      routeReady = false;
      // The current route was already accepted once. POPO can briefly hide or
      // remount that same list after the first paint, so allow the identical
      // native rows to settle again instead of leaving controls removed forever.
      transitionBaseline = null;
      candidateSignature = "";
      candidateSince = 0;
      candidateRounds = 0;
      clearSettleTimer();
      transitionStartedAt = Date.now();
      ensureDirectoryTransitionOverlay(fingerprint.pageName, true);
    }
    if (routeReady && fingerprint.ready && !fingerprint.contradictory) {
      acceptedFingerprint = fingerprint;
    }
    if (isDirectoryPage && !routeReady) {
      const expectedPageReached = !expectedPageName ||
        fingerprint.pageName === expectedPageName ||
        fingerprint.pageName.includes(expectedPageName);
      const baselineChanged = !transitionBaseline || (
        fingerprint.explicitEmpty
          ? fingerprint.pageName !== transitionBaseline.pageName
          : fingerprint.rowSignature !== transitionBaseline.rowSignature && (
              fingerprint.pageName !== transitionBaseline.pageName ||
              fingerprint.scrollerId !== transitionBaseline.scrollerId
            )
      );
      const signature = [
        location.href,
        fingerprint.pageName,
        fingerprint.scrollerId,
        fingerprint.rowSignature,
        fingerprint.explicitEmpty ? "empty" : "rows"
      ].join("\u0000");
      if (fingerprint.ready && baselineChanged && expectedPageReached) {
        if (candidateSignature !== signature) {
          candidateSignature = signature;
          candidateSince = Date.now();
          candidateRounds = 1;
          clearSettleTimer();
          settleTimer = window.setTimeout(() => {
            settleTimer = 0;
            schedule();
          }, DIRECTORY_CONTENT_SETTLE_MS + 1);
        } else {
          candidateRounds += 1;
        }
        if (candidateRounds >= 2 && Date.now() - candidateSince >= DIRECTORY_CONTENT_SETTLE_MS) {
          routeReady = true;
          acceptedFingerprint = fingerprint;
          expectedPageName = "";
          transitionStartedAt = 0;
          clearSettleTimer();
          clearDirectoryTransitionOverlay();
        }
      } else {
        candidateSignature = "";
        candidateSince = 0;
        candidateRounds = 0;
        clearSettleTimer();
      }
      if (
        expectedPageName &&
        transitionBaseline &&
        Date.now() - transitionStartedAt >= 5000 &&
        fingerprint.ready &&
        fingerprint.pageName === transitionBaseline.pageName &&
        fingerprint.rowSignature === transitionBaseline.rowSignature
      ) {
        expectedPageName = "";
        transitionBaseline = null;
        transitionStartedAt = 0;
        clearDirectoryTransitionOverlay();
        schedule();
      }
      if (
        transitionStartedAt &&
        Date.now() - transitionStartedAt >= DIRECTORY_TRANSITION_TIMEOUT_MS
      ) {
        expectedPageName = "";
        transitionBaseline = null;
        candidateSignature = "";
        candidateSince = 0;
        candidateRounds = 0;
        clearSettleTimer();
        clearDirectoryTransitionOverlay();
        transitionStartedAt = 0;
        schedule();
      }
    }
    if (!isDirectoryPage) clearDirectoryTransitionOverlay();
    const rawCount = isDirectoryPage && routeReady
      ? currentVirtualListItemCount(fingerprint.scroller, fingerprint.rows)
      : null;
    if (routeReady && rawCount == null) {
      routeReady = false;
      transitionBaseline = null;
      transitionStartedAt = Date.now();
      ensureDirectoryTransitionOverlay(fingerprint.pageName, true);
    }
    const countTarget = isDirectoryPage && routeReady && rawCount != null
      ? ensureProjectCountTarget()
      : null;
    if (!countTarget) document.getElementById(PROJECT_COUNT_ID)?.remove();
    let folderTargets: FolderPortalTarget[] = [];
    if (isDirectoryPage && countTarget && routeReady && !fingerprint.explicitEmpty) {
      folderTargets = ensureFolderTargets(fingerprint.scroller, fingerprint.rows);
    }
    else clearFolderTargets();
    onSnapshot({
      url: location.href,
      pageName: fingerprint.pageName,
      rawCount: routeReady ? rawCount : null,
      countTarget,
      // POPO switches the URL before its directory toolbar and list finish
      // mounting. Do not portal buttons into stale virtual rows during that gap.
      folderTargets
    });
  };

  const schedule = () => {
    if (disposed || frame) return;
    frame = requestAnimationFrame(reconcile);
  };

  const observer = new MutationObserver((mutations) => {
    if (!mutations.some(mutationNeedsReconcile)) return;
    if (routeReady) {
      const fingerprint = readFingerprint();
      const acceptedPageChanged = acceptedFingerprint &&
        fingerprint.pageName !== acceptedFingerprint.pageName;
      if (
        observedUrl !== location.href ||
        !fingerprint.ready ||
        fingerprint.contradictory ||
        acceptedPageChanged
      ) {
        beginRouteTransition(
          location.href,
          expectedPageName || fingerprint.pageName,
          true,
          true
        );
      }
    }
    schedule();
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "data-index", "data-item-index"],
    childList: true,
    characterData: true,
    subtree: true
  });
  const timer = window.setInterval(schedule, 350);
  const handleRouteChange = () => {
    beginRouteTransition(location.href, expectedPageName, true, true);
    schedule();
  };
  const directoryItemFromPointer = (event: MouseEvent) => {
    if (
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    ) return null;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(OWNED_SELECTOR)) return null;
    const nameHost = target.closest(SELECTORS.nameHost);
    const row = nameHost?.closest(SELECTORS.row);
    return row ? parseFolderRow(row) : null;
  };
  const handleDirectoryDoubleClick = (event: MouseEvent) => {
    const item = directoryItemFromPointer(event);
    if (!item) return;
    // POPO opens folders on a native double click. Keep the first two pointer
    // sequences click-through, then block further input once dblclick itself
    // already targets the native row and can finish bubbling to POPO.
    beginRouteTransition(location.href, item.name, true, true);
    schedule();
  };
  const handleDirectoryPointerDown = (event: PointerEvent) => {
    if (directoryItemFromPointer(event)) armPointerIntent();
  };
  window.addEventListener(PAGE_ROUTE_CHANGE_EVENT, handleRouteChange);
  window.addEventListener("popstate", handleRouteChange);
  window.addEventListener("hashchange", schedule);
  document.addEventListener("pointerdown", handleDirectoryPointerDown, true);
  document.addEventListener("dblclick", handleDirectoryDoubleClick, true);
  beginRouteTransition(location.href, "", false);
  schedule();

  return () => {
    disposed = true;
    observer.disconnect();
    window.clearInterval(timer);
    clearSettleTimer();
    clearPointerIntent();
    window.removeEventListener(PAGE_ROUTE_CHANGE_EVENT, handleRouteChange);
    window.removeEventListener("popstate", handleRouteChange);
    window.removeEventListener("hashchange", schedule);
    document.removeEventListener("pointerdown", handleDirectoryPointerDown, true);
    document.removeEventListener("dblclick", handleDirectoryDoubleClick, true);
    if (frame) cancelAnimationFrame(frame);
    document.getElementById(PROJECT_COUNT_ID)?.remove();
    clearFolderTargets();
    clearDirectoryTransitionOverlay();
  };
}

function cleanupLegacyUi(): void {
  document.getElementById("popo-stable-download-style")?.remove();
  document.getElementById("popo-stable-download-status")?.remove();
  document.getElementById("popo-stable-download-queue")?.remove();
  document.getElementById(PROJECT_COUNT_ID)?.remove();
  for (const button of document.querySelectorAll("." + DOWNLOAD_BUTTON_CLASS)) button.remove();
  for (const anchor of document.querySelectorAll("." + DOWNLOAD_ANCHOR_CLASS)) anchor.remove();
}

function removeRecreatedLegacyUi(): void {
  document.getElementById("popo-stable-download-style")?.remove();
  document.getElementById("popo-stable-download-status")?.remove();
  document.getElementById("popo-stable-download-queue")?.remove();
  for (const button of document.querySelectorAll<HTMLElement>(
    "." + DOWNLOAD_BUTTON_CLASS + ":not([data-popo-react-owned='true'])"
  )) {
    button.remove();
  }
}

function observeLegacyUi(): () => void {
  removeRecreatedLegacyUi();
  const observer = new MutationObserver((mutations) => {
    const legacyAdded = mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) => {
      if (!(node instanceof Element)) return false;
      return node.matches(
        "#popo-stable-download-status,#popo-stable-download-queue,#popo-stable-download-style," +
        "." + DOWNLOAD_BUTTON_CLASS + ":not([data-popo-react-owned='true'])"
      ) || Boolean(node.querySelector(
        "#popo-stable-download-status,#popo-stable-download-queue,#popo-stable-download-style," +
        "." + DOWNLOAD_BUTTON_CLASS + ":not([data-popo-react-owned='true'])"
      ));
    }));
    if (legacyAdded) removeRecreatedLegacyUi();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  return () => observer.disconnect();
}

function ensureGlobalStyle(): HTMLStyleElement {
  document.getElementById(GLOBAL_STYLE_ID)?.remove();
  const style = document.createElement("style");
  style.id = GLOBAL_STYLE_ID;
  style.dataset.popoReactOwned = "true";
  style.textContent = globalStyles();
  (document.head || document.documentElement).appendChild(style);
  return style;
}

async function callExtension<T extends object = Record<string, never>>(
  message: Record<string, unknown>
): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as T & {
    ok?: boolean;
    error?: string;
  };
  if (!response?.ok) throw new Error(response?.error || "扩展后台未响应");
  return response;
}

function usePageSnapshot(): PageSnapshot {
  const [snapshot, setSnapshot] = useState<PageSnapshot>({
    url: location.href,
    pageName: currentDirectoryName(),
    rawCount: null,
    countTarget: null,
    folderTargets: []
  });
  useEffect(() => createPageDomAdapter((next) => {
    setSnapshot((current) => {
      const sameTargets = current.folderTargets.length === next.folderTargets.length &&
        current.folderTargets.every((entry, index) => {
          const candidate = next.folderTargets[index];
          return candidate?.key === entry.key && candidate.target === entry.target;
        });
      return current.url === next.url &&
        current.pageName === next.pageName &&
        current.rawCount === next.rawCount &&
        current.countTarget === next.countTarget &&
        sameTargets
        ? current
        : next;
    });
  }), []);
  return snapshot;
}

function useExtensionState(onNotification: (notification: UiNotification) => void): {
  state: QueueState | null;
  refresh: () => Promise<void>;
} {
  const [state, setState] = useState<QueueState | null>(null);
  const statuses = useRef(new Map<string, QueueJob["status"]>());
  const initialized = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const response = await callExtension<{ state: QueueState }>({ type: "GET_STATE" });
      const nextState = response.state || { jobs: [] };
      if (initialized.current && !nextState.popupOpen) {
        for (const job of nextState.jobs || []) {
          const notification = notificationForTransition(statuses.current.get(job.id) || null, job);
          if (notification) onNotification(notification);
        }
      }
      statuses.current = new Map((nextState.jobs || []).map((job) => [job.id, job.status]));
      initialized.current = true;
      setState(nextState);
    } catch {
      // Extension reloads can briefly interrupt the content-script connection.
    }
  }, [onNotification]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 1000);
    const listener = (message: unknown) => {
      const type = String((message as { type?: unknown })?.type || "");
      if (type.startsWith("FOLDER_TASK_") || type === "POPUP_VISIBILITY_CHANGED") {
        window.setTimeout(() => void refresh(), 0);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      window.clearInterval(timer);
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [refresh]);

  return { state, refresh };
}

function useToasts(): {
  toasts: ToastRecord[];
  pushToast: (notification: UiNotification) => void;
  dismissToast: (id: string) => void;
} {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const pushToast = useCallback((notification: UiNotification) => {
    const now = Date.now();
    setToasts((current) => {
      if (current.some((toast) => toast.id === notification.id)) return current;
      const last = current.at(-1);
      if (
        notification.kind === "success" &&
        last?.kind === "success" &&
        now - last.receivedAt < 1200
      ) {
        const mergedCount = last.mergedCount + 1;
        const merged: ToastRecord = {
          ...last,
          id: last.id + "|" + notification.id,
          title: "多个下载任务已完成",
          message: mergedCount + " 个文件夹下载完成",
          receivedAt: now,
          mergedCount
        };
        return [...current.slice(0, -1), merged];
      }
      return [...current, { ...notification, receivedAt: now, mergedCount: 1 }].slice(-3);
    });
  }, []);
  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  return { toasts, pushToast, dismissToast };
}

function useDownloadServiceNotifications(
  onNotification: (notification: UiNotification) => void,
  suppressed: boolean,
  enabled: boolean
): void {
  const tracker = useRef<ServiceNoticeTracker>({
    connected: null,
    outageSequence: 0,
    outageNotified: false
  });
  const suppressedRef = useRef(suppressed);

  useEffect(() => {
    suppressedRef.current = suppressed;
  }, [suppressed]);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const check = async () => {
      let connected: boolean;
      try {
        const response = await callExtension<{ connection: GopeedConnection }>({
          type: "CHECK_GOPEED"
        });
        connected = Boolean(response.connection?.connected);
      } catch {
        return;
      }
      if (disposed) return;
      const result = nextServiceNotice(tracker.current, connected, suppressedRef.current);
      tracker.current = result.tracker;
      if (result.notification) onNotification(result.notification);
    };
    void check();
    const timer = window.setInterval(check, 5000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [enabled, onNotification]);
}

function useNetworkNotifications(
  state: QueueState | null,
  onNotification: (notification: UiNotification) => void,
  suppressed: boolean
): void {
  const tracker = useRef<NetworkNoticeTracker>({
    peakNoticeSequence: 0,
    noticeSequence: 0
  });

  useEffect(() => {
    const result = nextNetworkNotice(tracker.current, state?.networkHealth, suppressed);
    tracker.current = result.tracker;
    if (!result.notification) return;
    const storageKey = `popo-network-notice:${result.notification.id}`;
    try {
      if (window.sessionStorage.getItem(storageKey)) return;
      window.sessionStorage.setItem(storageKey, "1");
    } catch {
      // Session storage can be blocked by page policy; in-memory tracking still de-duplicates.
    }
    onNotification(result.notification);
  }, [onNotification, state?.networkHealth, suppressed]);
}

function PageEnhancerApp() {
  const snapshot = usePageSnapshot();
  const count = snapshot.rawCount;
  const { toasts, pushToast, dismissToast } = useToasts();
  const { state, refresh } = useExtensionState(pushToast);
  const [expanded, setExpanded] = useState(false);
  const [focusedJobId, setFocusedJobId] = useState<string | null>(null);
  const popupOpen = Boolean(state?.popupOpen);

  useDownloadServiceNotifications(pushToast, popupOpen, state != null);
  useNetworkNotifications(state, pushToast, popupOpen);

  useEffect(() => {
    if (popupOpen) setExpanded(false);
  }, [popupOpen]);

  const inspectJob = useCallback((jobId: string) => {
    setFocusedJobId(jobId);
    setExpanded(true);
  }, []);

  const showActionError = useCallback((title: string, error: unknown) => {
    pushToast({
      id: "action-error:" + title + ":" + Date.now(),
      jobId: "",
      kind: "error",
      title,
      message: userFacingError(error),
      timeoutMs: null
    });
  }, [pushToast]);

  const snoozeNetworkReminder = useCallback(async () => {
    try {
      await callExtension({ type: "SNOOZE_NETWORK_REMINDER" });
      await refresh();
    } catch (error) {
      showActionError("网络提醒", error);
      throw error;
    }
  }, [refresh, showActionError]);

  const portals = useMemo<ReactNode[]>(() => {
    const values: ReactNode[] = [];
    if (snapshot.countTarget) {
      values.push(createPortal(
        <>
          <ProjectCount count={count} />
          <PageDownloadButton
            pageName={snapshot.pageName}
            parentUrl={snapshot.url}
            count={count}
            state={state}
            refresh={refresh}
            onError={showActionError}
          />
        </>,
        snapshot.countTarget,
        "project-count"
      ));
    }
    for (const entry of snapshot.folderTargets) {
      values.push(createPortal(
        <FolderDownloadButton
          item={entry.item}
          state={state}
          refresh={refresh}
          onInspect={inspectJob}
          onError={showActionError}
        />,
        entry.target,
        entry.key
      ));
    }
    return values;
  }, [
    count,
    inspectJob,
    refresh,
    showActionError,
    state,
    snapshot.countTarget,
    snapshot.folderTargets,
    snapshot.pageName,
    snapshot.url
  ]);

  return (
    <>
      {portals}
      <QueueDock
        state={state}
        expanded={popupOpen ? false : expanded}
        focusedJobId={focusedJobId}
        onExpandedChange={setExpanded}
        onAction={refresh}
        onError={showActionError}
      />
      <ToastViewport
        toasts={popupOpen ? [] : toasts}
        onDismiss={dismissToast}
        onInspect={inspectJob}
        onNetworkSnooze={snoozeNetworkReminder}
      />
    </>
  );
}

function mountPageUi(): () => void {
  cleanupLegacyUi();
  const stopLegacyGuard = observeLegacyUi();
  const globalStyle = ensureGlobalStyle();
  document.getElementById(ROOT_ID)?.remove();
  const host = document.createElement("div");
  host.id = ROOT_ID;
  host.dataset.popoReactOwned = "true";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = SHADOW_STYLES;
  const mount = document.createElement("div");
  mount.id = "popo-react-page-app";
  shadow.append(style, mount);
  document.documentElement.appendChild(host);
  const root: Root = createRoot(mount);
  root.render(
    <UiActionsProvider value={{ send: callExtension, currentPopoTabId: async () => null, copyText: (text) => navigator.clipboard.writeText(text), ensureWorker: (url) => document.dispatchEvent(new CustomEvent(ENSURE_WORKER_EVENT, { detail: { url } })) }}>
      <PageEnhancerApp />
    </UiActionsProvider>
  );
  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    stopLegacyGuard();
    root.unmount();
    host.remove();
    globalStyle.remove();
    document.getElementById(PROJECT_COUNT_ID)?.remove();
    for (const anchor of document.querySelectorAll("." + DOWNLOAD_ANCHOR_CLASS)) anchor.remove();
  };
}

if (window.top === window) {
  const pageGlobal = globalThis as typeof globalThis & PageUiGlobal;
  pageGlobal.__POPO_REACT_PAGE_CLEANUP__?.();
  const cleanup = mountPageUi();
  pageGlobal.__POPO_REACT_PAGE_CLEANUP__ = cleanup;
  window.addEventListener("pagehide", cleanup, { once: true });
}
