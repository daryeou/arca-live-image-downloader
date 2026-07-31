(() => {
  const {
    sanitizePathSegment: sanitizeFilenamePart,
    normalizeSuggestedBasename,
    getUrlFilename
  } = globalThis.ArcaDLShared;
  const TwitterResolver = globalThis.ArcaDLTwitterResolver;
  const ROOT_ID = 'arca-dl-root';
  const PANEL_POLL_MS = 500;
  const WATCH_DEBOUNCE_MS = 120;
  const WATCH_TIMEOUT_MS = 10000;
  const LOCAL_URL_TTL_MS = 30000;
  const RECOVERY_POLL_MS = 200;
  const RECOVERY_TIMEOUT_MS = 6000;
  const SITE_PREFERENCES_KEY = 'sitePreferences';
  const DEBUG_STORAGE_KEY = 'debug';
  const EXT_VERSION = (() => {
    try { return `v${chrome.runtime.getManifest().version}`; } catch { return 'v'; }
  })();
  const TEXT = {
    all: '\uC804\uCCB4',
    image: '\uC774\uBBF8\uC9C0',
    video: '\uBE44\uB514\uC624',
    gif: 'GIF',
    available: '\uB2E4\uC6B4\uB85C\uB4DC \uAC00\uB2A5',
    selectedSuffix: '\uAC1C \uC120\uD0DD',
    download: '\uC120\uD0DD \uB2E4\uC6B4\uB85C\uB4DC',
    append: '\uC120\uD0DD \uD56D\uBAA9 \uCD94\uAC00',
    cancel: '\uCDE8\uC18C',
    complete: '\uC644\uB8CC',
    failed: '\uC2E4\uD328',
    cancelled: '\uCDE8\uC18C\uB428',
    queued: '\uB300\uAE30 \uC911',
    downloading: '\uB2E4\uC6B4\uB85C\uB4DC \uC911',
    alreadyDownloaded: '\uC644\uB8CC',
    processing: '\uCC98\uB9AC \uC911...',
    statusTitle: '\uB2E4\uC6B4\uB85C\uB4DC \uD604\uD669',
    paused: '\uC77C\uC2DC\uC911\uB2E8',
    actionRequired: '\uD398\uC774\uC9C0 \uD655\uC778',
    createFolder: '\uD3F4\uB354 \uC0DD\uC131',
    reverseOrder: '\uC5ED\uC21C \uB2E4\uC6B4\uB85C\uB4DC',
    reverseOrderMeta: '\uB9C8\uC9C0\uB9C9 \uD56D\uBAA9\uBD80\uD130 \uC800\uC7A5',
    failureHistory: '\uC2E4\uD328 \uAE30\uB85D',
    clearAll: '\uBAA8\uB450 \uC9C0\uC6B0\uAE30',
    openPage: '\uC5F4\uAE30',
    recoveryHelp: '\uB2E4\uC6B4\uB85C\uB4DC \uC624\uB958\uB85C \uC77C\uC2DC\uC911\uB2E8\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uC6D0\uBB38 \uD398\uC774\uC9C0\uB97C \uC5F4\uBA74 \uB2E4\uC2DC \uC9C4\uD589\uB429\uB2C8\uB2E4.',
    recoveryToast: '\uB2E4\uC6B4\uB85C\uB4DC \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4. \uC6D0\uBB38 \uD398\uC774\uC9C0\uB97C \uC5F4\uBA74 \uB2E4\uC2DC \uC9C4\uD589\uB429\uB2C8\uB2E4.',
    recoveryResumed: '\uD398\uC774\uC9C0 \uD655\uC778 \uD6C4 \uB2E4\uC6B4\uB85C\uB4DC\uB97C \uB2E4\uC2DC \uC2DC\uC791\uD588\uC2B5\uB2C8\uB2E4.'
  };
  const OVERLAY_POSITIONS = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];
  const app = {
    mode: 'idle',
    items: [],
    checked: [],
    filter: 'all',
    batchState: null,
    pageTitle: '',
    existingReady: false,
    existingRequestId: 0,
    existing: new Set(),
    root: null,
    refs: null,
    statusCollapsed: true,
    isDownloading: false,
    statusPoll: null,
    toastTimer: null,
    pageObserver: null,
    pageTimer: null,
    pageStop: null,
    sheetRight: 16,
    sheetDrag: null,
    sheetIgnoreToggleUntil: 0,
    removingBatchItem: false,
    handleResize: null,
    siteId: '',
    createFolder: true,
    reverseOrder: false,
    inlineObserver: null,
    inlineTimer: null,
    inlineStyle: null,
    inlineTargets: new Map(),
    inlineButtons: new Map(),
    inlinePendingGroups: new Set(),
    failureHistory: [],
    resumeRecoveryKey: ''
  };

  const getUiConfig = () => window.__arcaDL?.getUiConfig?.() || { mode: 'panel' };
  const getUiMode = () => String(getUiConfig().mode || 'panel').trim();
  const isInlineMode = () => getUiMode() === 'inline';
  const supportsInlineButtons = () => Boolean(window.__arcaDL?.supportsInlineTargets?.());
  const getPageItems = () => window.__arcaDL?.getMediaItems?.() || [];
  const getPageTitle = () => window.__arcaDL?.getArticleTitle?.() || document.title || 'Arca';
  const getSiteDownloadConfig = () => window.__arcaDL?.getSiteDownloadConfig?.() || {};
  const getInlineTargets = () => window.__arcaDL?.getInlineTargets?.() || [];
  const invalidateInlineTargetsAvailability = () => window.__arcaDL?.invalidateInlineTargetsAvailability?.();
  const prepareInlineTarget = (id) => window.__arcaDL?.prepareInlineTarget?.(id) || null;
  const getSiteId = () => String(window.__arcaDL?.getSiteId?.() || location.hostname || '').trim();
  const hasVisibleBatch = (state) => Boolean(state?.status && state.status !== 'idle' && Array.isArray(state.items) && state.items.length);
  const isBatchDownloading = (state) => hasVisibleBatch(state) && state.status === 'downloading';
  const isBatchPaused = (state) => hasVisibleBatch(state) && state.status === 'paused';
  const isBatchPendingStatus = (status) => status === 'queued' || status === 'downloading' || status === 'action_required';
  const hasRetryCountdown = (state) => Array.isArray(state?.items) && state.items.some((item) =>
    item?.status === 'queued' &&
    Number.isFinite(item?.nextRetryAt) &&
    item.nextRetryAt > Date.now()
  );
  const normalizePageUrl = (value) => String(value || '').replace(/[?#].*$/, '');
  const isDedupDebugEnabled = () => {
    try {
      return window.localStorage?.getItem(DEBUG_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  };

  function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  function bindCurrentTabLink(link) {
    if (!link) return;
    link.addEventListener('click', (event) => {
      const href = String(link.getAttribute('href') || '').trim();
      if (!href || href === '#') {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      window.location.assign(href);
    });
  }
  function dedupDebugLog(label, payload) {
    if (!isDedupDebugEnabled()) return;
    try {
      console.log(`[ArcaDL][dedup][ui] ${label}`, payload);
    } catch {}
  }
  function getUrlBasename(url, suggestedBasename = '') {
    return getUrlFilename(url, suggestedBasename, location.href);
  }
  function replaceBasenameExtension(basename, nextExtension) {
    const normalizedBase = normalizeSuggestedBasename(basename) || 'media';
    const normalizedExt = sanitizeFilenamePart(String(nextExtension || '').replace(/^\.+/, ''), '').toLowerCase();
    if (!normalizedExt) return normalizedBase;
    return `${normalizedBase.replace(/\.[^.]+$/g, '')}.${normalizedExt}`;
  }
  function getCreateFolderValue(item) {
    if (typeof item?.createFolder === 'boolean') return item.createFolder;
    return app.createFolder !== false;
  }
  function shouldPrefixOrderedFilename(item) {
    return getCreateFolderValue(item) && getSiteDownloadConfig().prefixOrderInFolder === true;
  }
  function getOrderedFilenamePrefix(sourceOrder = 0) {
    const value = Math.max(0, Number.isInteger(sourceOrder) ? sourceOrder : 0) + 1;
    return `${String(value).padStart(3, '0')}_`;
  }
  function getItemBasename(item) { return getUrlBasename(item?.originalUrl || item?.url || '', item?.downloadBasename || ''); }
  function buildLocalFilename(title, item, extensionOverride = '') {
    const sourceOrder = Number.isInteger(item?.sourceIndex) ? item.sourceIndex : 0;
    const folder = sanitizeFilenamePart(item?.folderTitle || title || 'ArcaImages', 'ArcaImages');
    let basename = getItemBasename(item) || `media_${sourceOrder + 1}`;
    if (extensionOverride) basename = replaceBasenameExtension(basename, extensionOverride);
    if (getCreateFolderValue(item)) {
      const prefixedBasename = shouldPrefixOrderedFilename(item)
        ? `${getOrderedFilenamePrefix(sourceOrder)}${basename}`
        : basename;
      return `ArcaDownload/${folder}/${prefixedBasename}`;
    }
    return `ArcaDownload/${folder}-${basename}`;
  }
  function getItemStorageKey(title, item, extensionOverride = '') {
    return buildLocalFilename(title, item, extensionOverride).toLowerCase();
  }
  function getDedupDebugItemSnapshot(title, item) {
    return {
      storageKey: getItemStorageKey(title, item),
      basename: getItemBasename(item),
      sourceIndex: Number.isInteger(item?.sourceIndex) ? item.sourceIndex : null,
      folderTitle: item?.folderTitle || title || '',
      createFolder: getCreateFolderValue(item),
      prefixOrderInFolder: shouldPrefixOrderedFilename(item),
      url: item?.originalUrl || item?.url || '',
      downloadBasename: item?.downloadBasename || ''
    };
  }
  function getItemSelectionKey(item) {
    return item?.originalUrl || item?.url || getItemBasename(item);
  }
  function areSameSelectionItems(currentItems, nextItems) {
    const left = Array.isArray(currentItems) ? currentItems : [];
    const right = Array.isArray(nextItems) ? nextItems : [];
    if (left.length !== right.length) return false;

    return left.every((item, index) => {
      const candidate = right[index];
      return (
        getItemSelectionKey(item) === getItemSelectionKey(candidate) &&
        String(item?.type || '') === String(candidate?.type || '') &&
        String(item?.folderTitle || '') === String(candidate?.folderTitle || '') &&
        String(item?.downloadBasename || '') === String(candidate?.downloadBasename || '')
      );
    });
  }
  function toDownloadRequestItem(item, title) {
    const downloadConfig = getSiteDownloadConfig();
    return {
      url: item?.originalUrl || item?.url || '',
      previewUrl: item?.previewUrl || '',
      type: item?.type,
      folderTitle: item?.folderTitle || title || '',
      pageUrl: String(item?.pageUrl || location.href || ''),
      pageTitle: title || item?.pageTitle || item?.folderTitle || '',
      sourceIndex: item?.sourceIndex,
      downloadBasename: item?.downloadBasename,
      createFolder: getCreateFolderValue(item),
      prefixOrderInFolder: downloadConfig.prefixOrderInFolder === true,
      downloadParallelism: Number.isFinite(downloadConfig.parallelism) ? downloadConfig.parallelism : undefined,
      interDownloadDelayMs: Number.isFinite(downloadConfig.interDownloadDelayMs) ? downloadConfig.interDownloadDelayMs : undefined
    };
  }
  function toBatchUiItem(item) {
    return {
      order: Number.isInteger(item?.order) ? item.order : -1,
      originalUrl: item?.url || item?.originalUrl || '',
      previewUrl: item?.previewUrl || '',
      type: item?.type,
      progress: item?.progress,
      status: item?.status,
      nextRetryAt: Number.isFinite(item?.nextRetryAt) ? item.nextRetryAt : 0,
      downloadBasename: item?.downloadBasename,
      folderTitle: item?.folderTitle || '',
      createFolder: typeof item?.createFolder === 'boolean' ? item.createFolder : true
    };
  }
  function prepareOrderedDownloads(items) {
    const list = Array.isArray(items) ? items : [];
    const ordered = list
      .map((item, index) => ({
        item: { ...item },
        sourceIndex: Number.isInteger(item?.sourceIndex) ? item.sourceIndex : index,
        originalIndex: index
      }))
      .sort((left, right) => {
        if (left.sourceIndex !== right.sourceIndex) {
          return app.reverseOrder ? right.sourceIndex - left.sourceIndex : left.sourceIndex - right.sourceIndex;
        }
        return app.reverseOrder ? right.originalIndex - left.originalIndex : left.originalIndex - right.originalIndex;
      })
      .map(({ item }, index) => (
        app.reverseOrder
          ? { ...item, sourceIndex: index }
          : item
      ));

    return ordered;
  }
  async function loadSitePreferences() {
    const siteId = getSiteId();
    app.siteId = siteId;
    app.createFolder = true;
    app.reverseOrder = false;
    if (!siteId || !chrome.storage?.local) {
      return;
    }
    try {
      const stored = await chrome.storage.local.get(SITE_PREFERENCES_KEY);
      const preferences = stored?.[SITE_PREFERENCES_KEY];
      if (!preferences || typeof preferences !== 'object') {
        return;
      }
      if (typeof preferences[siteId]?.createFolder === 'boolean') {
        app.createFolder = preferences[siteId].createFolder;
      }
      if (typeof preferences[siteId]?.reverseOrder === 'boolean') {
        app.reverseOrder = preferences[siteId].reverseOrder;
      }
    } catch {
      app.createFolder = true;
      app.reverseOrder = false;
    }
  }
  async function persistSitePreferences() {
    if (!app.siteId || !chrome.storage?.local) {
      return;
    }
    try {
      const stored = await chrome.storage.local.get(SITE_PREFERENCES_KEY);
      const preferences = stored?.[SITE_PREFERENCES_KEY] && typeof stored[SITE_PREFERENCES_KEY] === 'object'
        ? { ...stored[SITE_PREFERENCES_KEY] }
        : {};
      preferences[app.siteId] = {
        ...(preferences[app.siteId] && typeof preferences[app.siteId] === 'object' ? preferences[app.siteId] : {}),
        createFolder: app.createFolder !== false,
        reverseOrder: app.reverseOrder === true
      };
      await chrome.storage.local.set({ [SITE_PREFERENCES_KEY]: preferences });
    } catch {
      // Ignore storage failures and continue with the in-memory preference.
    }
  }
  function getOverlayButtonPosition() {
    const position = String(getUiConfig().placement?.position || 'top-right').trim();
    return OVERLAY_POSITIONS.includes(position) ? position : 'top-right';
  }
  function getBatchRemainingCount(state) {
    if (!state?.items?.length) return 0;
    return Math.max(0, state.total - state.completed);
  }
  function getBatchPendingItems(state) {
    return Array.isArray(state?.items) ? state.items.filter((item) => isBatchPendingStatus(item.status)) : [];
  }
  function getPendingSelectionKeys(title, state) {
    const keys = new Set();
    getBatchPendingItems(state).forEach((item) => {
      const key = getItemStorageKey(item.folderTitle || title, item);
      if (key) keys.add(key);
    });
    return keys;
  }
  function getCompletedSelectionKeys(title, state) {
    const keys = new Set();
    if (!Array.isArray(state?.items)) {
      return keys;
    }
    state.items.forEach((item) => {
      if (item?.status !== 'complete') {
        return;
      }
      const key = getItemStorageKey(item.folderTitle || title, item);
      if (key) keys.add(key);
    });
    return keys;
  }
  function getBatchPercent(state) {
    return state?.total ? Math.round((state.completed / state.total) * 100) : 0;
  }
  function formatRetryWait(waitMs) {
    if (!(waitMs > 0)) {
      return '';
    }

    const totalSeconds = Math.max(1, Math.ceil(waitMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    if (minutes > 0 && seconds > 0) {
      return `${minutes}분 ${seconds}초`;
    }
    if (minutes > 0) {
      return `${minutes}분`;
    }
    return `${totalSeconds}초`;
  }
  async function collectRecoveryMediaForPage(pageUrl) {
    if (!window.__arcaDL?.collectMediaForPageUrl) {
      return [];
    }

    const deadline = Date.now() + RECOVERY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const items = await window.__arcaDL.collectMediaForPageUrl(pageUrl);
      if (Array.isArray(items) && items.length) {
        return items;
      }
      await sleep(RECOVERY_POLL_MS);
    }

    return [];
  }
  async function maybeResumePausedBatch(state) {
    const recovery = isBatchPaused(state) && state?.manualRecovery && typeof state.manualRecovery === 'object'
      ? state.manualRecovery
      : null;
    if (!recovery?.pageUrl || !window.__arcaDL?.collectMediaForPageUrl) {
      if (!isBatchPaused(state)) app.resumeRecoveryKey = '';
      return;
    }

    const targetPageUrl = normalizePageUrl(recovery.pageUrl);
    const currentPageUrl = normalizePageUrl(location.href || '');
    if (!targetPageUrl || targetPageUrl !== currentPageUrl) {
      return;
    }

    const recoveryKey = `${targetPageUrl}::${recovery.failedOrder ?? ''}::${recovery.updatedAt || 0}`;
    if (app.resumeRecoveryKey === recoveryKey) {
      return;
    }

    app.resumeRecoveryKey = recoveryKey;

    try {
      const items = await collectRecoveryMediaForPage(targetPageUrl);
      const response = await resumePausedBatchFromPage(targetPageUrl, items);
      if (response?.ok) {
        showToast(TEXT.recoveryResumed);
        return;
      }
    } catch {
      // Keep the paused UI visible and let the user reopen the page manually again.
    }

    setTimeout(() => {
      if (app.resumeRecoveryKey === recoveryKey && isBatchPaused(app.batchState)) {
        app.resumeRecoveryKey = '';
      }
    }, 1500);
  }
  function getSheetArrowMarkup() {
    return '<svg viewBox="0 0 20 20" aria-hidden="true" style="width:16px;height:16px;display:block;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round"><path d="m5 7 5 6 5-6"></path></svg>';
  }
  function getSheetWidth() {
    const refs = app.refs;
    if (refs?.sheet?.isConnected) {
      const width = Math.round(refs.sheet.getBoundingClientRect().width || refs.sheet.offsetWidth || 0);
      if (width > 0) return width;
    }
    return Math.max(0, Math.min(360, window.innerWidth - 32));
  }
  function clampSheetRight(value, width = getSheetWidth()) {
    const numericValue = Number.isFinite(value) ? value : 16;
    const minRight = 16;
    const maxRight = Math.max(minRight, window.innerWidth - width - 16);
    return Math.max(minRight, Math.min(maxRight, numericValue));
  }
  function getSheetRight(width = getSheetWidth()) {
    app.sheetRight = clampSheetRight(app.sheetRight, width);
    return app.sheetRight;
  }
  function applySheetPosition() {
    if (!app.refs?.sheet) return;
    const width = getSheetWidth();
    const sheetRight = getSheetRight(width);
    app.refs.sheet.style.left = 'auto';
    app.refs.sheet.style.right = `${sheetRight}px`;
    if (app.refs.toast) app.refs.toast.style.right = `${sheetRight}px`;
  }
  function getCurrentSheetHeight() {
    const sheet = app.refs?.sheet;
    if (!sheet?.classList.contains('show')) return 0;
    return Math.round(sheet.getBoundingClientRect().height || 0);
  }
  function layoutSelectionPanel(sheetHeight = 0) {
    if (!app.refs?.panel) return;
    const refs = app.refs;
    const canShowPanel = app.mode === 'selection' && !isInlineMode();
    const bottomOffset = 16 + Math.max(0, sheetHeight) + 12;
    const maxHeight = Math.max(260, window.innerHeight - bottomOffset - 16);
    const sheetRight = getSheetRight();

    refs.panel.style.position = 'fixed';
    refs.panel.style.top = 'auto';
    refs.panel.style.left = 'auto';
    refs.panel.style.right = `${sheetRight}px`;
    refs.panel.style.bottom = `${bottomOffset}px`;
    refs.panel.style.width = 'min(360px, calc(100vw - 32px))';
    refs.panel.style.height = 'auto';
    refs.panel.style.maxHeight = `${maxHeight}px`;
    refs.panel.style.border = '1px solid rgba(255,255,255,.08)';
    refs.panel.style.borderRadius = '18px';
    refs.panel.style.background = 'rgba(29,31,36,.98)';
    refs.panel.style.boxShadow = '0 20px 50px rgba(0,0,0,.34)';
    refs.panel.style.backdropFilter = 'blur(18px)';
    refs.panel.style.zIndex = '2147483647';
    refs.panel.style.opacity = canShowPanel ? '1' : '0';
    refs.panel.style.pointerEvents = canShowPanel ? 'auto' : 'none';
    refs.panel.style.transform = canShowPanel ? 'translateY(0)' : 'translateY(16px)';
    refs.panel.style.transition = 'opacity .18s ease, transform .18s ease';
  }
  function syncFloatingLayout() {
    applySheetPosition();
    const sheetHeight = getCurrentSheetHeight();
    layoutSelectionPanel(sheetHeight);
    if (app.refs?.toast) app.refs.toast.style.bottom = `${16 + sheetHeight + 12}px`;
  }
  function stopSheetDrag() {
    if (!app.sheetDrag) return;
    window.removeEventListener('pointermove', onSheetDragMove);
    window.removeEventListener('pointerup', stopSheetDrag);
    window.removeEventListener('pointercancel', stopSheetDrag);
    app.refs?.sheet?.classList.remove('dragging');
    if (app.sheetDrag.dragged) app.sheetIgnoreToggleUntil = Date.now() + 250;
    app.sheetDrag = null;
  }
  function onSheetDragMove(event) {
    if (!app.sheetDrag) return;
    const deltaX = event.clientX - app.sheetDrag.startX;
    if (!app.sheetDrag.dragged && Math.abs(deltaX) > 3) {
      app.sheetDrag.dragged = true;
    }
    app.sheetRight = clampSheetRight(app.sheetDrag.startRight - deltaX);
    syncFloatingLayout();
  }
  function startSheetDrag(event) {
    if (event.button !== 0) return;
    const handle = event.currentTarget;
    event.preventDefault();
    event.stopPropagation();
    app.sheetDrag = {
      startX: event.clientX,
      startRight: getSheetRight(),
      dragged: false
    };
    app.refs?.sheet?.classList.add('dragging');
    if (handle?.setPointerCapture) {
      try { handle.setPointerCapture(event.pointerId); } catch {}
    }
    window.addEventListener('pointermove', onSheetDragMove);
    window.addEventListener('pointerup', stopSheetDrag);
    window.addEventListener('pointercancel', stopSheetDrag);
  }
  function handleWindowResize() {
    syncFloatingLayout();
  }
  function showToast(message) {
    const refs = ensureUI();
    if (!refs.toast) return;
    if (app.toastTimer) clearTimeout(app.toastTimer);
    refs.toast.textContent = String(message || '').trim();
    refs.toast.classList.add('show');
    app.toastTimer = setTimeout(() => {
      refs.toast?.classList.remove('show');
      app.toastTimer = null;
    }, 2200);
  }
  function notifyDownloadStart(count) {
    if (!(count > 0)) return;
    showToast(count > 1 ? `${count}\uAC1C \uB2E4\uC6B4\uB85C\uB4DC\uB97C \uC2DC\uC791\uD588\uC2B5\uB2C8\uB2E4` : '\uB2E4\uC6B4\uB85C\uB4DC\uB97C \uC2DC\uC791\uD588\uC2B5\uB2C8\uB2E4');
  }
  function getInlineTargetErrorMessage(target) {
    const error = String(target?.error || '').trim().toLowerCase();
    if (!error) return '글 정보를 불러오지 못했습니다';
    if (error.includes('429')) return '요청이 많아 잠시 후 다시 시도해 주세요';
    if (error.includes('403') || error.includes('401')) return '이 글은 접근 권한이 없습니다';
    return '글 정보를 불러오지 못했습니다';
  }

  function requestState() {
    return new Promise((resolve) => chrome.runtime.sendMessage({ action: 'getState' }, (response) => resolve(response?.state || null)));
  }
  function resumePausedBatchFromPage(pageUrl, items) {
    return new Promise((resolve) => chrome.runtime.sendMessage(
      { action: 'resumePausedBatchFromPage', pageUrl, items },
      (response) => resolve(response || null)
    ));
  }
  function requestFailureHistory() {
    return new Promise((resolve) => chrome.runtime.sendMessage(
      { action: 'getFailureHistory', siteId: getSiteId() },
      (response) => resolve(Array.isArray(response?.history) ? response.history : [])
    ));
  }
  function clearFailureHistory() {
    return new Promise((resolve) => chrome.runtime.sendMessage(
      { action: 'clearFailureHistory', siteId: getSiteId() },
      () => resolve()
    ));
  }
  function checkExisting(title, items) {
    const payload = {
      action: 'checkExisting',
      title,
      siteId: getSiteId(),
      debugDedup: isDedupDebugEnabled(),
      items
    };
    dedupDebugLog('checkExisting:request', {
      title,
      siteId: payload.siteId,
      items: items.map((item) => getDedupDebugItemSnapshot(title, item))
    });
    return new Promise((resolve) => chrome.runtime.sendMessage(payload, (response) => {
      const lookup = response?.existsByKey || {};
      dedupDebugLog('checkExisting:response', {
        title,
        siteId: payload.siteId,
        lookup
      });
      resolve(lookup);
    }));
  }
  function sendDownloads(action, downloads, title) {
    return new Promise((resolve) => chrome.runtime.sendMessage({ action, downloads, title }, async () => {
      const state = await requestState();
      applyBackgroundState(state);
      resolve();
    }));
  }
  function removeBatchItem(order) {
    if (!Number.isInteger(order) || app.removingBatchItem) {
      return Promise.resolve();
    }

    app.removingBatchItem = true;
    render();

    return new Promise((resolve) => chrome.runtime.sendMessage({ action: 'removeBatchItem', order }, async () => {
      const state = await requestState();
      app.removingBatchItem = false;
      applyBackgroundState(state);
      resolve();
    }));
  }
  function reportDownloadResult(item, title, success, error = '') {
    return new Promise((resolve) => chrome.runtime.sendMessage({
      action: 'reportDownloadResult',
      item: toDownloadRequestItem(item, title),
      success,
      error
    }, () => resolve()));
  }
  function chromeDownload(options) {
    return new Promise((resolve) => {
      if (!chrome.downloads?.download) {
        resolve({ downloadId: null, error: 'downloads-api-unavailable' });
        return;
      }
      chrome.downloads.download(options, (downloadId) => resolve({ downloadId, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : null }));
    });
  }

  function stopStatusPolling() { if (app.statusPoll) clearInterval(app.statusPoll); app.statusPoll = null; }
  function startStatusPolling() {
    if (app.statusPoll) return;
    app.statusPoll = setInterval(async () => applyBackgroundState(await requestState()), PANEL_POLL_MS);
  }
  function syncStatusPolling(state = app.batchState) {
    const shouldPoll =
      (hasVisibleBatch(state) && state?.status === 'downloading') ||
      hasRetryCountdown(state);

    if (shouldPoll) {
      startStatusPolling();
      return;
    }

    stopStatusPolling();
  }
  function stopPageWatching() {
    if (app.pageObserver) app.pageObserver.disconnect();
    if (app.pageTimer) clearTimeout(app.pageTimer);
    if (app.pageStop) clearTimeout(app.pageStop);
    app.pageObserver = null;
    app.pageTimer = null;
    app.pageStop = null;
  }
  function stopInlineWatching() {
    if (app.inlineObserver) app.inlineObserver.disconnect();
    if (app.inlineTimer) clearTimeout(app.inlineTimer);
    app.inlineObserver = null;
    app.inlineTimer = null;
  }
  function disposeInlineEntry(entry) {
    if (!entry) return;
    if (entry.engine === 'tweet_action_bar') {
      entry.slot?.remove();
      return;
    }
    if (entry.engine === 'arca_list_cell') {
      entry.button?.remove();
      entry.mount?.classList?.remove('arca-dl-inline-cell');
      return;
    }
    entry.button?.remove();
    entry.mount?.classList?.remove('arca-dl-inline-anchor');
  }
  function clearInlineButtons() {
    Array.from(app.inlineButtons.values()).forEach((entry) => disposeInlineEntry(entry));
    app.inlineButtons.clear();
    app.inlineTargets.clear();
    app.inlinePendingGroups.clear();
  }

  function ensureInlineStyle() {
    if (app.inlineStyle?.isConnected) return app.inlineStyle;
    let style = document.getElementById('arca-dl-inline-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'arca-dl-inline-style';
      style.textContent = '.arca-dl-inline-anchor{position:relative!important}.arca-dl-inline-cell{display:inline-flex!important;align-items:center;gap:6px}.arca-dl-inline-slot{display:flex;align-items:center;justify-content:center;padding-left:6px}.arca-dl-inline-btn{position:relative;z-index:2147483646;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:transform .15s ease,opacity .15s ease,background-color .15s ease,border-color .15s ease}.arca-dl-inline-btn svg{pointer-events:none;display:block}.arca-dl-inline-btn.pending,.arca-dl-inline-btn:disabled{cursor:wait;opacity:.68}.arca-dl-inline-btn .count{position:absolute;top:-5px;right:-5px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;display:inline-flex;align-items:center;justify-content:center;background:var(--arca-dl-badge,#5865f2);color:#fff;font:700 10px/1 sans-serif}.arca-dl-inline-btn .count.hidden{display:none}.arca-dl-inline-btn.engine-overlay{position:absolute;min-width:32px;height:32px;padding:0 8px;border:0;border-radius:999px;background:rgba(17,24,39,.88);color:#fff;font:600 12px/1 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.3);backdrop-filter:blur(8px)}.arca-dl-inline-btn.engine-overlay:hover:not(:disabled){background:rgba(37,99,235,.92)}.arca-dl-inline-btn.engine-overlay.pos-top-right{top:8px;right:8px}.arca-dl-inline-btn.engine-overlay.pos-top-left{top:8px;left:8px}.arca-dl-inline-btn.engine-overlay.pos-bottom-right{right:8px;bottom:8px}.arca-dl-inline-btn.engine-overlay.pos-bottom-left{left:8px;bottom:8px}.arca-dl-inline-btn.engine-action,.arca-dl-inline-btn.engine-list{width:34px;height:34px;padding:0;border-radius:999px;border:1px solid var(--arca-dl-border,#5865f2);background:var(--arca-dl-bg,rgba(88,101,242,.08));color:var(--arca-dl-icon,#5865f2)}.arca-dl-inline-btn.engine-list{width:24px;height:24px;flex:0 0 auto}.arca-dl-inline-btn.engine-action:hover:not(:disabled),.arca-dl-inline-btn.engine-list:hover:not(:disabled){background:var(--arca-dl-hover,rgba(88,101,242,.14));transform:translateY(-1px)}.arca-dl-inline-btn.engine-list svg{width:15px;height:15px}';
      document.documentElement.appendChild(style);
    }
    app.inlineStyle = style;
    return style;
  }
  function getInlineButtonMarkup(actionBar) {
    const icon = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 4v9m0 0-4-4m4 4 4-4M5 17.5v1A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path></svg>';
    return actionBar ? `${icon}<span class="count hidden"></span>` : `<span class="label"></span><span class="count hidden"></span>`;
  }
  function resolveButtonStyle(target) {
    const style = target.buttonStyle || {};
    return {
      borderColor: style.borderColor || '#5865f2',
      iconColor: style.iconColor || '#5865f2',
      backgroundColor: style.backgroundColor || 'rgba(88,101,242,.08)',
      hoverBackgroundColor: style.hoverBackgroundColor || 'rgba(88,101,242,.14)',
      badgeColor: style.badgeColor || '#5865f2'
    };
  }
  function findActionSlotTemplate(mount, selector) {
    const candidates = Array.from(mount.children).filter((child) => {
      try { return Boolean(child.querySelector(selector)); } catch { return false; }
    });
    return candidates.length ? candidates[candidates.length - 1] : null;
  }
  function findActionButtonTemplate(mount, selector) {
    try {
      const candidates = Array.from(mount.querySelectorAll(selector));
      return candidates.length ? candidates[candidates.length - 1] : null;
    } catch {
      return null;
    }
  }
  function createInlineEntry(id, target) {
    const placement = target.placement || {};
    const mount = target.mount;
    if (!mount || !mount.isConnected) return null;
    let slot = null;
    let button = null;
    if (placement.engine === 'tweet_action_bar') {
      const referenceSelector = placement.referenceButtonSelector || 'button[class^="css-175"]';
      const slotInsertMode = String(placement.slotInsertMode || 'after_reference').trim();
      const slotTemplate = findActionSlotTemplate(mount, referenceSelector);
      const buttonTemplate = findActionButtonTemplate(mount, referenceSelector);
      slot = slotTemplate?.cloneNode(false) || document.createElement('div');
      slot.className = slot.className || 'css-175oi2r r-18u37iz r-1h0z5md r-13awgt0';
      slot.removeAttribute('id');
      slot.removeAttribute('data-testid');
      slot.classList.add('arca-dl-inline-slot');
      button = buttonTemplate?.cloneNode(false) || document.createElement('button');
      button.type = 'button';
      button.className = button.className || 'css-175oi2r r-1777fci r-bt1l66 r-bztko3 r-lrvibr r-1loqt21 r-1ny4l3l';
      button.removeAttribute('id');
      button.removeAttribute('name');
      button.removeAttribute('style');
      button.removeAttribute('data-testid');
      button.removeAttribute('aria-pressed');
      button.removeAttribute('aria-expanded');
      button.removeAttribute('aria-haspopup');
      button.classList.add('arca-dl-inline-btn', 'engine-action');
      button.innerHTML = getInlineButtonMarkup(true);
      button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); void startInlineDownload(id); });
      slot.appendChild(button);
      if (slotInsertMode === 'append') {
        mount.appendChild(slot);
      } else if (slotTemplate?.parentNode === mount) {
        mount.insertBefore(slot, slotTemplate.nextSibling);
      } else {
        mount.appendChild(slot);
      }
    } else if (placement.engine === 'arca_list_cell') {
      slot = mount;
      mount.classList.add('arca-dl-inline-cell');
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'arca-dl-inline-btn engine-list';
      button.innerHTML = getInlineButtonMarkup(true);
      button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); void startInlineDownload(id); });
      mount.insertBefore(button, mount.firstChild);
    } else {
      slot = mount;
      mount.classList.add('arca-dl-inline-anchor');
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'arca-dl-inline-btn engine-overlay';
      button.innerHTML = getInlineButtonMarkup(false);
      button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); void startInlineDownload(id); });
      mount.appendChild(button);
    }
    return { mount, slot, button, engine: placement.engine || 'overlay_anchor' };
  }
  function removeInlineEntry(id) {
    const entry = app.inlineButtons.get(id);
    disposeInlineEntry(entry);
    app.inlineButtons.delete(id);
  }
  function configureInlineButton(entry, target) {
    const placement = target.placement || {};
    const button = entry.button;
    const busy = app.inlinePendingGroups.has(target.groupKey);
    const loading = Boolean(target.isLoading);
    const styles = resolveButtonStyle(target);
    const countNode = button.querySelector('.count');
    button.disabled = busy;
    button.classList.toggle('pending', busy || loading);
    button.title = busy || loading ? `${target.tooltip || 'Download'} (${TEXT.processing})` : (target.tooltip || '');
    button.setAttribute('aria-label', target.tooltip || 'Download media');
    button.style.setProperty('--arca-dl-border', styles.borderColor);
    button.style.setProperty('--arca-dl-icon', styles.iconColor);
    button.style.setProperty('--arca-dl-bg', styles.backgroundColor);
    button.style.setProperty('--arca-dl-hover', styles.hoverBackgroundColor);
    button.style.setProperty('--arca-dl-badge', styles.badgeColor);
    if (placement.engine === 'tweet_action_bar' || placement.engine === 'arca_list_cell') {
      button.classList.remove('engine-overlay');
      if (placement.engine === 'arca_list_cell') {
        button.classList.remove('engine-action');
        button.classList.add('engine-list');
      } else {
        button.classList.remove('engine-list');
        button.classList.add('engine-action');
      }
    } else {
      button.classList.remove('engine-action');
      button.classList.remove('engine-list');
      button.classList.add('engine-overlay');
      OVERLAY_POSITIONS.forEach((position) => button.classList.remove(`pos-${position}`));
      button.classList.add(`pos-${getOverlayButtonPosition()}`);
      const labelNode = button.querySelector('.label');
      if (labelNode) labelNode.textContent = target.label || 'DL';
    }
    if (countNode) {
      if (target.count > 1) {
        countNode.textContent = String(target.count);
        countNode.classList.remove('hidden');
      } else {
        countNode.textContent = '';
        countNode.classList.add('hidden');
      }
    }
  }
  function syncInlineButtons() {
    if (!supportsInlineButtons()) return;
    ensureInlineStyle();
    const nextTargets = new Map();
    getInlineTargets().forEach((target) => { if (target.mount?.isConnected) nextTargets.set(target.id, target); });
    app.inlineTargets = nextTargets;
    Array.from(app.inlineButtons.keys()).forEach((id) => { if (!nextTargets.has(id)) removeInlineEntry(id); });
    nextTargets.forEach((target, id) => {
      let entry = app.inlineButtons.get(id);
      const nextEngine = target.placement?.engine || 'overlay_anchor';
      if (!entry || entry.mount !== target.mount || entry.engine !== nextEngine) {
        removeInlineEntry(id);
        entry = createInlineEntry(id, target);
        if (!entry) return;
        app.inlineButtons.set(id, entry);
      }
      configureInlineButton(entry, target);
    });
  }
  function startInlineWatching() {
    if (!supportsInlineButtons()) return;
    if (app.inlineObserver) { scheduleInlineSync(); return; }
    const target = document.body || document.documentElement;
    if (!target) return;
    app.inlineObserver = new MutationObserver(() => scheduleInlineSync());
    app.inlineObserver.observe(target, { childList: true, subtree: true });
    scheduleInlineSync();
  }
  function scheduleInlineSync() {
    if (app.inlineTimer) return;
    app.inlineTimer = setTimeout(() => { app.inlineTimer = null; syncInlineButtons(); }, WATCH_DEBOUNCE_MS);
  }
  function ensureUI() {
    if (app.refs) return app.refs;
    const root = document.getElementById(ROOT_ID) || Object.assign(document.createElement('div'), { id: ROOT_ID });
    if (!root.isConnected) document.body.appendChild(root);
    const shadow = root.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>*{box-sizing:border-box}.panel{position:fixed;top:0;right:0;z-index:2147483646;width:360px;height:100vh;background:#2b2d31;color:#e8e8e8;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .2s ease;box-shadow:-4px 0 20px rgba(0,0,0,.45)}.panel.open{transform:translateX(0)}.toolbar,.bottom{padding:12px 14px;border-bottom:1px solid #3a3c41}.toolbar{display:flex;flex-wrap:wrap;gap:6px}.chip{padding:4px 10px;border-radius:999px;border:1px solid #3a3c41;background:transparent;color:#b0b3b8;cursor:pointer;font:600 11px/1 sans-serif}.chip.active{background:#5865f2;border-color:#5865f2;color:#fff}.gridWrap{flex:1;overflow:auto;padding:12px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.item{position:relative;aspect-ratio:1;background:#1e1f22;border-radius:8px;overflow:hidden;border:2px solid transparent;cursor:pointer}.item.checked{border-color:#5865f2}.item.readonly{cursor:default}.item.disabled{opacity:.72;cursor:not-allowed}.item img{width:100%;height:100%;object-fit:cover;display:block}.check{position:absolute;top:4px;left:4px;width:20px;height:20px;border-radius:4px;background:rgba(0,0,0,.5);border:2px solid #72767d}.item.checked .check{background:#5865f2;border-color:#5865f2}.item.checked .check::after{content:"\\2713";display:block;color:#fff;font:700 12px/16px sans-serif;text-align:center}.badge2{position:absolute;top:4px;right:4px;min-width:38px;height:20px;padding:0 6px;border-radius:10px;background:rgba(88,101,242,.92);color:#fff;font:700 10px/20px sans-serif;text-align:center}.badge2.failed{background:rgba(237,66,69,.92)}.badge2.cancelled{background:rgba(114,118,125,.92)}.tileRemove{position:absolute;top:4px;left:4px;width:22px;height:22px;border:0;border-radius:999px;background:rgba(0,0,0,.6);color:#fff;font:700 14px/1 sans-serif;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background-color .15s ease,opacity .15s ease}.tileRemove:hover{background:rgba(237,66,69,.92)}.tileRemove:disabled{opacity:.45;cursor:not-allowed}.type{position:absolute;right:4px;bottom:4px;padding:1px 5px;border-radius:3px;background:rgba(0,0,0,.7);color:#fff;font:700 9px/1.4 sans-serif}.play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:28px;height:28px;border-radius:50%;background:rgba(0,0,0,.6)}.play::after{content:'';position:absolute;top:7px;left:10px;border-top:7px solid transparent;border-bottom:7px solid transparent;border-left:11px solid #fff}.bottom{border-top:1px solid #3a3c41;border-bottom:0}.row{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;color:#b0b3b8;font:12px/1.2 sans-serif}.btn{padding:8px 14px;border:0;border-radius:10px;background:#5865f2;color:#fff;font:600 13px/1 sans-serif;cursor:pointer}.btn:disabled{opacity:.4;cursor:not-allowed}.btn.cancel{background:#ed4245}.bar{height:6px;border-radius:999px;background:#1e1f22;overflow:hidden}.fill{height:100%;width:0;background:#5865f2}.section{margin-bottom:12px}.section.hidden{display:none}.sectionTitle{margin-bottom:8px;color:#b0b3b8;font:700 11px/1 sans-serif}.sectionHeader{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.sectionAction{padding:0;border:0;background:none;color:#9ca3af;font:600 11px/1.2 sans-serif;cursor:pointer}.sectionAction:hover{color:#f3f4f6}.sheet{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:min(360px,calc(100vw - 32px));max-height:min(72vh,calc(100vh - 32px));border:1px solid rgba(255,255,255,.08);border-radius:18px;background:rgba(29,31,36,.96);color:#f3f4f6;box-shadow:0 20px 50px rgba(0,0,0,.34);backdrop-filter:blur(18px);overflow:hidden;display:none;flex-direction:column}.sheet.show{display:flex}.sheet.dragging{user-select:none}.sheetHeader{width:100%;padding:10px 16px 14px;border:0;background:linear-gradient(180deg,rgba(88,101,242,.16),rgba(88,101,242,.04));display:flex;align-items:flex-start;justify-content:space-between;gap:12px;color:inherit;cursor:pointer;flex:0 0 auto}.sheetHeading{flex:1;display:flex;flex-direction:column;gap:6px;align-items:stretch}.sheetHandle{position:relative;align-self:center;width:46px;height:5px;display:flex;align-items:center;justify-content:center;cursor:grab;touch-action:none}.sheetHandle::before{content:'';position:absolute;left:50%;top:50%;width:72px;height:20px;transform:translate(-50%,-50%)}.sheetHandle::after{content:'';display:block;width:46px;height:5px;border-radius:999px;background:rgba(255,255,255,.18)}.sheet.dragging .sheetHandle{cursor:grabbing}.sheet.dragging .sheetHandle::after{background:rgba(255,255,255,.24)}.sheetTitle{align-self:flex-start;text-align:left;font:700 14px/1.1 sans-serif}.sheetArrow{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:999px;background:rgba(255,255,255,.06);font:700 13px/1 sans-serif;transition:transform .18s ease;transform:rotate(180deg)}.sheet.collapsed .sheetArrow{transform:none}.sheetProgress{padding:10px 16px 14px;display:flex;align-items:center;gap:10px;flex:0 0 auto}.sheetProgress .bar{flex:1}.sheetBody{padding:0 16px 16px;display:flex;flex-direction:column;gap:12px;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain}.sheet.collapsed .sheetBody{display:none}.sheetSummary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.sheetOption{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:14px;background:rgba(255,255,255,.04)}.sheetOptionText{display:flex;flex-direction:column;gap:4px}.sheetOptionTitle{color:#f3f4f6;font:700 12px/1.2 sans-serif}.sheetOptionMeta{color:#9ca3af;font:11px/1.25 sans-serif}.sheetOptionControl{position:relative;display:inline-flex;align-items:center;justify-content:center;width:42px;height:24px;flex:0 0 auto}.sheetOptionInput{position:absolute;inset:0;opacity:0;cursor:pointer;margin:0}.sheetOptionTrack{position:relative;width:42px;height:24px;border-radius:999px;background:rgba(255,255,255,.14);transition:background-color .18s ease,opacity .18s ease}.sheetOptionTrack::after{content:'';position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .18s ease}.sheetOptionInput:checked + .sheetOptionTrack{background:rgba(88,101,242,.9)}.sheetOptionInput:checked + .sheetOptionTrack::after{transform:translateX(18px)}.sheetOptionInput:disabled + .sheetOptionTrack{opacity:.45}.sheetMedia.hidden,.sheetFailures.hidden{display:none}.sheetMediaGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.sheetFailuresList{display:flex;flex-direction:column;gap:8px}.sheetFailureItem{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.04)}.sheetFailureThumb{width:48px;height:48px;border-radius:10px;overflow:hidden;background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;color:#9ca3af;font:700 10px/1 sans-serif}.sheetFailureThumb img{width:100%;height:100%;object-fit:cover;display:block}.sheetFailureMeta{min-width:0;display:flex;flex-direction:column;gap:4px}.sheetFailureTitle{color:#f3f4f6;font:700 12px/1.25 sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sheetFailureName,.sheetFailureReason{color:#9ca3af;font:11px/1.3 sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.sheetFailureLink{display:inline-flex;align-items:center;justify-content:center;min-width:48px;height:30px;padding:0 10px;border-radius:999px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:#f3f4f6;font:700 11px/1 sans-serif;text-decoration:none}.sheetFailureLink:hover{background:rgba(88,101,242,.12);border-color:rgba(88,101,242,.28)}.metric{padding:10px 12px;border-radius:12px;background:rgba(255,255,255,.04);display:flex;flex-direction:column;gap:6px}.metricLabel{color:#9ca3af;font:600 10px/1 sans-serif}.metricValue{font:700 16px/1 sans-serif;color:#fff}.sheetPercent{min-width:38px;padding-top:2px;text-align:right;color:#c6cad4;font:700 12px/1 sans-serif}.sheetActions{display:flex;justify-content:flex-end}.sheetActions .btn{min-width:84px}.sheetFooter{display:flex;align-items:center;justify-content:space-between;gap:12px;padding-top:2px;color:#8f95a3;font:11px/1.2 sans-serif}.sheetMetaActions{display:flex;align-items:center;gap:8px}.sheetVersion{display:inline-flex;align-items:center;justify-content:center;min-height:28px;padding:0 10px;border-radius:999px;background:rgba(255,255,255,.05);color:#c6cad4;font:600 10px/1 sans-serif}.sheetLink{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:28px;padding:0 10px;border-radius:999px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.04);color:#f3f4f6;font:700 11px/1 sans-serif;text-decoration:none;transition:background-color .15s ease,border-color .15s ease}.sheetLink:hover{background:rgba(88,101,242,.12);border-color:rgba(88,101,242,.28)}.toast{position:fixed;right:16px;bottom:96px;z-index:2147483647;max-width:min(360px,calc(100vw - 32px));padding:12px 14px;border-radius:14px;background:rgba(17,24,39,.96);color:#fff;font:600 12px/1.35 sans-serif;box-shadow:0 16px 32px rgba(0,0,0,.28);opacity:0;transform:translateY(10px);pointer-events:none;transition:opacity .18s ease,transform .18s ease}.toast.show{opacity:1;transform:translateY(0)}</style>
      <div class="panel"><div class="toolbar"><button class="chip active" data-filter="all" type="button">${TEXT.all}</button><button class="chip" data-filter="image" type="button">${TEXT.image}</button><button class="chip" data-filter="video" type="button">${TEXT.video}</button><button class="chip" data-filter="gif" type="button">${TEXT.gif}</button></div><div class="gridWrap"><div class="section" id="mainSection"><div class="grid" id="grid"></div></div></div><div class="bottom"><div class="row"><span id="info">0${TEXT.selectedSuffix}</span><button class="btn" id="action" type="button" disabled>${TEXT.download}</button></div></div></div>
<div class="sheet collapsed"><button class="sheetHeader" id="sheetToggle" type="button"><div class="sheetHeading"><span class="sheetHandle" aria-hidden="true"></span><span class="sheetTitle">${TEXT.statusTitle}</span></div><span class="sheetArrow">\u2303</span></button><div class="sheetProgress"><div class="bar"><div class="fill" id="sheetFill"></div></div><span class="sheetPercent" id="sheetPercent">0%</span></div><div class="sheetBody"><div class="sheetSummary"><div class="metric"><span class="metricLabel">\uC804\uCCB4</span><strong class="metricValue" id="sheetTotal">0</strong></div><div class="metric"><span class="metricLabel">\uC644\uB8CC</span><strong class="metricValue" id="sheetDone">0</strong></div><div class="metric"><span class="metricLabel">\uB0A8\uC74C</span><strong class="metricValue" id="sheetRemain">0</strong></div></div><label class="sheetOption"><span class="sheetOptionText"><span class="sheetOptionTitle">${TEXT.createFolder}</span><span class="sheetOptionMeta">\uCCB4\uD06C \uD574\uC81C \uC2DC \uD3F4\uB354 \uC5C6\uC774 \uBC14\uB85C \uC800\uC7A5</span></span><span class="sheetOptionControl"><input class="sheetOptionInput" id="sheetFolderToggle" type="checkbox" checked><span class="sheetOptionTrack" aria-hidden="true"></span></span></label><label class="sheetOption"><span class="sheetOptionText"><span class="sheetOptionTitle">${TEXT.reverseOrder}</span><span class="sheetOptionMeta">${TEXT.reverseOrderMeta}</span></span><span class="sheetOptionControl"><input class="sheetOptionInput" id="sheetReverseToggle" type="checkbox"><span class="sheetOptionTrack" aria-hidden="true"></span></span></label><div class="section sheetMedia hidden" id="sheetMediaSection"><div class="sectionTitle">${TEXT.downloading}</div><div class="sheetMediaGrid" id="sheetMediaGrid"></div></div><div class="section sheetFailures hidden" id="sheetFailuresSection"><div class="sectionHeader"><div class="sectionTitle">${TEXT.failureHistory}</div><button class="sectionAction" id="sheetFailuresClear" type="button">${TEXT.clearAll}</button></div><div class="sheetFailuresList" id="sheetFailuresList"></div></div><div class="sheetActions"><button class="btn cancel" id="sheetCancel" type="button">${TEXT.cancel}</button></div><div class="sheetFooter"><span>Made by \uAD7F\uD584</span><div class="sheetMetaActions"><span class="sheetVersion">${EXT_VERSION}</span><a class="sheetLink" href="https://x.com/daryeou" target="_blank" rel="noopener noreferrer" aria-label="\uAD7F\uD584 X \uBC14\uB85C\uAC00\uAE30">X</a></div></div></div></div>
      <div class="toast" id="toast"></div>`;
    const refs = {
      panel: shadow.querySelector('.panel'),
      chips: shadow.querySelectorAll('.chip'),
      grid: shadow.querySelector('#grid'),
      mainSection: shadow.querySelector('#mainSection'),
      info: shadow.querySelector('#info'),
      action: shadow.querySelector('#action'),
      sheet: shadow.querySelector('.sheet'),
      sheetToggle: shadow.querySelector('#sheetToggle'),
      sheetHandle: shadow.querySelector('.sheetHandle'),
      sheetTotal: shadow.querySelector('#sheetTotal'),
      sheetDone: shadow.querySelector('#sheetDone'),
      sheetRemain: shadow.querySelector('#sheetRemain'),
      sheetFill: shadow.querySelector('#sheetFill'),
      sheetPercent: shadow.querySelector('#sheetPercent'),
      sheetBody: shadow.querySelector('.sheetBody'),
      sheetFolderToggle: shadow.querySelector('#sheetFolderToggle'),
      sheetReverseToggle: shadow.querySelector('#sheetReverseToggle'),
      sheetMediaSection: shadow.querySelector('#sheetMediaSection'),
      sheetMediaGrid: shadow.querySelector('#sheetMediaGrid'),
      sheetFailuresSection: shadow.querySelector('#sheetFailuresSection'),
      sheetFailuresList: shadow.querySelector('#sheetFailuresList'),
      sheetFailuresClear: shadow.querySelector('#sheetFailuresClear'),
      sheetCancel: shadow.querySelector('#sheetCancel'),
      toast: shadow.querySelector('#toast')
    };
    const shadowStyle = document.createElement('style');
    shadowStyle.textContent = '.sheetArrow{transform:none}.sheet.collapsed .sheetArrow{transform:rotate(180deg)}.fill{position:relative;overflow:hidden}.fill.shimmer::after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(100deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.16) 35%,rgba(255,255,255,.38) 50%,rgba(255,255,255,.16) 65%,rgba(255,255,255,0) 100%);animation:arca-dl-shimmer 1.4s linear infinite}@keyframes arca-dl-shimmer{100%{transform:translateX(100%)}}.sheetRecovery{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;border-radius:14px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.22)}.sheetRecovery.hidden{display:none}.sheetRecoveryText{min-width:0;color:#f8d27a;font:600 12px/1.45 sans-serif}.sheetRecoveryLink{flex:0 0 auto}';
    shadow.appendChild(shadowStyle);
    const recovery = document.createElement('div');
    recovery.className = 'sheetRecovery hidden';
    const recoveryText = document.createElement('div');
    recoveryText.className = 'sheetRecoveryText';
    const recoveryLink = document.createElement('a');
    recoveryLink.className = 'sheetFailureLink sheetRecoveryLink';
    recoveryLink.textContent = TEXT.openPage;
    bindCurrentTabLink(recoveryLink);
    recovery.appendChild(recoveryText);
    recovery.appendChild(recoveryLink);
    refs.sheetBody.insertBefore(recovery, refs.sheetMediaSection);
    refs.sheetRecovery = recovery;
    refs.sheetRecoveryText = recoveryText;
    refs.sheetRecoveryLink = recoveryLink;
    refs.sheetToggle.querySelector('.sheetArrow').innerHTML = getSheetArrowMarkup();
    refs.sheetToggle.addEventListener('click', () => {
      if (Date.now() < app.sheetIgnoreToggleUntil) return;
      app.statusCollapsed = !app.statusCollapsed;
      render();
    });
    refs.sheetHandle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    refs.sheetHandle.addEventListener('pointerdown', startSheetDrag);
    refs.sheetFolderToggle.addEventListener('change', async () => {
      app.createFolder = refs.sheetFolderToggle.checked;
      await persistSitePreferences();
      if (app.mode === 'selection') {
        app.existing.clear();
        void loadExistingSelection();
      }
      render();
    });
    refs.sheetReverseToggle.addEventListener('change', async () => {
      app.reverseOrder = refs.sheetReverseToggle.checked;
      await persistSitePreferences();
      render();
    });
    refs.sheetFailuresClear.addEventListener('click', async () => {
      await clearFailureHistory();
      app.failureHistory = [];
      render();
    });
    refs.sheetCancel.addEventListener('click', () => {
      if (isBatchDownloading(app.batchState)) chrome.runtime.sendMessage({ action: 'cancel' });
    });
    refs.chips.forEach((chip) => chip.addEventListener('click', () => { refs.chips.forEach((candidate) => candidate.classList.remove('active')); chip.classList.add('active'); app.filter = chip.dataset.filter; render(); }));
    refs.action.addEventListener('dblclick', (event) => { event.preventDefault(); event.stopPropagation(); });
    refs.action.addEventListener('click', () => {
      if (app.isDownloading) return;
      if (app.mode === 'selection') { app.isDownloading = true; render(); void startSelectionDownload().finally(() => { app.isDownloading = false; render(); }); return; }
      if (app.mode === 'status' && isBatchDownloading(app.batchState)) chrome.runtime.sendMessage({ action: 'cancel' });
    });
    syncPanelState();
    if (!app.handleResize) app.handleResize = () => handleWindowResize();
    window.addEventListener('resize', app.handleResize);
    app.root = root;
    app.refs = refs;
    return refs;
  }
  function syncPanelState() {
    if (!app.refs?.panel) return;
    const canShowPanel = app.mode === 'selection' && !isInlineMode();
    app.refs.panel.classList.toggle('open', canShowPanel);
  }
  function destroyUI() {
    stopStatusPolling();
    stopSheetDrag();
    if (app.toastTimer) clearTimeout(app.toastTimer);
    if (app.handleResize) window.removeEventListener('resize', app.handleResize);
    app.root?.remove();
    app.mode = 'idle';
    app.items = [];
    app.checked = [];
    app.batchState = null;
    app.pageTitle = '';
    app.existingReady = false;
    app.existingRequestId = 0;
    app.existing.clear();
    app.root = null;
    app.refs = null;
    app.statusCollapsed = false;
    app.toastTimer = null;
    app.resumeRecoveryKey = '';
  }
  function getFilteredItems() { return app.items.map((item, index) => ({ item, index })).filter(({ item }) => app.filter === 'all' || item.type === app.filter); }
  function isAlreadyDownloaded(item) { return app.existing.has(getItemStorageKey(app.pageTitle, item)); }
  async function loadExistingSelection() {
    if (app.mode !== 'selection' || !app.items.length) return;
    const requestId = ++app.existingRequestId;
    app.pageTitle = getPageTitle();
    try {
      const requestItems = app.items.map((item) => toDownloadRequestItem(item, app.pageTitle));
      const lookup = await checkExisting(app.pageTitle, requestItems);
      if (requestId !== app.existingRequestId || app.mode !== 'selection') {
        return;
      }
      app.existing = new Set(Object.keys(lookup).filter((key) => lookup[key]));
      dedupDebugLog('selection:existing-set', {
        pageTitle: app.pageTitle,
        siteId: getSiteId(),
        existingKeys: Array.from(app.existing),
        items: app.items.map((item, index) => ({
          index,
          ...getDedupDebugItemSnapshot(app.pageTitle, item),
          alreadyDownloaded: app.existing.has(getItemStorageKey(app.pageTitle, item))
        }))
      });
      if (hasVisibleBatch(app.batchState)) {
        app.batchState.items.forEach((item) => {
          const key = getItemStorageKey(item.folderTitle || app.pageTitle, item);
          if (item.status === 'complete' && key) app.existing.add(key);
        });
      }
      app.items.forEach((item, index) => { if (isAlreadyDownloaded(item)) app.checked[index] = false; });
    } finally {
      if (requestId === app.existingRequestId && app.mode === 'selection') {
        app.existingReady = true;
        render();
      }
    }
  }
  function renderTile(item, index, readonly) {
    const tile = document.createElement('div');
    tile.className = 'item';
    const selectable = !readonly;
    const already = selectable && isAlreadyDownloaded(item);
    const canRemove = readonly && Number.isInteger(item?.order) && isBatchPendingStatus(item?.status);
    if (selectable && app.checked[index] && !already) tile.classList.add('checked');
    if (readonly) tile.classList.add('readonly');
    if (already) tile.classList.add('disabled');
    if (item.previewUrl) { const image = document.createElement('img'); image.src = item.previewUrl; image.loading = 'lazy'; tile.appendChild(image); }
    if (selectable) {
      const check = document.createElement('div'); check.className = 'check'; tile.appendChild(check);
      if (!already) tile.addEventListener('click', () => { app.checked[index] = !app.checked[index]; render(); });
      else { const badge = document.createElement('div'); badge.className = 'badge2'; badge.textContent = TEXT.alreadyDownloaded; tile.appendChild(badge); }
    } else {
      const retryWaitMs = item.status === 'queued' && Number.isFinite(item?.nextRetryAt)
        ? Math.max(0, item.nextRetryAt - Date.now())
        : 0;
      const retryWaitLabel = formatRetryWait(retryWaitMs);
      const badge = document.createElement('div');
      const text = item.status === 'complete'
        ? TEXT.alreadyDownloaded
        : item.status === 'action_required'
          ? TEXT.actionRequired
        : item.status === 'failed'
          ? TEXT.failed
          : item.status === 'cancelled'
            ? TEXT.cancelled
            : item.status === 'queued'
              ? (retryWaitLabel ? `${TEXT.queued} ${retryWaitLabel}` : TEXT.queued)
              : `${item.progress || 0}%`;
      badge.className = `badge2${item.status === 'failed' || item.status === 'action_required' ? ' failed' : item.status === 'cancelled' ? ' cancelled' : ''}`;
      badge.textContent = text;
      tile.appendChild(badge);
      if (canRemove) {
        const remove = document.createElement('button');
        remove.className = 'tileRemove';
        remove.type = 'button';
        remove.textContent = 'x';
        remove.title = '다운로드 항목 제거';
        remove.setAttribute('aria-label', '다운로드 항목 제거');
        remove.disabled = app.removingBatchItem;
        remove.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (app.removingBatchItem) return;
          void removeBatchItem(item.order);
        });
        tile.appendChild(remove);
      }
    }
    if (item.type !== 'image') { const play = document.createElement('div'); play.className = 'play'; tile.appendChild(play); }
    const type = document.createElement('span'); type.className = 'type'; type.textContent = item.type === 'image' ? 'IMG' : item.type === 'video' ? 'VID' : 'GIF'; tile.appendChild(type);
    return tile;
  }
  function renderFailureItem(entry) {
    const item = document.createElement('div');
    item.className = 'sheetFailureItem';

    const thumb = document.createElement('div');
    thumb.className = 'sheetFailureThumb';
    if (entry?.previewUrl) {
      const image = document.createElement('img');
      image.src = entry.previewUrl;
      image.loading = 'lazy';
      thumb.appendChild(image);
    } else {
      thumb.textContent = String(entry?.type || 'ERR').toUpperCase();
    }

    const meta = document.createElement('div');
    meta.className = 'sheetFailureMeta';

    const title = document.createElement('div');
    title.className = 'sheetFailureTitle';
    title.textContent = String(entry?.pageTitle || entry?.siteId || '?ㅽ뙣 ??ぉ');
    meta.appendChild(title);

    const filename = document.createElement('div');
    filename.className = 'sheetFailureName';
    filename.textContent = String(entry?.filename || '');
    meta.appendChild(filename);

    if (entry?.reason) {
      const reason = document.createElement('div');
      reason.className = 'sheetFailureReason';
      reason.textContent = String(entry.reason);
      meta.appendChild(reason);
    }

    const link = document.createElement('a');
    link.className = 'sheetFailureLink';
    link.href = String(entry?.pageUrl || '#');
    link.textContent = TEXT.openPage;
    bindCurrentTabLink(link);

    item.appendChild(thumb);
    item.appendChild(meta);
    item.appendChild(link);
    return item;
  }
  function render() {
    if (!app.refs) ensureUI();
    const refs = app.refs;
    syncPanelState();
    const hasBatch = hasVisibleBatch(app.batchState);
    const pausedRecovery = isBatchPaused(app.batchState) && app.batchState?.manualRecovery
      ? app.batchState.manualRecovery
      : null;
    const shouldShowSheet = hasBatch || app.mode === 'selection' || app.mode === 'idle';
    const pendingSelectionKeys = getPendingSelectionKeys(app.pageTitle, app.batchState);
    const completedSelectionKeys = getCompletedSelectionKeys(app.pageTitle, app.batchState);
    refs.grid.textContent = '';
    refs.sheetMediaGrid.textContent = '';
    refs.sheetFailuresList.textContent = '';
    const visibleItems = (!app.existingReady && app.mode === 'selection' ? [] : getFilteredItems()).filter(({ item }) => {
      const key = getItemStorageKey(app.pageTitle, item);
      return !pendingSelectionKeys.has(key) && !completedSelectionKeys.has(key);
    });
    const activeItems = hasBatch ? getBatchPendingItems(app.batchState).map((item) => toBatchUiItem(item)) : [];
    visibleItems.forEach(({ item, index }) => refs.grid.appendChild(renderTile(item, index, app.mode === 'status')));
    activeItems.forEach((item, index) => refs.sheetMediaGrid.appendChild(renderTile(item, index, true)));
    app.failureHistory.forEach((entry) => refs.sheetFailuresList.appendChild(renderFailureItem(entry)));
    refs.mainSection.classList.toggle('hidden', refs.grid.childElementCount === 0);
    refs.sheetMediaSection.classList.toggle('hidden', refs.sheetMediaGrid.childElementCount === 0);
    refs.sheetFailuresSection.classList.toggle('hidden', refs.sheetFailuresList.childElementCount === 0);
    refs.sheetFailuresClear.style.display = refs.sheetFailuresList.childElementCount ? '' : 'none';
    refs.sheetRecovery.classList.toggle('hidden', !pausedRecovery);
    refs.sheetRecoveryText.textContent = pausedRecovery ? TEXT.recoveryHelp : '';
    refs.sheetRecoveryLink.href = String(pausedRecovery?.pageUrl || '#');
    refs.sheetRecoveryLink.style.display = pausedRecovery?.pageUrl ? '' : 'none';
    const selectedCount = visibleItems.filter(({ item, index }) => app.checked[index] && !isAlreadyDownloaded(item)).length;
    refs.info.textContent = `${selectedCount}${TEXT.selectedSuffix}`;
    const pct = getBatchPercent(app.batchState);
    refs.sheet.classList.toggle('show', shouldShowSheet);
    refs.sheet.classList.toggle('collapsed', app.statusCollapsed);
    refs.sheetToggle.setAttribute('aria-expanded', String(!app.statusCollapsed));
    refs.sheetTotal.textContent = String(app.batchState?.total || 0);
    refs.sheetDone.textContent = String(app.batchState?.completed || 0);
    refs.sheetRemain.textContent = String(getBatchRemainingCount(app.batchState));
    refs.sheetFill.style.width = `${pct}%`;
    refs.sheetFill.classList.toggle('shimmer', isBatchDownloading(app.batchState));
    refs.sheetPercent.textContent = `${pct}%`;
    refs.sheetFolderToggle.checked = app.createFolder !== false;
    refs.sheetReverseToggle.checked = app.reverseOrder === true;
    refs.sheetFolderToggle.disabled = app.isDownloading || isBatchDownloading(app.batchState) || isBatchPaused(app.batchState);
    refs.sheetReverseToggle.disabled = app.isDownloading || isBatchDownloading(app.batchState) || isBatchPaused(app.batchState);
    refs.sheetCancel.style.display = isBatchDownloading(app.batchState) || isBatchPaused(app.batchState) ? '' : 'none';
    syncFloatingLayout();
    if (app.mode === 'selection') {
      refs.action.style.display = '';
      refs.action.classList.remove('cancel');
      refs.action.textContent = pausedRecovery
        ? TEXT.paused
        : app.isDownloading
          ? TEXT.processing
          : isBatchDownloading(app.batchState)
            ? TEXT.append
            : TEXT.download;
      refs.action.disabled = pausedRecovery ? true : selectedCount === 0 || app.isDownloading;
    } else {
      refs.action.style.display = 'none';
      refs.action.classList.remove('cancel');
      refs.action.disabled = true;
    }
  }
  function updateSelectionBatchState(items, batchState) {
    app.batchState = batchState;
    syncStatusPolling(batchState);
    render();
  }
  function updateStatusBatchState(state) {
    app.batchState = state;
    app.items = Array.isArray(state?.items) ? state.items.map((item) => toBatchUiItem(item)) : [];
    syncStatusPolling(state);
    render();
  }
  function showSelectionUI(items, batchState = null, forceRefreshExisting = false) {
    stopPageWatching();
    ensureUI();
    const nextPageTitle = getPageTitle();
    const shouldRefreshExisting =
      forceRefreshExisting ||
      app.mode !== 'selection' ||
      !app.existingReady ||
      app.pageTitle !== nextPageTitle ||
      !areSameSelectionItems(app.items, items);
    const previousSelection = new Map(app.items.map((item, index) => [getItemSelectionKey(item), app.checked[index] !== false]));
    app.mode = 'selection';
    app.items = items.map((item) => ({ ...item }));
    app.checked = app.items.map((item) => {
      const key = getItemSelectionKey(item);
      return previousSelection.has(key) ? previousSelection.get(key) : true;
    });
    app.batchState = batchState;
    app.pageTitle = nextPageTitle;
    if (shouldRefreshExisting) {
      app.existing.clear();
      app.existingReady = false;
    }
    syncStatusPolling(batchState);
    render();
    if (shouldRefreshExisting) {
      void loadExistingSelection();
    }
  }
  function showStatusUI(state) {
    stopPageWatching();
    ensureUI();
    app.mode = 'status';
    app.batchState = state;
    app.items = state.items.map((item) => toBatchUiItem(item));
    app.existingReady = true;
    render();
    syncStatusPolling(state);
  }
  function showIdleUI() {
    ensureUI();
    app.mode = 'idle';
    app.batchState = null;
    app.items = [];
    app.checked = [];
    app.pageTitle = getPageTitle();
    app.existing.clear();
    app.existingReady = true;
    stopStatusPolling();
    render();
  }
  async function startSelectionDownload() {
    ensureUI();
    const title = getPageTitle();
    const pageUrl = String(location.href || '');
    const action = isBatchDownloading(app.batchState) ? 'appendDownloads' : 'startDownload';
    const selectedItems = app.items
      .map((item, index) => ({ item, index }))
      .filter(({ item, index }) => app.checked[index] && !isAlreadyDownloaded(item))
      .map(({ item }) => ({ ...item, pageUrl, pageTitle: title }));
    if (!selectedItems.length) return;

    app.pageTitle = title;
    const lookupItems = selectedItems.map((item) => toDownloadRequestItem(item, title));
    const existing = await checkExisting(title, lookupItems);

    Object.keys(existing).forEach((key) => {
      if (existing[key]) app.existing.add(key);
    });

    app.items.forEach((item, index) => {
      if (!app.checked[index]) return;
      const key = getItemStorageKey(title, item);
      if (key && existing[key]) app.checked[index] = false;
    });

    const pendingItems = selectedItems.filter((item) => {
      const key = getItemStorageKey(title, item);
      return !(key && existing[key]);
    });

    render();
    if (!pendingItems.length) return;

    const orderedPendingItems = prepareOrderedDownloads(pendingItems);
    const { backgroundDownloads, localDownloads } = await splitPreparedDownloads(orderedPendingItems, title);
    notifyDownloadStart(backgroundDownloads.length + localDownloads.length);
    if (backgroundDownloads.length) {
      await sendDownloads(action, backgroundDownloads, title);
    }
    for (const item of localDownloads) {
      await downloadLocalItem(item, title);
    }
  }
  async function saveBlobDownload(blob, filename) {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const result = await chromeDownload({ url: objectUrl, filename, conflictAction: 'uniquify' });
      if (!result.error && result.downloadId) return true;
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = filename.split(/[\\/]/).pop() || 'download';
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      return true;
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectUrl), LOCAL_URL_TTL_MS);
    }
  }
  function detectBlobExtension(blob, fallbackBasename = '') {
    const type = String(blob?.type || '').toLowerCase();
    if (type.includes('mp4')) return 'mp4';
    if (type.includes('webm')) return 'webm';
    if (type.includes('quicktime')) return 'mov';
    const fallback = getUrlBasename('', fallbackBasename);
    const match = fallback.match(/\.([a-z0-9]{1,8})$/i);
    return match ? match[1].toLowerCase() : '';
  }
  async function resolvePreparedDownloadItem(item, title) {
    if (item.delivery === 'local' && (item.type === 'video' || item.type === 'gif') && item.statusPath) {
      return TwitterResolver.resolve(item, title, {
        createFolder: getCreateFolderValue(item),
        downloadConfig: getSiteDownloadConfig()
      });
    }
    if (item.delivery === 'local') {
      return {
        ...item,
        folderTitle: title || item?.folderTitle || '',
        pageUrl: String(item?.pageUrl || location.href || ''),
        pageTitle: title || item?.pageTitle || item?.folderTitle || '',
        createFolder: getCreateFolderValue(item)
      };
    }
    return toDownloadRequestItem(item, title);
  }
  async function splitPreparedDownloads(items, title) {
    const backgroundDownloads = [];
    const localDownloads = [];

    for (const item of items) {
      const resolvedItem = await resolvePreparedDownloadItem(item, title);
      if (!resolvedItem) continue;
      if (resolvedItem.delivery === 'local') {
        localDownloads.push(resolvedItem);
        continue;
      }
      backgroundDownloads.push(resolvedItem);
    }

    return { backgroundDownloads, localDownloads };
  }
  async function tryFetchBlobVideo(item) {
    const blobUrl = String(item.blobUrl || item.mediaElement?.currentSrc || '').trim();
    if (!blobUrl.startsWith('blob:')) return false;
    try {
      const response = await fetch(blobUrl);
      if (!response.ok) return false;
      const blob = await response.blob();
      if (!(blob.size > 0)) return false;
      const filename = buildLocalFilename(app.pageTitle || getPageTitle(), item, detectBlobExtension(blob, item.downloadBasename || ''));
      return await saveBlobDownload(blob, filename);
    } catch {
      return false;
    }
  }
  async function downloadLocalItem(item, title) {
    app.pageTitle = title || getPageTitle();
    let attempt = 0;

    while (true) {
      const success = await tryFetchBlobVideo(item);
      await reportDownloadResult(item, app.pageTitle, success, success ? '' : 'local-download-failed');
      if (success) {
        return true;
      }

      const waitMs = Math.min(60 * 1000, 1000 * (2 ** attempt));
      attempt += 1;
      await sleep(waitMs);
    }
  }
  async function startInlineDownload(targetId) {
    let target = app.inlineTargets.get(targetId);
    const isArcaListTarget = target?.placement?.engine === 'arca_list_cell';
    if ((!target || target.isLoading || isArcaListTarget) && prepareInlineTarget) {
      const preparedTarget = await prepareInlineTarget(targetId);
      if (preparedTarget?.mount?.isConnected) {
        target = preparedTarget;
        app.inlineTargets.set(targetId, preparedTarget);
        syncInlineButtons();
      }
    }
    if (!target || app.inlinePendingGroups.has(target.groupKey)) return;
    app.inlinePendingGroups.add(target.groupKey);
    syncInlineButtons();
    try {
      const title = target.title || getPageTitle();
      const pageUrl = String(target.articleUrl || location.href || '');
      if (target.error) {
        showToast(getInlineTargetErrorMessage(target));
        return;
      }
      const stampedDownloads = target.downloads.map((item) => ({ ...item, pageUrl, pageTitle: title }));
      if (!stampedDownloads.length) {
        showToast(target.totalCount > 0 ? '이미 모두 다운로드했습니다' : '다운로드할 미디어가 없습니다');
        return;
      }
      const lookupItems = stampedDownloads.map((item) => toDownloadRequestItem(item, title));
      const existing = await checkExisting(title, lookupItems);
      const pendingItems = [];
      stampedDownloads.forEach((item) => {
        const key = getItemStorageKey(title, item);
        if (key && existing[key]) return;
        pendingItems.push(item);
      });
      if (!pendingItems.length) {
        showToast('이미 모두 다운로드했습니다');
        invalidateInlineTargetsAvailability();
        return;
      }
      const orderedPendingItems = prepareOrderedDownloads(pendingItems);
      const { backgroundDownloads, localDownloads } = await splitPreparedDownloads(orderedPendingItems, title);
      if (!backgroundDownloads.length && !localDownloads.length) {
        showToast('다운로드할 미디어가 없습니다');
        return;
      }
      notifyDownloadStart(backgroundDownloads.length + localDownloads.length);
      if (backgroundDownloads.length) {
        const action = isBatchDownloading(await requestState()) ? 'appendDownloads' : 'startDownload';
        await sendDownloads(action, backgroundDownloads, title);
        invalidateInlineTargetsAvailability();
      }
      for (const item of localDownloads) await downloadLocalItem(item, title);
      if (backgroundDownloads.length || localDownloads.length) {
        invalidateInlineTargetsAvailability();
      }
    } finally {
      app.inlinePendingGroups.delete(target.groupKey);
      syncInlineButtons();
    }
  }
  function applyIdleState() {
    const hadVisibleBatch = hasVisibleBatch(app.batchState);
    stopStatusPolling();
    if (isInlineMode()) { showIdleUI(); startInlineWatching(); return; }
    if (supportsInlineButtons()) startInlineWatching();
    else { stopInlineWatching(); clearInlineButtons(); }
    const items = getPageItems();
    if (items.length) { showSelectionUI(items, null, hadVisibleBatch); return; }
    showIdleUI();
    startPageWatching();
  }
  function applyBackgroundState(state) {
    const wasPaused = isBatchPaused(app.batchState);
    if (isInlineMode()) {
      startInlineWatching();
      if (hasVisibleBatch(state)) {
        if (app.mode === 'status') updateStatusBatchState(state);
        else showStatusUI(state);
        if (!isBatchPaused(state)) app.resumeRecoveryKey = '';
        return;
      }
      app.resumeRecoveryKey = '';
      applyIdleState();
      return;
    }
    if (supportsInlineButtons()) startInlineWatching();
    else { stopInlineWatching(); clearInlineButtons(); }
    const items = getPageItems();
    if (hasVisibleBatch(state)) {
      if (items.length) {
        const sameSelectionContext =
          app.mode === 'selection' &&
          app.pageTitle === getPageTitle() &&
          areSameSelectionItems(app.items, items);
        if (sameSelectionContext) updateSelectionBatchState(items, state);
        else showSelectionUI(items, state);
        if (!isBatchPaused(state)) app.resumeRecoveryKey = '';
      } else if (app.mode === 'status') {
        updateStatusBatchState(state);
        if (!isBatchPaused(state)) app.resumeRecoveryKey = '';
      } else {
        showStatusUI(state);
        if (!isBatchPaused(state)) app.resumeRecoveryKey = '';
      }
      return;
    }
    if (wasPaused) app.resumeRecoveryKey = '';
    applyIdleState();
  }
  function scheduleSelectionCheck() {
    if (app.pageTimer || isInlineMode() || app.mode === 'selection' || app.mode === 'status') return;
    app.pageTimer = setTimeout(async () => {
      app.pageTimer = null;
      const state = await requestState();
      if (hasVisibleBatch(state)) { applyBackgroundState(state); return; }
      const items = getPageItems();
      if (items.length) { stopPageWatching(); showSelectionUI(items); }
    }, WATCH_DEBOUNCE_MS);
  }
  function startPageWatching() {
    if (isInlineMode() || app.mode === 'selection' || app.mode === 'status') return;
    const target = document.body || document.documentElement;
    if (!target) return;
    stopPageWatching();
    app.pageObserver = new MutationObserver(() => scheduleSelectionCheck());
    app.pageObserver.observe(target, { childList: true, subtree: true });
    app.pageStop = setTimeout(() => stopPageWatching(), WATCH_TIMEOUT_MS);
  }
  async function bootstrap() {
    if (window.__arcaDL?.waitUntilReady) await window.__arcaDL.waitUntilReady();
    await loadSitePreferences();
    app.failureHistory = await requestFailureHistory();
    const state = await requestState();
    applyBackgroundState(state);
    if (isBatchPaused(state)) {
      void maybeResumePausedBatch(state);
    }
  }
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'progress') {
      const wasPaused = isBatchPaused(app.batchState);
      applyBackgroundState(message.state);
      if (isBatchPaused(message.state) && !wasPaused) {
        showToast(TEXT.recoveryToast);
      }
      if (!hasVisibleBatch(message.state) || message.state?.status !== 'downloading') {
        invalidateInlineTargetsAvailability();
      }
    }
    if (message.action === 'failureHistory') {
      if (message.siteId && message.siteId !== getSiteId()) {
        return;
      }
      app.failureHistory = Array.isArray(message.history) ? message.history : [];
      render();
    }
  });
  window.addEventListener('arca-dl-inline-updated', () => { if (supportsInlineButtons()) scheduleInlineSync(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void bootstrap(); }, { once: true });
  else void bootstrap();
})();


