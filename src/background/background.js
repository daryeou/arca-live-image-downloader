importScripts('../shared/media-utils.js', 'twitter-api.js');

const {
  sanitizePathSegment,
  normalizeSuggestedBasename,
  getUrlFilename,
  extractTweetId,
  selectTwitterVideoSource
} = globalThis.ArcaDLShared;
const TwitterApi = globalThis.ArcaDLTwitterApi;
const STORAGE_KEY = 'downloadState';
const FAILURE_HISTORY_KEY = 'downloadFailureHistory';
const AUTO_HIDE_MS = 3000;
const FAILURE_HISTORY_LIMIT = 50;
// Optional raw gist URL. When empty, the bundled JSON config is used.
// Keep this fixed in the deployed extension. Update the gist contents instead of exposing UI.
const DEFAULT_SITE_CONFIG_REMOTE_URL = '';
const SITE_CONFIG_BUNDLE_PATH = 'config/site-config.default.json';
const SITE_CONFIG_SESSION_KEY = 'siteConfigPayload';
const EXTENSION_VERSION = chrome.runtime.getManifest().version;
const CONTENT_TAB_URLS = [
  'https://arca.live/*',
  'https://x.com/*',
  'https://twitter.com/*'
];
let queue = [];
let activeDownloads = new Map();
let processingQueue = false;
let pendingProcess = false;
let queueSet = new Set(); // 以묐났 諛⑹?瑜??꾪븳 Set
let nextQueueStartAt = 0;
let queueStartDelayTimer = null;
let retryTimer = null;
const RETRY_ALARM_NAME = 'downloadRetryWakeup';
const RETRY_ALARM_MIN_DELAY_MS = 30 * 1000;

const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 60 * 1000;
const RETRY_MAX_COUNT = 2;

let siteConfigCache = null;
let siteConfigPromise = null;
function normalizeSiteConfigPayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.sites)) {
    throw new Error('invalid-site-config');
  }

  return {
    version: Number.isFinite(payload.version) ? payload.version : 1,
    sites: payload.sites.filter((site) =>
      site &&
      typeof site.id === 'string' &&
      Array.isArray(site.hosts) &&
      site.hosts.every((host) => typeof host === 'string')
    ).map((site) => ({ ...site }))
  };
}

async function resolveTwitterVideoDownload(rawItem) {
  const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
  const tweetId = extractTweetId(item.statusPath || item.tweetUrl || item.url || '');
  if (!tweetId) {
    throw new Error('twitter-tweet-id-not-found');
  }

  const source = selectTwitterVideoSource(await TwitterApi.fetchTweetDetails(tweetId, {
    mainJsUrl: item.mainJsUrl || ''
  }), item.videoId);
  if (!source) {
    throw new Error('twitter-video-source-not-found');
  }

  return {
    url: source.url,
    previewUrl: item.previewUrl || source.previewUrl || source.url,
    type: item.type === 'gif' || source.mediaType === 'gif' ? 'gif' : 'video',
    folderTitle: sanitizePathSegment(item.folderTitle, ''),
    pageUrl: typeof item.pageUrl === 'string' ? item.pageUrl : '',
    pageTitle: normalizePageTitle(item.pageTitle, item.folderTitle || ''),
    sourceIndex: Number.isInteger(item.sourceIndex) ? item.sourceIndex : 0,
    downloadBasename: getUrlFilename(source.url, item.downloadBasename || `tweet_video_${tweetId}.mp4`),
    createFolder: typeof item.createFolder === 'boolean' ? item.createFolder : true,
    prefixOrderInFolder: item.prefixOrderInFolder === true,
    downloadParallelism: item.downloadParallelism,
    interDownloadDelayMs: item.interDownloadDelayMs
  };
}
function mergeSiteConfigPayload(basePayload, overridePayload) {
  const mergedById = new Map();
  const orderedIds = [];

  basePayload.sites.forEach((site) => {
    orderedIds.push(site.id);
    mergedById.set(site.id, site);
  });

  overridePayload.sites.forEach((site) => {
    if (!mergedById.has(site.id)) {
      orderedIds.push(site.id);
    }

    mergedById.set(site.id, site);
  });

  return {
    version: Math.max(basePayload.version, overridePayload.version),
    sites: orderedIds
      .map((siteId) => mergedById.get(siteId))
      .filter(Boolean)
  };
}

async function loadBundledSiteConfig() {
  const response = await fetch(chrome.runtime.getURL(SITE_CONFIG_BUNDLE_PATH));

  if (!response.ok) {
    throw new Error(`site-config-bundle-${response.status}`);
  }

  return normalizeSiteConfigPayload(await response.json());
}

async function loadRemoteSiteConfig(url) {
  const response = await fetch(url, { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`site-config-remote-${response.status}`);
  }

  return normalizeSiteConfigPayload(await response.json());
}

async function loadSessionCachedSiteConfig(remoteUrl = '') {
  try {
    const stored = await chrome.storage.session.get(SITE_CONFIG_SESSION_KEY);
    const cached = stored?.[SITE_CONFIG_SESSION_KEY];
    if (!cached || typeof cached !== 'object') {
      return null;
    }

    if (String(cached.version || '') !== EXTENSION_VERSION) {
      return null;
    }

    if (String(cached.remoteUrl || '') !== String(remoteUrl || '')) {
      return null;
    }

    return normalizeSiteConfigPayload(cached.payload);
  } catch {
    return null;
  }
}

async function persistSessionCachedSiteConfig(payload, remoteUrl = '') {
  try {
    await chrome.storage.session.set({
      [SITE_CONFIG_SESSION_KEY]: {
        version: EXTENSION_VERSION,
        remoteUrl: String(remoteUrl || ''),
        payload
      }
    });
  } catch {
    // Ignore session cache failures and keep the in-memory cache only.
  }
}

async function getSiteConfigPayload(forceRefresh = false) {
  if (!forceRefresh && siteConfigCache) {
    return siteConfigCache;
  }

  if (!forceRefresh && siteConfigPromise) {
    return siteConfigPromise;
  }

  siteConfigPromise = (async () => {
    const remoteUrl = DEFAULT_SITE_CONFIG_REMOTE_URL.trim();
    if (!forceRefresh) {
      const sessionCached = await loadSessionCachedSiteConfig(remoteUrl);
      if (sessionCached) {
        siteConfigCache = sessionCached;
        return siteConfigCache;
      }
    }

    const bundledConfig = await loadBundledSiteConfig();

    if (!remoteUrl) {
      siteConfigCache = bundledConfig;
      await persistSessionCachedSiteConfig(siteConfigCache, remoteUrl);
      return siteConfigCache;
    }

    try {
      const remoteConfig = await loadRemoteSiteConfig(remoteUrl);
      siteConfigCache = mergeSiteConfigPayload(bundledConfig, remoteConfig);
    } catch (error) {
      console.warn('Failed to load remote site config, falling back to bundled config.', error);
      siteConfigCache = bundledConfig;
    }

    await persistSessionCachedSiteConfig(siteConfigCache, remoteUrl);
    return siteConfigCache;
  })();

  try {
    return await siteConfigPromise;
  } finally {
    siteConfigPromise = null;
  }
}

function getItemBasename(item) {
  return getUrlFilename(item.url, item.downloadBasename);
}

function createDefaultState() {
  return {
    status: 'idle',
    total: 0,
    completed: 0,
    failed: 0,
    title: '',
    parallelism: 1,
    finishedAt: null,
    manualRecovery: null,
    items: []
  };
}

let state = createDefaultState();

function cloneState() {
  return {
    ...state,
    manualRecovery: state.manualRecovery ? { ...state.manualRecovery } : null,
    items: state.items.map((item) => ({ ...item }))
  };
}

function updateSummary() {
  state.total = state.items.length;
  state.completed = state.items.filter((item) =>
    item.status === 'complete' || item.status === 'failed' || item.status === 'cancelled'
  ).length;
  state.failed = state.items.filter((item) => item.status === 'failed').length;
}

function clampDownloadParallelism(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.max(1, Math.min(6, Math.floor(parsed)));
}

function clampInterDownloadDelayMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.min(5000, Math.floor(parsed)));
}

function getBatchParallelism() {
  return clampDownloadParallelism(state.parallelism);
}

function resolveBatchParallelism(items) {
  const list = Array.isArray(items) ? items : [];

  for (const item of list) {
    if (Number.isFinite(item?.downloadParallelism)) {
      return clampDownloadParallelism(item.downloadParallelism);
    }
  }

  return 1;
}

function normalizeItem(rawItem, order) {
  return {
    order,
    url: typeof rawItem.url === 'string' ? rawItem.url : '',
    previewUrl: typeof rawItem.previewUrl === 'string' ? rawItem.previewUrl : '',
    folderTitle: sanitizePathSegment(rawItem.folderTitle, ''),
    pageUrl: typeof rawItem.pageUrl === 'string' ? rawItem.pageUrl : '',
    pageTitle: normalizePageTitle(rawItem.pageTitle, rawItem.folderTitle || ''),
    sourceIndex: Number.isInteger(rawItem.sourceIndex) ? rawItem.sourceIndex : order,
    type: rawItem.type === 'video' || rawItem.type === 'gif' ? rawItem.type : 'image',
    downloadBasename: normalizeSuggestedBasename(rawItem.downloadBasename),
    createFolder: typeof rawItem.createFolder === 'boolean' ? rawItem.createFolder : true,
    prefixOrderInFolder: rawItem.prefixOrderInFolder === true,
    downloadParallelism: Number.isFinite(rawItem.downloadParallelism)
      ? clampDownloadParallelism(rawItem.downloadParallelism)
      : 1,
    interDownloadDelayMs: Number.isFinite(rawItem.interDownloadDelayMs)
      ? clampInterDownloadDelayMs(rawItem.interDownloadDelayMs)
      : 0,
    status: typeof rawItem.status === 'string' ? rawItem.status : 'queued',
    progress: Number.isFinite(rawItem.progress) ? rawItem.progress : 0,
    downloadId: Number.isInteger(rawItem.downloadId) ? rawItem.downloadId : null,
    retryCount: Number.isFinite(rawItem.retryCount) ? Math.max(0, rawItem.retryCount) : 0,
    nextRetryAt: Number.isFinite(rawItem.nextRetryAt) ? rawItem.nextRetryAt : 0
  };
}

function normalizeManualRecovery(rawRecovery) {
  if (!rawRecovery || typeof rawRecovery !== 'object') {
    return null;
  }

  const pageUrl = normalizeRefreshPageUrl(rawRecovery.pageUrl || '');
  if (!pageUrl) {
    return null;
  }

  return {
    pageUrl,
    pageTitle: normalizePageTitle(rawRecovery.pageTitle, ''),
    reason: normalizePageTitle(rawRecovery.reason, ''),
    siteId: normalizeSiteStorageId(rawRecovery.siteId || getSiteStorageIdFromPageUrl(pageUrl)),
    failedOrder: Number.isInteger(rawRecovery.failedOrder) ? rawRecovery.failedOrder : null,
    updatedAt: Number.isFinite(rawRecovery.updatedAt) ? rawRecovery.updatedAt : Date.now()
  };
}

function hydrateRuntimeState() {
  queue = state.items
    .filter((item) => item.status === 'queued')
    .sort((a, b) => a.order - b.order)
    .map((item) => item.order);

  // Set?쇰줈 蹂?섑븯??以묐났 ?쒓굅
  queueSet = new Set(queue);

  activeDownloads.clear();

  state.items.forEach((item) => {
    if (item.status === 'downloading' && Number.isInteger(item.downloadId)) {
      activeDownloads.set(item.downloadId, item.order);
    }
  });

  updateSummary();
}

function findActiveDownloadIdByOrder(order) {
  for (const [downloadId, activeOrder] of activeDownloads.entries()) {
    if (activeOrder === order) {
      return downloadId;
    }
  }

  return null;
}

function clearRetryTimer() {
  if (!retryTimer) {
    return;
  }

  clearTimeout(retryTimer);
  retryTimer = null;
}

function clearRetryAlarm() {
  if (!chrome?.alarms?.clear) {
    return;
  }

  chrome.alarms.clear(RETRY_ALARM_NAME).catch(() => {});
}

function clearRetrySchedule() {
  clearRetryTimer();
  clearRetryAlarm();
}

function clearQueueStartDelay() {
  nextQueueStartAt = 0;
  if (!queueStartDelayTimer) {
    return;
  }

  clearTimeout(queueStartDelayTimer);
  queueStartDelayTimer = null;
}

function scheduleQueueStartDelay(delayMs = 0) {
  const waitMs = Math.max(0, Math.floor(delayMs));
  if (waitMs <= 0) {
    clearQueueStartDelay();
    return;
  }

  if (queueStartDelayTimer) {
    clearTimeout(queueStartDelayTimer);
  }

  queueStartDelayTimer = setTimeout(() => {
    queueStartDelayTimer = null;
    processQueue().catch(() => {});
  }, waitMs);
}

function getInterDownloadDelayMs(item) {
  return clampInterDownloadDelayMs(item?.interDownloadDelayMs);
}

function scheduleRetryProcess(delayMs = 0) {
  clearRetrySchedule();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    processQueue().catch(() => {});
  }, Math.max(0, delayMs));

  if (delayMs >= RETRY_ALARM_MIN_DELAY_MS && chrome?.alarms?.create) {
    chrome.alarms.create(RETRY_ALARM_NAME, {
      when: Date.now() + Math.max(0, delayMs)
    });
  }
}

function getNextRetryDelayMs() {
  const now = Date.now();
  let nextDelayMs = null;

  for (const item of state.items) {
    if (item?.status !== 'queued' || !Number.isFinite(item?.nextRetryAt) || item.nextRetryAt <= 0) {
      continue;
    }

    const delayMs = Math.max(0, item.nextRetryAt - now);
    if (nextDelayMs === null || delayMs < nextDelayMs) {
      nextDelayMs = delayMs;
    }
  }

  return nextDelayMs;
}

function ensureRetryProcessScheduled() {
  const nextDelayMs = getNextRetryDelayMs();
  if (nextDelayMs === null) {
    clearRetrySchedule();
    return false;
  }

  scheduleRetryProcess(nextDelayMs + 20);
  return true;
}

function getRetryDelayMs(retryCount = 0) {
  const exponent = Math.max(0, retryCount);
  return Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * (2 ** exponent));
}

function isArcaPageUrl(value) {
  try {
    return new URL(String(value || '')).hostname === 'arca.live';
  } catch {
    return false;
  }
}

function getRefreshCandidateUrl(candidate) {
  if (typeof candidate?.originalUrl === 'string' && candidate.originalUrl) {
    return candidate.originalUrl;
  }
  return typeof candidate?.url === 'string' ? candidate.url : '';
}

function getRefreshCandidateBasename(candidate) {
  return getUrlFilename(getRefreshCandidateUrl(candidate), candidate?.downloadBasename || '');
}

function normalizeRefreshPageUrl(pageUrl) {
  return String(pageUrl || '').replace(/[?#].*$/, '');
}

function isRefreshablePageItem(item) {
  return item?.status === 'queued' || item?.status === 'downloading' || item?.status === 'action_required';
}

function applyRefreshedItemsForPage(pageUrl, refreshedItems) {
  const normalizedPageUrl = normalizeRefreshPageUrl(pageUrl);
  const candidates = Array.isArray(refreshedItems) ? refreshedItems : [];
  if (!normalizedPageUrl || !candidates.length) {
    return 0;
  }

  let matchedCount = 0;

  state.items.forEach((stateItem) => {
    if (!isRefreshablePageItem(stateItem)) {
      return;
    }

    if (normalizeRefreshPageUrl(stateItem.pageUrl) !== normalizedPageUrl) {
      return;
    }

    const matchedItem = matchRefreshedDownloadItem(stateItem, candidates);
    if (!matchedItem) {
      return;
    }

    applyRefreshedDownloadItem(stateItem, matchedItem);
    stateItem.status = 'queued';
    stateItem.progress = 0;
    stateItem.downloadId = null;
    stateItem.nextRetryAt = 0;
    matchedCount += 1;
  });

  return matchedCount;
}

function shouldPauseForManualRecovery(item, reason = '') {
  return state.status === 'downloading' && isArcaPageUrl(item?.pageUrl);
}

async function pauseBatchForManualRecovery(item, reason = '') {
  const normalizedPageUrl = normalizeRefreshPageUrl(item?.pageUrl);
  if (!normalizedPageUrl) {
    return false;
  }

  clearRetrySchedule();
  clearQueueStartDelay();
  queue = [];
  queueSet.clear();

  const activeEntries = Array.from(activeDownloads.entries());
  activeDownloads.clear();

  state.items.forEach((stateItem) => {
    if (!stateItem) {
      return;
    }

    stateItem.downloadId = null;
    stateItem.nextRetryAt = 0;

    if (stateItem.order === item.order) {
      stateItem.status = 'action_required';
      stateItem.progress = 0;
      return;
    }

    if (stateItem.status === 'downloading') {
      stateItem.status = 'queued';
      stateItem.progress = 0;
    }
  });

  for (const [downloadId] of activeEntries) {
    try {
      await cancelDownload(downloadId);
    } catch {
      // Ignore cancellation errors for already-finished downloads.
    }
  }

  state.status = 'paused';
  state.finishedAt = null;
  state.manualRecovery = normalizeManualRecovery({
    pageUrl: normalizedPageUrl,
    pageTitle: item?.pageTitle || item?.folderTitle || state.title || '',
    reason,
    siteId: getSiteStorageIdFromPageUrl(normalizedPageUrl),
    failedOrder: Number.isInteger(item?.order) ? item.order : null,
    updatedAt: Date.now()
  });

  updateSummary();
  await persistState();
  await broadcastState();
  return true;
}

function applyRefreshedDownloadItem(item, matchedItem) {
  const refreshedUrl = getRefreshCandidateUrl(matchedItem);
  if (!item || !matchedItem || !refreshedUrl) {
    return false;
  }

  item.url = refreshedUrl;
  item.previewUrl = typeof matchedItem.previewUrl === 'string' && matchedItem.previewUrl
    ? matchedItem.previewUrl
    : item.previewUrl;
  item.folderTitle = sanitizePathSegment(matchedItem.folderTitle || item.folderTitle, item.folderTitle || 'Arca');
  item.pageUrl = typeof matchedItem.pageUrl === 'string' && matchedItem.pageUrl
    ? matchedItem.pageUrl
    : item.pageUrl;
  item.pageTitle = normalizePageTitle(matchedItem.pageTitle, item.pageTitle || item.folderTitle || '');
  item.downloadBasename = normalizeSuggestedBasename(matchedItem.downloadBasename || item.downloadBasename);
  return true;
}

function matchRefreshedDownloadItem(item, candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const currentType = item?.type === 'video' || item?.type === 'gif' ? item.type : 'image';
  const currentBasename = getItemBasename(item);
  const currentSourceIndex = Number.isInteger(item?.sourceIndex) ? item.sourceIndex : null;

  const basenameMatch = list.find((candidate) =>
    (candidate?.type === 'video' || candidate?.type === 'gif' ? candidate.type : 'image') === currentType &&
    currentBasename &&
    getRefreshCandidateBasename(candidate) === currentBasename
  );

  if (basenameMatch) {
    return basenameMatch;
  }

  return list.find((candidate) =>
    (candidate?.type === 'video' || candidate?.type === 'gif' ? candidate.type : 'image') === currentType &&
    currentSourceIndex !== null &&
    Number.isInteger(candidate?.sourceIndex) &&
    candidate.sourceIndex === currentSourceIndex
  ) || null;
}

async function queueItemForRetry(item, reason = '') {
  if (!item) {
    return;
  }

  await recordFailureHistoryItem(item, reason);
  if (shouldPauseForManualRecovery(item, reason)) {
    await pauseBatchForManualRecovery(item, reason);
    return;
  }

  const retryCount = Number.isFinite(item.retryCount) ? item.retryCount : 0;
  const nextRetryCount = retryCount + 1;
  item.retryCount = nextRetryCount;

  if (nextRetryCount > RETRY_MAX_COUNT) {
    item.status = 'failed';
    item.progress = 0;
    item.downloadId = null;
    item.nextRetryAt = 0;
    queue = queue.filter((order) => order !== item.order);
    queueSet.delete(item.order);
    await recordFailureHistoryItem(item, 'retry-limit-exceeded');
    updateSummary();
    await persistState();
    await broadcastState();
    ensureRetryProcessScheduled();
    return;
  }

  const delayMs = getRetryDelayMs(retryCount);
  item.nextRetryAt = Date.now() + delayMs;
  item.status = 'queued';
  item.progress = 0;
  item.downloadId = null;

  if (!queueSet.has(item.order)) {
    queue.push(item.order);
    queue.sort((left, right) => left - right);
    queueSet.add(item.order);
  }

  updateSummary();
  await persistState();
  await broadcastState();
  ensureRetryProcessScheduled();
}

async function persistState() {
  await chrome.storage.session.set({ [STORAGE_KEY]: cloneState() });
}

function broadcastToTabs(url, message) {
  void chrome.tabs.query({ url }).then((tabs) => {
    tabs.forEach((tab) => {
      if (Number.isInteger(tab.id)) {
        void chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    });
  }).catch(() => {});
}

function broadcastState() {
  broadcastToTabs(CONTENT_TAB_URLS, { action: 'progress', state: cloneState() });
}

function getFilename(item) {
  const sourceOrder = Number.isInteger(item.sourceIndex) ? item.sourceIndex : item.order;
  const folder = sanitizePathSegment(item.folderTitle || state.title || 'ArcaImages', 'ArcaImages');
  const basename = getItemBasename(item);
  const orderedBasename = basename && item.createFolder !== false && item.prefixOrderInFolder === true
    ? `${String(sourceOrder + 1).padStart(3, '0')}_${basename}`
    : basename;

  if (orderedBasename) {
    if (item.createFolder !== false) {
      return `ArcaDownload/${folder}/${orderedBasename}`;
    }
    return `ArcaDownload/${folder}-${orderedBasename}`;
  }

  try {
    if (item.createFolder !== false) {
      const fallbackBasename = item.prefixOrderInFolder === true
        ? `${String(sourceOrder + 1).padStart(3, '0')}_media_${sourceOrder + 1}`
        : `media_${sourceOrder + 1}`;
      return `ArcaDownload/${folder}/${fallbackBasename}`;
    }
    return `ArcaDownload/${folder}-media_${sourceOrder + 1}`;
  } catch {
    return `ArcaDownload/media_${sourceOrder + 1}`;
  }
}

function getItemStoragePath(item) {
  try {
    return getFilename(item);
  } catch {
    return '';
  }
}

function getItemDedupKey(item) {
  const storagePath = getItemStoragePath(item);
  if (storagePath) {
    return storagePath.toLowerCase();
  }

  return String(item.url || '');
}

function normalizePageTitle(value, fallback = '') {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function normalizeSiteStorageId(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  return normalized === 'twitter.com' ? 'x.com' : normalized;
}

function getSiteStorageIdFromPageUrl(pageUrl = '') {
  try {
    return normalizeSiteStorageId(new URL(String(pageUrl || '')).hostname);
  } catch {
    return '';
  }
}

function getSiteTabUrlPatterns(siteId = '') {
  const normalizedSiteId = normalizeSiteStorageId(siteId);
  if (normalizedSiteId === 'arca.live') {
    return ['https://arca.live/*'];
  }
  if (normalizedSiteId === 'x.com') {
    return ['https://x.com/*', 'https://twitter.com/*'];
  }
  return CONTENT_TAB_URLS;
}

function getFailureHistoryKey(item) {
  const pageUrl = String(item?.pageUrl || '').trim();
  const basename = getItemBasename(item);
  if (!pageUrl || !basename) {
    return '';
  }

  return `${pageUrl}::${basename}`.toLowerCase();
}

function toFailureHistoryEntry(item, reason = '') {
  const pageUrl = String(item?.pageUrl || '').trim();
  const filename = getItemBasename(item);
  const key = getFailureHistoryKey(item);

  if (!pageUrl || !filename || !key) {
    return null;
  }

  return {
    key,
    pageUrl,
    pageTitle: normalizePageTitle(item?.pageTitle, item?.folderTitle || state.title || ''),
    filename,
    previewUrl: typeof item?.previewUrl === 'string' ? item.previewUrl : '',
    type: item?.type === 'video' || item?.type === 'gif' ? item.type : 'image',
    siteId: getSiteStorageIdFromPageUrl(pageUrl),
    failedAt: Date.now(),
    reason: normalizePageTitle(reason, '')
  };
}

async function getFailureHistoryStore() {
  const stored = await chrome.storage.local.get(FAILURE_HISTORY_KEY);
  const payload = stored?.[FAILURE_HISTORY_KEY];

  if (Array.isArray(payload)) {
    const legacyStore = {};
    payload.forEach((entry) => {
      const siteId = normalizeSiteStorageId(entry?.siteId);
      if (!siteId) {
        return;
      }

      if (!Array.isArray(legacyStore[siteId])) {
        legacyStore[siteId] = [];
      }

      legacyStore[siteId].push(entry);
    });
    return legacyStore;
  }

  return payload && typeof payload === 'object' ? payload : {};
}

async function setFailureHistoryStore(store) {
  const nextStore = {};
  Object.entries(store && typeof store === 'object' ? store : {}).forEach(([siteId, history]) => {
    const normalizedSiteId = normalizeSiteStorageId(siteId);
    if (!normalizedSiteId || !Array.isArray(history)) {
      return;
    }

    nextStore[normalizedSiteId] = history.slice(0, FAILURE_HISTORY_LIMIT);
  });

  await chrome.storage.local.set({ [FAILURE_HISTORY_KEY]: nextStore });
}

async function getFailureHistory(siteId = '') {
  const normalizedSiteId = normalizeSiteStorageId(siteId);
  if (!normalizedSiteId) {
    return [];
  }

  const store = await getFailureHistoryStore();
  return Array.isArray(store[normalizedSiteId]) ? store[normalizedSiteId] : [];
}

async function setFailureHistory(siteId, history) {
  const normalizedSiteId = normalizeSiteStorageId(siteId);
  if (!normalizedSiteId) {
    return;
  }

  const store = await getFailureHistoryStore();
  store[normalizedSiteId] = Array.isArray(history) ? history.slice(0, FAILURE_HISTORY_LIMIT) : [];
  await setFailureHistoryStore(store);
}

async function broadcastFailureHistory(siteId = '') {
  const normalizedSiteId = normalizeSiteStorageId(siteId);
  const history = await getFailureHistory(normalizedSiteId);
  broadcastToTabs(getSiteTabUrlPatterns(normalizedSiteId), {
    action: 'failureHistory',
    siteId: normalizedSiteId,
    history
  });
}

async function recordFailureHistoryItem(item, reason = '') {
  const entry = toFailureHistoryEntry(item, reason);
  if (!entry) {
    return false;
  }

  const siteId = normalizeSiteStorageId(entry.siteId);
  if (!siteId) {
    return false;
  }

  const history = await getFailureHistory(siteId);
  const nextHistory = [entry, ...history.filter((candidate) => candidate?.key !== entry.key)]
    .slice(0, FAILURE_HISTORY_LIMIT);
  await setFailureHistory(siteId, nextHistory);
  await broadcastFailureHistory(siteId);
  return true;
}

async function clearFailureHistoryItem(item) {
  const key = getFailureHistoryKey(item);
  if (!key) {
    return false;
  }

  const siteId = getSiteStorageIdFromPageUrl(item?.pageUrl || '');
  if (!siteId) {
    return false;
  }

  const history = await getFailureHistory(siteId);
  const nextHistory = history.filter((candidate) => candidate?.key !== key);
  if (nextHistory.length === history.length) {
    return false;
  }

  await setFailureHistory(siteId, nextHistory);
  await broadcastFailureHistory(siteId);
  return true;
}

async function clearFailureHistory(siteId = '') {
  const normalizedSiteId = normalizeSiteStorageId(siteId);
  if (!normalizedSiteId) {
    return false;
  }

  await setFailureHistory(normalizedSiteId, []);
  await broadcastFailureHistory(normalizedSiteId);
  return true;
}

function normalizeDownloadsForTitle(downloads, title, startOrder = 0) {
  return (Array.isArray(downloads) ? downloads : [])
    .filter((item) => typeof item?.url === 'string' && item.url)
    .map((item, index) =>
      normalizeItem({ ...item, folderTitle: item.folderTitle || title || '' }, startOrder + index)
    );
}

function renumberItems(items, startOrder = 0) {
  return items.map((item, index) => normalizeItem(item, startOrder + index));
}

function calcProgress(downloadItem) {
  const totalBytes =
    downloadItem.totalBytes > 0 ? downloadItem.totalBytes :
    downloadItem.fileSize > 0 ? downloadItem.fileSize :
    0;

  if (totalBytes <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round((downloadItem.bytesReceived / totalBytes) * 100)));
}

function calcProgressFromDelta(delta, fallbackProgress = 0) {
  const bytesReceived = Number.isFinite(delta?.bytesReceived?.current)
    ? delta.bytesReceived.current
    : NaN;
  const totalBytes = Number.isFinite(delta?.totalBytes?.current) && delta.totalBytes.current > 0
    ? delta.totalBytes.current
    : Number.isFinite(delta?.fileSize?.current) && delta.fileSize.current > 0
      ? delta.fileSize.current
      : 0;

  if (!Number.isFinite(bytesReceived) || totalBytes <= 0) {
    return fallbackProgress;
  }

  return Math.max(0, Math.min(100, Math.round((bytesReceived / totalBytes) * 100)));
}

async function downloadFile(options) {
  return new Promise((resolve) => {
    chrome.downloads.download(options, (downloadId) => {
      const error = chrome.runtime.lastError ? chrome.runtime.lastError.message : null;
      resolve({ downloadId, error });
    });
  });
}

async function searchDownload(downloadId) {
  return new Promise((resolve) => {
    chrome.downloads.search({ id: downloadId }, (results) => {
      resolve(Array.isArray(results) ? results[0] : null);
    });
  });
}

async function searchDownloads(query) {
  return new Promise((resolve) => {
    chrome.downloads.search(query, (results) => {
      resolve(Array.isArray(results) ? results : []);
    });
  });
}

async function cancelDownload(downloadId) {
  return new Promise((resolve) => {
    chrome.downloads.cancel(downloadId, () => {
      resolve();
    });
  });
}

async function removeDownloadedFile(downloadId) {
  return new Promise((resolve) => {
    chrome.downloads.removeFile(downloadId, () => {
      resolve();
    });
  });
}

function isUnexpectedHtmlDownload(item, download) {
  const mediaType = item?.type === 'video' || item?.type === 'gif' ? item.type : 'image';
  if (!download || !mediaType) {
    return false;
  }

  const mime = String(download.mime || '').toLowerCase();
  if (mime.includes('text/html')) {
    return true;
  }

  const htmlLikePattern = /\.(?:html?|shtml)(?:$|[?#])/i;
  const filename = String(download.filename || '').toLowerCase();
  const finalUrl = String(download.finalUrl || download.url || '').toLowerCase();
  return htmlLikePattern.test(filename) || htmlLikePattern.test(finalUrl);
}

function findItem(order) {
  return state.items.find((item) => item.order === order) || null;
}

function finalizeBatch(status) {
  state.status = status;
  state.finishedAt = Date.now();
  state.manualRecovery = null;
  queue = [];
  queueSet.clear();
  activeDownloads.clear();
  clearQueueStartDelay();
  clearRetrySchedule();
  updateSummary();
}

function shouldAutoHide() {
  return (
    (state.status === 'done' || state.status === 'cancelled') &&
    Number.isFinite(state.finishedAt) &&
    Date.now() - state.finishedAt >= AUTO_HIDE_MS
  );
}

async function clearState() {
  state = createDefaultState();
  queue = [];
  queueSet.clear();
  activeDownloads.clear();
  clearQueueStartDelay();
  clearRetrySchedule();
  await persistState();
  await broadcastState();
}

async function syncActiveDownloads() {
  if (activeDownloads.size === 0) {
    return false;
  }

  let changed = false;

  for (const [downloadId, order] of Array.from(activeDownloads.entries())) {
    const item = findItem(order);
    if (!item) {
      activeDownloads.delete(downloadId);
      changed = true;
      continue;
    }

    const download = await searchDownload(downloadId);
    if (!download) {
      activeDownloads.delete(downloadId);
      if (state.status === 'downloading') {
        await queueItemForRetry(item, 'download-not-found');
      } else {
        item.status = state.status === 'cancelled' ? 'cancelled' : 'failed';
        item.progress = state.status === 'cancelled' ? item.progress : 0;
        item.downloadId = null;
        if (item.status === 'failed') {
          await recordFailureHistoryItem(item, 'download-not-found');
        }
      }
      changed = true;
      continue;
    }

    if (download.state === 'complete') {
      activeDownloads.delete(downloadId);
      if (isUnexpectedHtmlDownload(item, download)) {
        await removeDownloadedFile(downloadId);
        if (state.status === 'downloading') {
          await queueItemForRetry(item, 'unexpected-html');
        } else {
          item.status = state.status === 'cancelled' ? 'cancelled' : 'failed';
          item.progress = state.status === 'cancelled' ? item.progress : 0;
          item.downloadId = null;
          if (item.status === 'failed') {
            await recordFailureHistoryItem(item, 'unexpected-html');
          }
        }
      } else {
        item.status = 'complete';
        item.progress = 100;
        item.downloadId = null;
        item.retryCount = 0;
        item.nextRetryAt = 0;
        nextQueueStartAt = Date.now() + getInterDownloadDelayMs(item);
        await clearFailureHistoryItem(item);
      }
      changed = true;
      continue;
    }

    if (download.state === 'interrupted') {
      activeDownloads.delete(downloadId);
      if (state.status === 'downloading') {
        await queueItemForRetry(item, download.error || 'interrupted');
      } else {
        item.status = state.status === 'cancelled' ? 'cancelled' : 'failed';
        item.downloadId = null;
        if (item.status === 'failed') {
          await recordFailureHistoryItem(item, download.error || 'interrupted');
        }
      }
      changed = true;
      continue;
    }

    const nextProgress = calcProgress(download);
    if (item.progress !== nextProgress) {
      item.progress = nextProgress;
      changed = true;
    }
  }

  if (changed) {
    if (state.status === 'downloading' && queue.length === 0 && activeDownloads.size === 0) {
      finalizeBatch('done');
    } else {
      updateSummary();
      ensureRetryProcessScheduled();
    }

    await persistState();
    await broadcastState();
  }

  return changed;
}

async function processQueue() {
  // ?곹깭 泥댄겕瑜?癒쇱? ?섑뻾
  if (state.status !== 'downloading') {
    return;
  }

  // ?대? 泥섎━ 以묒씠硫??뚮옒洹몃쭔 ?ㅼ젙?섍퀬 由ы꽩
  if (processingQueue) {
    pendingProcess = true;
    return;
  }

  processingQueue = true;

  try {
    // ?ш? ?몄텧 ???猷⑦봽 ?ъ슜
    do {
      // pendingProcess 珥덇린??
      pendingProcess = false;
      
      while (queue.length > 0 && activeDownloads.size < getBatchParallelism()) {
        // ?곹깭媛 蹂寃쎈릺?덈뒗吏 ?ㅼ떆 ?뺤씤
        if (state.status !== 'downloading') {
          return;
        }

        if (activeDownloads.size === 0 && nextQueueStartAt > Date.now()) {
          scheduleQueueStartDelay(nextQueueStartAt - Date.now());
          break;
        }

        const nextOrder = queue[0];
        if (!Number.isInteger(nextOrder)) {
          break;
        }

        const item = findItem(nextOrder);
        if (!item || item.status !== 'queued') {
          queue.shift();
          queueSet.delete(nextOrder);
          continue;
        }

        const retryWaitMs = Number.isFinite(item.nextRetryAt) ? item.nextRetryAt - Date.now() : 0;
        if (retryWaitMs > 0) {
          ensureRetryProcessScheduled();
          break;
        }

        const order = queue.shift();
        queueSet.delete(order);

        const { downloadId, error } = await downloadFile({
          url: item.url,
          filename: getFilename(item),
          conflictAction: 'uniquify'
        });

        if (error || !downloadId) {
          await queueItemForRetry(item, error || 'download-start-failed');
          continue;
        }

        // ?ㅼ슫濡쒕뱶 ID瑜?癒쇱? ?깅줉?섏뿬 以묐났 ?쒖옉 諛⑹?
        activeDownloads.set(downloadId, item.order);
        
        item.status = 'downloading';
        item.progress = 0;
        item.downloadId = downloadId;
        item.nextRetryAt = 0;
        nextQueueStartAt = 0;
        updateSummary();
        ensureRetryProcessScheduled();
      }

      // ?꾨즺 泥댄겕
      if (queue.length === 0 && activeDownloads.size === 0 && state.status === 'downloading') {
        finalizeBatch('done');
        return;
      }

      await persistState();
      await broadcastState();
      
    } while (pendingProcess && state.status === 'downloading');
    
  } finally {
    processingQueue = false;
    // pendingProcess媛 ?ъ쟾??true硫??ㅼ떆 ?ㅽ뻾 (?ш? ???while 猷⑦봽濡?泥섎━??
    if (pendingProcess && state.status === 'downloading') {
      pendingProcess = false;
      // setImmediate ?④낵瑜??꾪빐 setTimeout ?ъ슜
      setTimeout(() => processQueue(), 0);
    }
  }
}

async function startBatch(downloads, title) {
  if (state.status === 'downloading' && state.items.length > 0) {
    return { ok: false, error: 'busy' };
  }

  const { items: nextItems, skipped } = await filterExistingDownloads(downloads, title);
  if (!nextItems.length) {
    return { ok: true, added: 0, skipped };
  }

  state = createDefaultState();
  state.status = 'downloading';
  state.title = sanitizePathSegment(title, '');
  state.items = renumberItems(nextItems);
  state.parallelism = resolveBatchParallelism(state.items);
  hydrateRuntimeState();

  await persistState();
  await broadcastState();
  
  // processQueue媛 ?꾨즺???뚭퉴吏 湲곕떎由ъ? ?딄퀬 利됱떆 諛섑솚
  processQueue().catch(() => {});

  return { ok: true, added: state.items.length, skipped };
}

async function appendToBatchWithExistingCheck(downloads, title) {
  if (state.status !== 'downloading' || state.items.length === 0) {
    return { ok: false, error: 'no-active-batch' };
  }

  const batchKeys = new Set(state.items.map((item) => getItemDedupKey(item)));
  const candidateItems = [];

  normalizeDownloadsForTitle(downloads, title, state.items.length).forEach((item) => {
    const key = getItemDedupKey(item);
    if (batchKeys.has(key)) {
      return;
    }

    batchKeys.add(key);
    candidateItems.push(item);
  });

  const { items: filteredItems } = await filterExistingDownloads(candidateItems, title);
  const nextItems = renumberItems(filteredItems, state.items.length);

  if (!nextItems.length) {
    return { ok: true, added: 0 };
  }

  state.items.push(...nextItems);
  state.parallelism = Math.max(getBatchParallelism(), resolveBatchParallelism(nextItems));

  nextItems.forEach((item) => {
    if (!queueSet.has(item.order)) {
      queue.push(item.order);
      queueSet.add(item.order);
    }
  });

  updateSummary();

  await persistState();
  await broadcastState();
  processQueue().catch(() => {});

  return { ok: true, added: nextItems.length };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dedupDebugLog(enabled, label, payload) {
  if (!enabled) {
    return;
  }

  try {
    console.log(`[ArcaDL][dedup][bg] ${label}`, payload);
  } catch {}
}

function buildDownloadedFileRegex(item) {
  const basename = getItemBasename(item);
  if (!basename) {
    return '';
  }

  const lastDot = basename.lastIndexOf('.');
  const hasExtension = lastDot > 0 && lastDot < basename.length - 1;
  const stem = hasExtension ? basename.slice(0, lastDot) : basename;
  const stemPattern = escapeRegExp(stem);

  return `(?:^|[\\\\/])[^\\\\/]*${stemPattern}(?: \\(\\d+\\))?(?:\\.[^\\\\/.]+)?$`;
}

function isDownloadEffectivelyComplete(download) {
  // Only fully completed downloads count as existing media.
  // Partial/interrupted entries must stay selectable.
  return Boolean(download?.exists && download.state === 'complete');
}

async function checkExistingDownloads(downloads, title, options = {}) {
  const normalizedItems = normalizeDownloadsForTitle(downloads, title);
  const existsByKey = {};
  const debugDedup = options?.debugDedup === true;
  const siteId = normalizeSiteStorageId(options?.siteId || '');

  dedupDebugLog(debugDedup, 'checkExisting:start', {
    title,
    siteId,
    itemCount: normalizedItems.length
  });

  await Promise.all(normalizedItems.map(async (item) => {
    const key = getItemDedupKey(item);
    if (!key) {
      dedupDebugLog(debugDedup, 'checkExisting:skip-no-key', {
        title,
        siteId,
        basename: getItemBasename(item),
        item
      });
      return;
    }

    const regex = buildDownloadedFileRegex(item);
    if (!regex) {
      dedupDebugLog(debugDedup, 'checkExisting:skip-no-regex', {
        title,
        siteId,
        key,
        item
      });
      return;
    }

    const matches = await searchDownloads({
      filenameRegex: regex,
      exists: true
    });

    const hasExisting = matches.some((download) => isDownloadEffectivelyComplete(download));
    existsByKey[key] = hasExisting;

    dedupDebugLog(debugDedup, 'checkExisting:item', {
      title,
      siteId,
      key,
      regex,
      basename: getItemBasename(item),
      createFolder: item.createFolder,
      prefixOrderInFolder: item.prefixOrderInFolder,
      sourceIndex: item.sourceIndex,
      matches: matches.map((download) => ({
        id: download.id,
        filename: download.filename,
        exists: download.exists,
        state: download.state,
        bytesReceived: download.bytesReceived,
        totalBytes: download.totalBytes,
        fileSize: download.fileSize,
        effectivelyComplete: isDownloadEffectivelyComplete(download)
      })),
      hasExisting
    });
  }));

  dedupDebugLog(debugDedup, 'checkExisting:done', {
    title,
    siteId,
    existsByKey
  });

  return { existsByKey };
}

async function filterExistingDownloads(downloads, title) {
  const normalizedItems = normalizeDownloadsForTitle(downloads, title);
  if (!normalizedItems.length) {
    return { items: [], skipped: 0 };
  }

  const { existsByKey } = await checkExistingDownloads(normalizedItems, title);
  const items = normalizedItems.filter((item) => {
    const key = getItemDedupKey(item);
    return !(key && existsByKey[key]);
  });

  return {
    items,
    skipped: normalizedItems.length - items.length
  };
}

async function cancelBatch() {
  if (state.status !== 'downloading' && state.status !== 'paused') {
    return { ok: true };
  }

  // 癒쇱? ?곹깭瑜?痍⑥냼濡?蹂寃쏀븯???덈줈???ㅼ슫濡쒕뱶 ?쒖옉 諛⑹?
  state.status = 'cancelling';
  clearRetrySchedule();

  for (const order of queue) {
    const item = findItem(order);
    if (item && item.status === 'queued') {
      item.status = 'cancelled';
    }
  }

  queue = [];
  queueSet.clear();

  const activeEntries = Array.from(activeDownloads.entries());
  activeDownloads.clear();

  for (const [downloadId, order] of activeEntries) {
    const item = findItem(order);
    if (item) {
      item.status = 'cancelled';
      item.downloadId = null;
    }

    try {
      await cancelDownload(downloadId);
    } catch (e) {
      // ?대? 痍⑥냼?섏뿀嫄곕굹 ?꾨즺??寃쎌슦 臾댁떆
    }
  }

  finalizeBatch('cancelled');
  await persistState();
  await broadcastState();

  return { ok: true };
}

async function removeBatchItem(order) {
  if ((state.status !== 'downloading' && state.status !== 'paused') || !Number.isInteger(order)) {
    return { ok: true, removed: 0 };
  }

  const item = findItem(order);
  if (!item || (item.status !== 'queued' && item.status !== 'downloading' && item.status !== 'action_required')) {
    return { ok: true, removed: 0 };
  }

  if (item.status === 'downloading') {
    const downloadId = Number.isInteger(item.downloadId) ? item.downloadId : findActiveDownloadIdByOrder(order);
    item.downloadId = null;
    if (Number.isInteger(downloadId)) {
      activeDownloads.delete(downloadId);
      try {
        await cancelDownload(downloadId);
      } catch {
        // Ignore cancellation errors for already-finished items.
      }
    }
  }

  state.items = renumberItems(state.items.filter((candidate) => candidate.order !== order));

  if (state.items.length === 0) {
    await clearState();
    return { ok: true, removed: 1 };
  }

  hydrateRuntimeState();

  if (state.status === 'paused' && !state.items.some((candidate) => candidate?.status === 'action_required')) {
    state.manualRecovery = null;
    if (queue.length > 0) {
      state.status = 'downloading';
      state.finishedAt = null;
    }
  }

  if (queue.length === 0 && activeDownloads.size === 0) {
    if (state.status === 'paused' && state.manualRecovery) updateSummary();
    else finalizeBatch('done');
  } else {
    updateSummary();
  }

  await persistState();
  await broadcastState();

  if (state.status === 'downloading' && activeDownloads.size < getBatchParallelism() && queue.length > 0) {
    await processQueue();
  }

  return { ok: true, removed: 1 };
}

async function resumePausedBatchFromPage(pageUrl, items) {
  if (state.status !== 'paused' || !state.manualRecovery) {
    return { ok: false, error: 'no-paused-batch' };
  }

  const normalizedPageUrl = normalizeRefreshPageUrl(pageUrl);
  if (!normalizedPageUrl || normalizedPageUrl !== state.manualRecovery.pageUrl) {
    return { ok: false, error: 'page-mismatch' };
  }

  const refreshedItems = Array.isArray(items) ? items : [];
  if (!refreshedItems.length) {
    return { ok: false, error: 'no-media-found' };
  }

  const matchedCount = applyRefreshedItemsForPage(normalizedPageUrl, refreshedItems);
  if (matchedCount <= 0) {
    return { ok: false, error: 'no-matching-media' };
  }

  state.status = 'downloading';
  state.finishedAt = null;
  state.manualRecovery = null;
  hydrateRuntimeState();

  await persistState();
  await broadcastState();
  processQueue().catch(() => {});

  return { ok: true, resumed: matchedCount };
}

async function reportDownloadResult(item, success, error = '') {
  const normalizedItem = normalizeItem(item || {}, 0);
  if (success) {
    await clearFailureHistoryItem(normalizedItem);
    return { ok: true };
  }

  await recordFailureHistoryItem(normalizedItem, error);
  return { ok: true };
}

async function getStateForResponse() {
  if (shouldAutoHide()) {
    await clearState();
    return cloneState();
  }

  if (state.status === 'downloading') {
    await syncActiveDownloads();
    ensureRetryProcessScheduled();
    if (activeDownloads.size < getBatchParallelism() && queue.length > 0) {
      await processQueue();
    }
  }

  if (shouldAutoHide()) {
    await clearState();
  }

  return cloneState();
}

async function loadPersistedState() {
  const stored = await chrome.storage.session.get(STORAGE_KEY);
  const savedState = stored[STORAGE_KEY];

  if (!savedState || typeof savedState !== 'object') {
    return;
  }

  state = createDefaultState();
  state.status = typeof savedState.status === 'string' ? savedState.status : 'idle';
  state.title = sanitizePathSegment(savedState.title, '');
  state.parallelism = Number.isFinite(savedState.parallelism)
    ? clampDownloadParallelism(savedState.parallelism)
    : 1;
  state.finishedAt = Number.isFinite(savedState.finishedAt) ? savedState.finishedAt : null;
  state.manualRecovery = normalizeManualRecovery(savedState.manualRecovery);
  state.items = Array.isArray(savedState.items)
    ? savedState.items.map((item, order) => normalizeItem(item, order))
    : [];
  if (state.items.length > 0) {
    state.parallelism = Math.max(state.parallelism, resolveBatchParallelism(state.items));
  }

  hydrateRuntimeState();

  if (state.status === 'downloading') {
    await syncActiveDownloads();
    ensureRetryProcessScheduled();
    if (activeDownloads.size < getBatchParallelism() && queue.length > 0) {
      await processQueue();
    }
  }

  if (shouldAutoHide()) {
    await clearState();
  }
}

const ready = loadPersistedState();

chrome.downloads.onChanged.addListener((delta) => {
  ready.then(async () => {
    if (!activeDownloads.has(delta.id)) {
      return;
    }

    const order = activeDownloads.get(delta.id);
    const item = findItem(order);
    if (!item) {
      activeDownloads.delete(delta.id);
      return;
    }

    let changed = false;
    const nextProgress = calcProgressFromDelta(delta, item.progress);
    if (item.status === 'downloading' && nextProgress !== item.progress) {
      item.progress = nextProgress;
      changed = true;
    }

    if (!delta.state) {
      if (changed) {
        await persistState();
        await broadcastState();
      }
      return;
    }

    if (delta.state.current === 'complete') {
      activeDownloads.delete(delta.id);
      const download = await searchDownload(delta.id);
      if (isUnexpectedHtmlDownload(item, download)) {
        await removeDownloadedFile(delta.id);
        if (state.status === 'downloading') {
          await queueItemForRetry(item, 'unexpected-html');
        } else {
          item.status = state.status === 'cancelled' ? 'cancelled' : 'failed';
          item.progress = state.status === 'cancelled' ? item.progress : 0;
          item.downloadId = null;
          if (item.status === 'failed') {
            await recordFailureHistoryItem(item, 'unexpected-html');
          }
        }
      } else {
        item.status = 'complete';
        item.progress = 100;
        item.downloadId = null;
        item.retryCount = 0;
        item.nextRetryAt = 0;
        nextQueueStartAt = Date.now() + getInterDownloadDelayMs(item);
        await clearFailureHistoryItem(item);
      }
      changed = true;
    } else if (delta.state.current === 'interrupted') {
      activeDownloads.delete(delta.id);
      if (state.status === 'downloading') {
        await queueItemForRetry(item, delta.error?.current || 'interrupted');
      } else {
        item.status = state.status === 'cancelled' ? 'cancelled' : 'failed';
        item.downloadId = null;
        if (item.status === 'failed') {
          await recordFailureHistoryItem(item, delta.error?.current || 'interrupted');
        }
      }
      changed = true;
    } else {
      if (changed) {
        await persistState();
        await broadcastState();
      }
      return;
    }

    if (state.status === 'downloading' && queue.length === 0 && activeDownloads.size === 0) {
      finalizeBatch('done');
    } else {
      updateSummary();
      ensureRetryProcessScheduled();
    }

    await persistState();
    await broadcastState();

    if (state.status === 'downloading' && activeDownloads.size < getBatchParallelism() && queue.length > 0) {
      await processQueue();
    }
  }).catch(() => {});
});

if (chrome?.alarms?.onAlarm) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (!alarm || alarm.name !== RETRY_ALARM_NAME) {
      return;
    }

    ready.then(() => processQueue().catch(() => {})).catch(() => {});
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  ready.then(async () => {
    if (msg.action === 'startDownload') {
      const downloads = Array.isArray(msg.downloads) ? msg.downloads : [];
      const response = await startBatch(downloads, msg.title);
      sendResponse(response);
      return;
    }

    if (msg.action === 'appendDownloads') {
      const downloads = Array.isArray(msg.downloads) ? msg.downloads : [];
      const response = await appendToBatchWithExistingCheck(downloads, msg.title);
      sendResponse(response);
      return;
    }

    if (msg.action === 'checkExisting') {
      const downloads = Array.isArray(msg.items) ? msg.items : [];
      const response = await checkExistingDownloads(downloads, msg.title, {
        siteId: msg.siteId,
        debugDedup: msg.debugDedup === true
      });
      sendResponse(response);
      return;
    }

    if (msg.action === 'cancel') {
      const response = await cancelBatch();
      sendResponse(response);
      return;
    }

    if (msg.action === 'removeBatchItem') {
      const response = await removeBatchItem(msg.order);
      sendResponse(response);
      return;
    }

    if (msg.action === 'resumePausedBatchFromPage') {
      const response = await resumePausedBatchFromPage(msg.pageUrl, msg.items);
      sendResponse(response);
      return;
    }

    if (msg.action === 'getFailureHistory') {
      sendResponse({ ok: true, history: await getFailureHistory(msg.siteId) });
      return;
    }

    if (msg.action === 'clearFailureHistory') {
      await clearFailureHistory(msg.siteId);
      sendResponse({ ok: true });
      return;
    }

    if (msg.action === 'reportDownloadResult') {
      const response = await reportDownloadResult(msg.item, Boolean(msg.success), msg.error || '');
      sendResponse(response);
      return;
    }

    if (msg.action === 'getState') {
      const responseState = await getStateForResponse();
      sendResponse({ state: responseState });
      return;
    }

    if (msg.action === 'getSiteConfig') {
      const payload = await getSiteConfigPayload(Boolean(msg.forceRefresh));
      sendResponse({ ok: true, payload });
      return;
    }

    if (msg.action === 'getTwitterDetailsRequest') {
      try {
        const tweetId = extractTweetId(msg.tweetId || msg.statusPath || msg.url || '');
        if (!tweetId) {
          sendResponse({ ok: false, error: 'twitter-tweet-id-not-found' });
          return;
        }

        const request = await TwitterApi.buildDetailsRequest(tweetId, {
          forceRefresh: Boolean(msg.forceRefresh),
          mainJsUrl: msg.mainJsUrl || ''
        });
        sendResponse({ ok: true, request });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'twitter-details-request-failed'
        });
      }
      return;
    }

    if (msg.action === 'resolveTwitterVideo') {
      try {
        const download = await resolveTwitterVideoDownload(msg.item);
        sendResponse({ ok: true, download });
      } catch (error) {
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : 'twitter-video-resolve-failed'
        });
      }
      return;
    }

    sendResponse({ ok: false, error: 'unknown-action' });
  }).catch(() => {
    sendResponse({ ok: false, error: 'unexpected-error' });
  });

  return true;
});

