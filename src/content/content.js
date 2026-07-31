// Site extraction module - exposes window.__arcaDL
(() => {
  const {
    sanitizePathSegment,
    getUrlFilename,
    toRegExp
  } = globalThis.ArcaDLShared;
  const runtime = {
    payload: null,
    site: null,
    readyPromise: null,
    inlineListEntries: new Map()
  };

  function toAbsoluteUrl(url, baseHref = location.href) {
    if (!url) {
      return '';
    }

    try {
      return new URL(url, baseHref).href;
    } catch {
      return '';
    }
  }

  function applyFirstTransform(value, transforms = [], baseHref = location.href) {
    const normalized = toAbsoluteUrl(value, baseHref);
    if (!normalized) {
      return '';
    }

    for (const transform of transforms) {
      const regex = toRegExp(transform.pattern, transform.flags || '');
      if (regex && regex.test(normalized)) {
        return normalized.replace(regex, transform.replacement || '');
      }
    }

    return normalized;
  }

  function applyTemplate(value, pattern, template, flags = '') {
    const regex = toRegExp(pattern, flags);
    if (!regex || !regex.test(value)) {
      return '';
    }

    return value.replace(regex, template || '$0');
  }

  function matchesPattern(value, pattern, flags = '') {
    const regex = toRegExp(pattern, flags);
    return regex ? regex.test(value) : false;
  }

  function matchesHost(hostname, candidate) {
    const normalized = String(candidate || '').replace(/^\*\./, '');
    return hostname === normalized || hostname.endsWith(`.${normalized}`);
  }

  function resolveSite(payload) {
    if (!payload || !Array.isArray(payload.sites)) {
      return null;
    }

    const hostname = location.hostname;
    return payload.sites.find((site) =>
      Array.isArray(site.hosts) && site.hosts.some((host) => matchesHost(hostname, host))
    ) || null;
  }

  function getResolvedSite() {
    return runtime.site;
  }

  function getUiConfig() {
    return getResolvedSite()?.ui || { mode: 'panel' };
  }

  function getSiteId() {
    return String(getResolvedSite()?.id || location.hostname || '').trim();
  }

  function isMatchingAnySelector(element, selectors = []) {
    if (!element) {
      return false;
    }

    return selectors.some((selector) => {
      try {
        return element.matches(selector) || Boolean(element.closest(selector));
      } catch {
        return false;
      }
    });
  }

  function buildTitleFromConfig(site, root = document) {
    const titleConfig = site?.parser?.title || {};
    const fallback = titleConfig.fallback || 'Arca';

    if (titleConfig.selector) {
      const titleEl = root.querySelector(titleConfig.selector);
      if (titleEl) {
        const clone = titleEl.cloneNode(true);
        (titleConfig.removeSelectors || []).forEach((selector) => {
          clone.querySelectorAll(selector).forEach((node) => node.remove());
        });

        const text = sanitizePathSegment(clone.textContent, fallback);
        if (text) {
          return text;
        }
      }
    }

    const splitToken = titleConfig.fallbackSplit || ' - ';
    const pageTitle = String(root.title || document.title || '').split(splitToken)[0].trim();
    return sanitizePathSegment(pageTitle, fallback);
  }

  function resolveArcaGifUrl(parser, linkHref, originalUrl, baseHref = location.href) {
    const linkUrl = applyFirstTransform(linkHref, parser.urlTransforms?.absolute || [], baseHref);
    const original = applyFirstTransform(
      originalUrl,
      parser.urlTransforms?.originalMedia || parser.urlTransforms?.absolute || [],
      baseHref
    );

    if (matchesPattern(linkUrl, parser.gif?.allowedUrlPattern)) {
      return linkUrl;
    }

    if (matchesPattern(original, parser.gif?.allowedUrlPattern)) {
      return original;
    }

    return '';
  }

  function extractArcaMediaItemsFromRoot(site, root = document, baseHref = location.href) {
    const parser = site?.parser || {};
    if (!parser.containerSelector) {
      return [];
    }

    const container = root.querySelector(parser.containerSelector)
      || root.querySelector('.fr-view.article-content')
      || root.querySelector('.article-content')
      || root.querySelector('.fr-view');
    if (!container) {
      return [];
    }

    const articleTitle = buildTitleFromConfig(site, root);
    const emoticonSelectors = parser.emoticonSelectors || [];
    const seen = new Set();
    const items = [];

    function addItem(
      originalUrl,
      previewUrl,
      type,
      originalTransforms = parser.urlTransforms?.originalMedia || parser.urlTransforms?.absolute || []
    ) {
      const normalizedOriginal = applyFirstTransform(
        originalUrl,
        originalTransforms,
        baseHref
      );
      if (!normalizedOriginal || seen.has(normalizedOriginal)) {
        return;
      }

      seen.add(normalizedOriginal);
      items.push({
        originalUrl: normalizedOriginal,
        previewUrl: applyFirstTransform(previewUrl, parser.urlTransforms?.absolute || [], baseHref),
        type,
        sourceIndex: items.length,
        folderTitle: articleTitle,
        delivery: 'background'
      });
    }

    const imageSelectors = [
      parser.image?.linkSelector,
      parser.image?.hrefIncludes ? `a[href*="${parser.image.hrefIncludes}"]` : '',
      'a[href*="type=orig"]'
    ].filter(Boolean);

    if (imageSelectors.length) {
      container.querySelectorAll(Array.from(new Set(imageSelectors)).join(', ')).forEach((link) => {
        const href = link.getAttribute('href');
        if (!href || (parser.image?.hrefIncludes && !href.includes(parser.image.hrefIncludes))) {
          return;
        }

        const previewNode = parser.image?.previewSelector
          ? link.querySelector(parser.image.previewSelector)
          : null;

        if (isMatchingAnySelector(previewNode, emoticonSelectors)) {
          return;
        }

        addItem(href, previewNode?.getAttribute('src') || '', 'image');
      });
    }

    if (parser.gif?.selector) {
      container.querySelectorAll(parser.gif.selector).forEach((video) => {
        if (isMatchingAnySelector(video, emoticonSelectors)) {
          return;
        }

        const link = parser.gif?.linkSelector ? video.closest(parser.gif.linkSelector) : null;
        const href = link?.getAttribute('href') || '';
        const originalUrl = parser.gif?.originalAttribute
          ? video.getAttribute(parser.gif.originalAttribute)
          : '';
        const resolvedUrl = resolveArcaGifUrl(parser, href, originalUrl, baseHref);
        if (!resolvedUrl) {
          return;
        }

        addItem(
          resolvedUrl,
          video.getAttribute(parser.gif.posterAttribute || 'poster') || '',
          'gif',
          parser.urlTransforms?.absolute || []
        );
      });
    }

    if (parser.video?.selector) {
      container.querySelectorAll(parser.video.selector).forEach((video) => {
        if (isMatchingAnySelector(video, emoticonSelectors)) {
          return;
        }

        if (
          parser.video?.skipDataOrigValue &&
          video.getAttribute('data-orig') === parser.video.skipDataOrigValue
        ) {
          return;
        }

        const sourceUrl = video.getAttribute(parser.video?.srcAttribute || 'src')
          || video.querySelector(parser.video?.sourceSelector || 'source[src]')?.getAttribute('src')
          || '';
        if (!sourceUrl || !sourceUrl.includes('namu.la')) {
          return;
        }

        addItem(
          sourceUrl,
          video.getAttribute(parser.video?.posterAttribute || 'poster') || '',
          'video',
          parser.urlTransforms?.absolute || []
        );
      });
    }

    return items;
  }

  function getArcaMediaItems(site) {
    return extractArcaMediaItemsFromRoot(site, document, location.href);
  }

  function dispatchInlineTargetsUpdated() {
    window.dispatchEvent(new CustomEvent('arca-dl-inline-updated'));
  }

  function getArcaListEntryId(articleUrl) {
    return String(articleUrl || '').replace(/[?#].*$/, '');
  }

  function sendExistingCheck(title, items) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'checkExisting', title, items }, (response) => {
        if (chrome.runtime.lastError) {
          resolve({});
          return;
        }

        resolve(response?.existsByKey || {});
      });
    });
  }

  function getArcaItemBasename(item) {
    return getUrlFilename(
      item?.originalUrl || item?.url || '',
      item?.downloadBasename || '',
      location.href
    );
  }
  function getArcaExistingLookupKey(title, item) {
    const folder = sanitizePathSegment(item?.folderTitle || title || 'ArcaImages', 'ArcaImages');
    const basename = getArcaItemBasename(item);
    return basename ? `ArcaDownload/${folder}/${basename}`.toLowerCase() : '';
  }

  function toArcaDownloadRequestItems(items, pageUrl) {
    return items.map((item) => ({
      url: item.originalUrl || item.url || '',
      previewUrl: item.previewUrl || '',
      type: item.type,
      folderTitle: item.folderTitle || '',
      pageUrl,
      pageTitle: item.folderTitle || '',
      sourceIndex: item.sourceIndex,
      downloadBasename: item.downloadBasename,
      createFolder: true
    }));
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function buildArcaListEntryPayload(site, root, articleUrl, previewFallback = '') {
    const items = extractArcaMediaItemsFromRoot(site, root, articleUrl);
    const title = buildTitleFromConfig(site, root);
    const downloadItems = items.map((item) => ({
      ...item,
      folderTitle: title,
      pageUrl: articleUrl,
      pageTitle: title
    }));

    return {
      title,
      previewUrl: downloadItems[0]?.previewUrl || previewFallback || '',
      downloadItems
    };
  }

  async function loadArcaListEntryFromFrame(site, entry) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.tabIndex = -1;
    iframe.style.position = 'fixed';
    iframe.style.left = '-99999px';
    iframe.style.top = '0';
    iframe.style.width = '1px';
    iframe.style.height = '1px';
    iframe.style.opacity = '0';
    iframe.style.pointerEvents = 'none';
    iframe.style.border = '0';

    const root = document.body || document.documentElement;
    if (!root) {
      throw new Error('arca-list-frame-root-missing');
    }

    try {
      const loaded = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('arca-list-frame-timeout')), 12000);
        iframe.addEventListener('load', () => {
          clearTimeout(timeout);
          resolve();
        }, { once: true });
        iframe.addEventListener('error', () => {
          clearTimeout(timeout);
          reject(new Error('arca-list-frame-load-failed'));
        }, { once: true });
      });

      iframe.src = entry.articleUrl;
      root.appendChild(iframe);
      await loaded;

      const deadline = Date.now() + 5000;
      let lastPayload = buildArcaListEntryPayload(site, iframe.contentDocument || document, entry.articleUrl, entry.previewUrl);

      while (Date.now() < deadline) {
        const frameDoc = iframe.contentDocument;
        if (!frameDoc) {
          break;
        }

        lastPayload = buildArcaListEntryPayload(site, frameDoc, entry.articleUrl, entry.previewUrl);
        if (lastPayload.downloadItems.length) {
          return lastPayload;
        }

        await sleep(200);
      }

      return lastPayload;
    } finally {
      iframe.remove();
    }
  }

  async function refreshArcaListEntryAvailability(entry) {
    if (!entry?.allDownloads?.length || entry.availabilityLoading) {
      return;
    }

    entry.availabilityLoading = true;

    try {
      const title = entry.title || entry.allDownloads[0]?.folderTitle || 'Arca';
      const lookup = await sendExistingCheck(title, toArcaDownloadRequestItems(entry.allDownloads, entry.articleUrl));
      entry.downloads = entry.allDownloads.filter((item) => {
        const key = getArcaExistingLookupKey(title, item);
        return !lookup[key];
      });
      entry.count = entry.downloads.length;
      entry.checkedAt = Date.now();
      entry.needsAvailabilityRefresh = false;
    } finally {
      entry.availabilityLoading = false;
      dispatchInlineTargetsUpdated();
    }
  }

  function toArcaListTarget(site, entry) {
    return {
      id: entry.id,
      groupKey: entry.id,
      title: entry.title || 'Arca',
      articleUrl: entry.articleUrl || '',
      mount: entry.mount,
      downloads: entry.downloads.map((item) => ({ ...item })),
      count: entry.count,
      totalCount: Array.isArray(entry.allDownloads) ? entry.allDownloads.length : 0,
      label: site.ui?.listButtonLabel || 'Download',
      tooltip: site.ui?.listButtonTooltip || 'Download article media',
      placement: site.ui?.listPlacement || { engine: 'arca_list_cell' },
      buttonStyle: site.ui?.buttonStyle || {},
      isLoading: entry.loading || entry.availabilityLoading,
      error: entry.error || ''
    };
  }

  async function prepareInlineTarget(id) {
    const site = getResolvedSite();
    const entry = runtime.inlineListEntries.get(String(id || ''));
    if (!site || !entry) {
      return null;
    }

    if ((!entry.ready || entry.error) && !entry.loading) {
      await loadArcaListEntry(site, entry);
    } else if (entry.loading) {
      while (entry.loading) {
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    }

    if (entry.allDownloads?.length) {
      await refreshArcaListEntryAvailability(entry);
    }

    return toArcaListTarget(site, entry);
  }

  async function loadArcaListEntry(site, entry) {
    entry.loading = true;

    try {
      const payload = await loadArcaListEntryFromFrame(site, entry);

      entry.title = payload?.title || 'Arca';
      entry.previewUrl = payload?.previewUrl || entry.previewUrl || '';
      entry.allDownloads = Array.isArray(payload?.downloadItems) ? payload.downloadItems : [];
      entry.downloads = [];
      entry.count = 0;
      entry.checkedAt = 0;
      entry.needsAvailabilityRefresh = true;
      entry.ready = true;
      entry.error = '';
      await refreshArcaListEntryAvailability(entry);
    } catch (error) {
      entry.allDownloads = [];
      entry.downloads = [];
      entry.count = 0;
      entry.ready = false;
      entry.error = error instanceof Error ? error.message : 'arca-list-load-failed';
      entry.needsAvailabilityRefresh = false;
    } finally {
      entry.loading = false;
      dispatchInlineTargetsUpdated();
    }
  }

  function scheduleArcaListEntryLoad(site, entry) {
    if (!entry || entry.loading || entry.ready) {
      return;
    }

    loadArcaListEntry(site, entry).catch(() => {});
  }

  function getArcaListInlineTargets(site) {
    const listConfig = site?.parser?.list || {};
    if (!listConfig.rowSelector || !listConfig.mountSelector) {
      return [];
    }

    if (listConfig.pathPattern && !matchesPattern(location.pathname, listConfig.pathPattern)) {
      return [];
    }

    const currentIds = new Set();
    const targets = [];

    document.querySelectorAll(listConfig.rowSelector).forEach((row) => {
      if (listConfig.excludeSelector && isMatchingAnySelector(row, [listConfig.excludeSelector])) {
        return;
      }

      const articleUrl = toAbsoluteUrl(row.getAttribute('href') || row.href || '');
      const mount = row.querySelector(listConfig.mountSelector);
      if (!articleUrl || !mount) {
        return;
      }

      const id = getArcaListEntryId(articleUrl);
      currentIds.add(id);

      let entry = runtime.inlineListEntries.get(id);
      if (!entry) {
        entry = {
          id,
          articleUrl,
          mount,
          title: '',
          previewUrl: '',
          downloads: [],
          count: 0,
          ready: false,
          loading: false,
          error: ''
        };
        runtime.inlineListEntries.set(id, entry);
      } else {
        entry.articleUrl = articleUrl;
        entry.mount = mount;
      }

      const previewNode = listConfig.previewSelector ? row.querySelector(listConfig.previewSelector) : null;
      entry.previewUrl = toAbsoluteUrl(previewNode?.getAttribute('src') || previewNode?.src || '', location.href) || entry.previewUrl || '';

      targets.push(toArcaListTarget(site, entry));
    });

    Array.from(runtime.inlineListEntries.keys()).forEach((id) => {
      if (!currentIds.has(id)) {
        runtime.inlineListEntries.delete(id);
      }
    });

    return targets;
  }

  function matchesTweetScope(node, tweetSelector, tweet) {
    if (!node || !tweetSelector || !tweet) {
      return false;
    }

    try {
      return node.closest(tweetSelector) === tweet;
    } catch {
      return false;
    }
  }

  function addGroupMount(group, mount) {
    if (!mount || !mount.isConnected || group.mounts.includes(mount)) {
      return;
    }

    group.mounts.push(mount);
  }

  function createTweetGroup(pathname, parser) {
    return {
      key: applyTemplate(pathname, parser.statusPathPattern, parser.groupTemplate || '$1/$2'),
      title: sanitizePathSegment(
        applyTemplate(pathname, parser.statusPathPattern, parser.folderTemplate || 'X_$1_$2'),
        'X'
      ),
      statusPath: pathname,
      mounts: [],
      items: [],
      seen: new Set()
    };
  }

  function getTweetSourceIndex(pathname, parser, fallbackIndex) {
    const sourceIndexText = applyTemplate(
      pathname,
      parser.statusPathPattern,
      parser.sourceIndexTemplate || '$3'
    );
    const parsedIndex = parseInt(sourceIndexText, 10);
    return Number.isFinite(parsedIndex) ? Math.max(0, parsedIndex - 1) : fallbackIndex;
  }

  function getTweetDetailSourceIndexMap(root, parser, options = null) {
    const excludeWithinSelector = String(options?.excludeWithinSelector || '').trim();
    const imageSelector = parser.mediaImageSelector || 'img[src*="pbs.twimg.com/media/"]';
    const videoSelector = parser.videoSelector || '[data-testid="videoComponent"] video';
    const sourceIndexMap = new Map();
    let sourceIndex = 0;
    const carouselSlides = Array.from(
      root.querySelectorAll('[aria-roledescription="carousel"] ul[role="list"] > li[role="listitem"]')
    );
    const swipeSlides = Array.from(root.querySelectorAll('[data-testid="swipe-to-dismiss"]'))
      .map((node) => node.closest('li[role="listitem"]') || node)
      .filter((node, index, nodes) => nodes.indexOf(node) === index);
    const slides = carouselSlides.length
      ? carouselSlides
      : swipeSlides;

    slides.forEach((slide) => {
      if (isWithinSelector(slide, excludeWithinSelector)) {
        return;
      }

      const image = slide.querySelector(imageSelector);
      const video = slide.querySelector(videoSelector);
      if (!image && !video) {
        return;
      }

      if (image && !isWithinSelector(image, excludeWithinSelector)) {
        sourceIndexMap.set(image, sourceIndex);
      }

      if (video && !isWithinSelector(video, excludeWithinSelector)) {
        sourceIndexMap.set(video, sourceIndex);
      }

      sourceIndex += 1;
    });

    return sourceIndexMap;
  }

  function getTweetDetailSourceIndex(node, parser, fallbackIndex, options = null) {
    const sourceIndexMap = options?.sourceIndexMap instanceof Map ? options.sourceIndexMap : null;
    const mappedSourceIndex = sourceIndexMap?.get(node);
    if (Number.isInteger(mappedSourceIndex)) {
      return mappedSourceIndex;
    }

    const statusLink = node?.closest?.('a[href*="/status/"]')
      || node?.querySelector?.('a[href*="/status/"]')
      || null;
    const absoluteHref = toAbsoluteUrl(statusLink?.getAttribute?.('href') || statusLink?.href || '');
    if (absoluteHref) {
      try {
        const pathname = new URL(absoluteHref).pathname;
        if (matchesPattern(pathname, parser.statusPathPattern)) {
          return getTweetSourceIndex(pathname, parser, fallbackIndex);
        }
      } catch {
        // Ignore malformed status links and fall through to the current location.
      }
    }

    return getTweetSourceIndex(location.pathname, parser, fallbackIndex);
  }

  function getTweetStatusLink(tweet, parser) {
    const timeNode = tweet.querySelector('time');
    const timeLink = timeNode?.closest?.('a[href*="/status/"]') || null;
    if (matchesTweetScope(timeLink, parser.tweetSelector, tweet)) {
      return timeLink;
    }

    const statusSelector = parser.statusLinkSelector || 'a[href*="/status/"]';
    return Array.from(tweet.querySelectorAll(statusSelector)).find((link) => {
      if (!matchesTweetScope(link, parser.tweetSelector, tweet)) {
        return false;
      }

      const href = link.getAttribute('href') || '';
      return href.includes('/status/') && !href.includes('/analytics');
    }) || null;
  }

  function getTweetStatusPath(tweet, parser) {
    const photoLink = Array.from(tweet.querySelectorAll(parser.mediaLinkSelector || 'a[href*="/status/"]'))
      .find((link) => matchesTweetScope(link, parser.tweetSelector, tweet));

    if (photoLink) {
      const absolutePhotoHref = toAbsoluteUrl(photoLink.getAttribute('href') || photoLink.href || '');
      if (absolutePhotoHref) {
        try {
          const pathname = new URL(absolutePhotoHref).pathname;
          if (matchesPattern(pathname, parser.statusPathPattern)) {
            return pathname;
          }
        } catch {
          // Ignore malformed paths.
        }
      }
    }

    const statusLink = getTweetStatusLink(tweet, parser);
    if (!statusLink) {
      return '';
    }

    const absoluteHref = toAbsoluteUrl(statusLink.getAttribute('href') || statusLink.href || '');
    if (!absoluteHref) {
      return '';
    }

    try {
      const pathname = new URL(absoluteHref).pathname;
      return matchesPattern(pathname, parser.statusPathPattern) ? pathname : '';
    } catch {
      return '';
    }
  }

  function getTweetGroupKeyFromPath(pathname, parser) {
    return applyTemplate(pathname, parser?.statusPathPattern, parser?.groupTemplate || '$1/$2');
  }

  function getTweetDetailFallbackContext(site, groupKey = '') {
    const placement = site?.ui?.placement || {};
    if (placement.engine !== 'tweet_action_bar') {
      return null;
    }

    const selector = placement.actionGroupSelector || '[role="group"]';
    const referenceSelector = placement.referenceButtonSelector || 'button[class^="css-175"]';
    const documentFallback = placement.documentFallback && typeof placement.documentFallback === 'object'
      ? placement.documentFallback
      : null;
    const currentGroupKey = getTweetGroupKeyFromPath(location.pathname, site?.parser || {});

    if (
      !documentFallback ||
      !currentGroupKey ||
      (groupKey && currentGroupKey !== groupKey) ||
      (documentFallback.whenPathPattern && !matchesPattern(location.pathname, documentFallback.whenPathPattern))
    ) {
      return null;
    }

    const rootSelector = String(documentFallback.rootSelector || '').trim();
    const actionSelector = documentFallback.actionGroupSelector || selector;
    const fallbackReferenceSelector = documentFallback.referenceButtonSelector || referenceSelector;
    const excludeWithinSelector = String(documentFallback.excludeWithinSelector || '').trim();
    const documentRoot = (() => {
      if (!rootSelector) {
        return document;
      }

      try {
        const roots = Array.from(document.querySelectorAll(rootSelector)).filter((node) => node?.isConnected);
        const matchedRoot = roots.find((node) => {
          try {
            return Boolean(node.querySelector(actionSelector));
          } catch {
            return false;
          }
        });
        return matchedRoot || roots[roots.length - 1] || document;
      } catch {
        return document;
      }
    })();

    return {
      currentGroupKey,
      documentRoot,
      actionSelector,
      referenceSelector: fallbackReferenceSelector,
      excludeWithinSelector
    };
  }

  function findTweetDetailFallbackMount(site, group) {
    const context = getTweetDetailFallbackContext(site, group?.key || '');
    if (!context) {
      return null;
    }

    return findActionGroupMount(
      context.documentRoot,
      context.actionSelector,
      context.referenceSelector,
      '',
      null,
      context.documentRoot === document ? document.body : context.documentRoot,
      { excludeWithinSelector: context.excludeWithinSelector }
    );
  }

  function isWithinSelector(node, selector) {
    const normalizedSelector = String(selector || '').trim();
    if (!normalizedSelector || !node || typeof node.closest !== 'function') {
      return false;
    }

    try {
      return Boolean(node.closest(normalizedSelector));
    } catch {
      return false;
    }
  }

  function findActionGroupMount(root, selector, referenceSelector, tweetSelector, tweet, stopNode = null, options = null) {
    const excludeWithinSelector = String(options?.excludeWithinSelector || '').trim();
    const isExcludedNode = (node) => isWithinSelector(node, excludeWithinSelector);
    const scopedButtons = Array.from(root.querySelectorAll(referenceSelector)).filter((node) => {
      if (isExcludedNode(node)) {
        return false;
      }

      if (!tweetSelector || !tweet) {
        return true;
      }

      return matchesTweetScope(node, tweetSelector, tweet);
    });

    if (scopedButtons.length && tweetSelector && tweet) {
      let node = scopedButtons[0].parentElement;
      while (node) {
        let matchesGroupSelector = false;
        try {
          matchesGroupSelector = typeof node.matches === 'function' && node.matches(selector);
        } catch {
          matchesGroupSelector = false;
        }

        if (matchesGroupSelector && scopedButtons.every((button) => node.contains(button))) {
          return node;
        }

        if (node === stopNode) {
          break;
        }

        node = node.parentElement;
      }
    }

    const candidates = Array.from(root.querySelectorAll(selector))
      .filter((node) => {
        if (isExcludedNode(node)) {
          return false;
        }

        if (!tweetSelector || !tweet) {
          return true;
        }

        return matchesTweetScope(node, tweetSelector, tweet);
      })
      .map((candidate) => ({
        candidate,
        matchCount: (() => {
          try {
            return candidate.querySelectorAll(referenceSelector).length;
          } catch {
            return 0;
          }
        })(),
        size: (() => {
          try {
            return candidate.querySelectorAll('*').length;
          } catch {
            return Number.MAX_SAFE_INTEGER;
          }
        })()
      }))
      .sort((left, right) => {
        if (right.matchCount !== left.matchCount) {
          return right.matchCount - left.matchCount;
        }

        return left.size - right.size;
      });

    if (candidates[0]?.candidate && candidates[0].matchCount > 0) {
      return candidates[0].candidate;
    }

    if (scopedButtons.length < 2) {
      return null;
    }

    const ancestors = [];
    let node = scopedButtons[0].parentElement;
    while (node && node !== stopNode) {
      ancestors.push(node);
      node = node.parentElement;
    }

    if (stopNode) {
      ancestors.push(stopNode);
    }

    return ancestors.find((candidate) =>
      candidate && scopedButtons.every((button) => candidate.contains(button))
    ) || scopedButtons[0].parentElement || null;
  }

  function getTweetMounts(site, tweet, group) {
    const placement = site?.ui?.placement || {};
    if (placement.engine === 'tweet_action_bar') {
      const selector = placement.actionGroupSelector || '[role="group"]';
      const referenceSelector = placement.referenceButtonSelector || 'button[class^="css-175"]';
      const detailMount = findTweetDetailFallbackMount(site, group);
      if (detailMount) {
        addGroupMount(group, detailMount);
        return;
      }

      const mount = findActionGroupMount(
        tweet,
        selector,
        referenceSelector,
        site?.parser?.tweetSelector,
        tweet,
        tweet
      );

      if (mount) {
        addGroupMount(group, mount);
      }
    }
  }

  function addTweetImageItems(site, tweet, parser, group) {
    const placement = site?.ui?.placement || {};
    const links = Array.from(tweet.querySelectorAll(parser.mediaLinkSelector || 'a[href*="/status/"]'))
      .filter((link) => matchesTweetScope(link, parser.tweetSelector, tweet));

    links.forEach((link) => {
      const absoluteHref = toAbsoluteUrl(link.getAttribute('href') || link.href || '');
      if (!absoluteHref) {
        return;
      }

      let pathname = '';
      try {
        pathname = new URL(absoluteHref).pathname;
      } catch {
        return;
      }

      if (!matchesPattern(pathname, parser.statusPathPattern)) {
        return;
      }

      const previewNode = parser.mediaImageSelector
        ? link.querySelector(parser.mediaImageSelector)
        : link.querySelector('img');
      const previewUrl = toAbsoluteUrl(previewNode?.getAttribute('src') || previewNode?.src || '');
      const originalUrl = applyFirstTransform(previewUrl, parser.previewTransforms || []);
      if (!originalUrl) {
        return;
      }

      if (placement.engine === 'overlay_anchor') {
        addGroupMount(group, link);
      }

      const itemKey = `image:${originalUrl}`;
      if (group.seen.has(itemKey)) {
        return;
      }

      group.seen.add(itemKey);
      group.items.push({
        originalUrl,
        previewUrl,
        type: 'image',
        sourceIndex: getTweetSourceIndex(pathname, parser, group.items.length),
        delivery: 'background'
      });
    });
  }

  function extractVideoIdFromPosterUrl(parser, posterUrl) {
    const pattern = parser.videoPosterPattern
      || '(?:(?:amplify_|ext_tw_)?video_thumb|tweet_video_thumb)/([^/?#.]+)(?:/|\\.)';
    const regex = toRegExp(pattern, 'i');
    const match = regex?.exec(String(posterUrl || ''));
    return match ? match[1] : '';
  }

  function getTweetVideoSourceUrl(video, sourceSelector) {
    const sourceNode = video.querySelector(sourceSelector);
    return toAbsoluteUrl(
      sourceNode?.getAttribute('src')
      || video.getAttribute('src')
      || video.currentSrc
      || ''
    );
  }

  function getTweetVideoType(posterUrl, sourceUrl) {
    return /\/tweet_video_thumb\//i.test(String(posterUrl || ''))
      || /\/tweet_video\//i.test(String(sourceUrl || ''))
      ? 'gif'
      : 'video';
  }

  function addTweetVideoItems(tweet, parser, group) {
    const videoSelector = parser.videoSelector || '[data-testid="videoComponent"] video';
    const videoSourceSelector = parser.videoSourceSelector || 'source';

    Array.from(tweet.querySelectorAll(videoSelector))
      .filter((video) => matchesTweetScope(video, parser.tweetSelector, tweet))
      .forEach((video) => {
        const posterUrl = toAbsoluteUrl(video.getAttribute('poster') || '');
        if (!posterUrl) {
          return;
        }

        const videoId = extractVideoIdFromPosterUrl(parser, posterUrl);
        const blobUrl = getTweetVideoSourceUrl(video, videoSourceSelector);
        const mediaType = getTweetVideoType(posterUrl, blobUrl);
        const itemKey = `video:${videoId || posterUrl || blobUrl}`;
        if (group.seen.has(itemKey)) {
          return;
        }

        group.seen.add(itemKey);
        group.items.push({
          originalUrl: blobUrl || `x-video://${videoId || group.key}`,
          previewUrl: posterUrl,
          type: mediaType,
          sourceIndex: getTweetSourceIndex(group.statusPath, parser, group.items.length),
          delivery: 'local',
          blobUrl,
          videoId,
          statusPath: group.statusPath,
          mediaElement: video,
          downloadBasename: videoId
            ? `${mediaType === 'gif' ? 'tweet_video' : 'amplify_video'}_${videoId}.mp4`
            : 'tweet_video.mp4'
        });
      });
  }

  function addTweetDetailFallbackImageItems(root, parser, group, options = null) {
    const excludeWithinSelector = String(options?.excludeWithinSelector || '').trim();
    const sourceIndexMap = options?.sourceIndexMap instanceof Map ? options.sourceIndexMap : null;
    Array.from(root.querySelectorAll(parser.mediaImageSelector || 'img[src*="pbs.twimg.com/media/"]'))
      .forEach((image, index) => {
        if (isWithinSelector(image, excludeWithinSelector)) {
          return;
        }

        if (sourceIndexMap?.size && !sourceIndexMap.has(image)) {
          return;
        }

        const previewUrl = toAbsoluteUrl(image.getAttribute('src') || image.src || '');
        const originalUrl = applyFirstTransform(previewUrl, parser.previewTransforms || []);
        if (!previewUrl || !originalUrl) {
          return;
        }

        const itemKey = `image:${originalUrl}`;
        if (group.seen.has(itemKey)) {
          return;
        }

        group.seen.add(itemKey);
        group.items.push({
          originalUrl,
          previewUrl,
          type: 'image',
          sourceIndex: getTweetDetailSourceIndex(image, parser, index, options),
          delivery: 'background'
        });
      });
  }

  function addTweetDetailFallbackVideoItems(root, parser, group, options = null) {
    const videoSelector = parser.videoSelector || '[data-testid="videoComponent"] video';
    const videoSourceSelector = parser.videoSourceSelector || 'source';
    const excludeWithinSelector = String(options?.excludeWithinSelector || '').trim();
    const sourceIndexMap = options?.sourceIndexMap instanceof Map ? options.sourceIndexMap : null;

    Array.from(root.querySelectorAll(videoSelector)).forEach((video, index) => {
      if (isWithinSelector(video, excludeWithinSelector)) {
        return;
      }

      if (sourceIndexMap?.size && !sourceIndexMap.has(video)) {
        return;
      }

      const posterUrl = toAbsoluteUrl(video.getAttribute('poster') || '');
      if (!posterUrl) {
        return;
      }

      const videoId = extractVideoIdFromPosterUrl(parser, posterUrl);
      const blobUrl = getTweetVideoSourceUrl(video, videoSourceSelector);
      const mediaType = getTweetVideoType(posterUrl, blobUrl);
      const itemKey = `video:${videoId || posterUrl || blobUrl}`;
      if (group.seen.has(itemKey)) {
        return;
      }

      group.seen.add(itemKey);
      group.items.push({
        originalUrl: blobUrl || `x-video://${videoId || group.key}`,
        previewUrl: posterUrl,
        type: mediaType,
        sourceIndex: getTweetDetailSourceIndex(video, parser, index, options),
        delivery: 'local',
        blobUrl,
        videoId,
        statusPath: group.statusPath,
        mediaElement: video,
        downloadBasename: videoId
          ? `${mediaType === 'gif' ? 'tweet_video' : 'amplify_video'}_${videoId}.mp4`
          : 'tweet_video.mp4'
      });
    });
  }

  function ensureTweetDetailFallbackGroup(site, groups) {
    const parser = site?.parser || {};
    const context = getTweetDetailFallbackContext(site);
    if (!context) {
      return;
    }

    let group = groups.get(context.currentGroupKey);
    if (!group) {
      group = createTweetGroup(location.pathname, parser);
      groups.set(group.key, group);
    }

    const mount = findTweetDetailFallbackMount(site, group);
    if (mount) {
      addGroupMount(group, mount);
    }

    const sourceIndexMap = getTweetDetailSourceIndexMap(context.documentRoot, parser, {
      excludeWithinSelector: context.excludeWithinSelector
    });
    addTweetDetailFallbackImageItems(context.documentRoot, parser, group, {
      excludeWithinSelector: context.excludeWithinSelector,
      sourceIndexMap
    });
    addTweetDetailFallbackVideoItems(context.documentRoot, parser, group, {
      excludeWithinSelector: context.excludeWithinSelector,
      sourceIndexMap
    });
  }

  function buildTweetGroups(site, requireMounts = false) {
    const parser = site?.parser || {};
    if (!parser.tweetSelector || !parser.statusPathPattern) {
      return [];
    }

    const groups = new Map();

    document.querySelectorAll(parser.tweetSelector).forEach((tweet) => {
      const statusPath = getTweetStatusPath(tweet, parser);
      if (!statusPath) {
        return;
      }

      const groupKey = applyTemplate(statusPath, parser.statusPathPattern, parser.groupTemplate || '$1/$2');
      if (!groupKey) {
        return;
      }

      let group = groups.get(groupKey);
      if (!group) {
        group = createTweetGroup(statusPath, parser);
        groups.set(groupKey, group);
      }

      getTweetMounts(site, tweet, group);
      addTweetImageItems(site, tweet, parser, group);
      addTweetVideoItems(tweet, parser, group);
    });

    ensureTweetDetailFallbackGroup(site, groups);

    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        mounts: group.mounts.filter((mount) => mount && mount.isConnected),
        items: group.items
          .slice()
          .sort((a, b) => a.sourceIndex - b.sourceIndex)
          .map((item, index) => ({
            ...item,
            sourceIndex: index
          }))
      }))
      .filter((group) => group.items.length > 0 && (!requireMounts || group.mounts.length > 0));
  }

  async function ensureReady() {
    if (runtime.readyPromise) {
      return runtime.readyPromise;
    }

    runtime.readyPromise = new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getSiteConfig', host: location.hostname }, (response) => {
        if (!chrome.runtime.lastError && response?.payload) {
          runtime.payload = response.payload;
          runtime.site = resolveSite(response.payload);
        }

        resolve(runtime.site);
      });
    });

    return runtime.readyPromise;
  }

  function getTweetMediaItems(site) {
    return buildTweetGroups(site, false).flatMap((group) =>
      group.items.map((item) => ({
        ...item,
        folderTitle: group.title
      }))
    );
  }

  function getTweetInlineTargets(site) {
    if (site.ui?.mode !== 'inline') {
      return [];
    }

    return buildTweetGroups(site, true).flatMap((group) =>
      group.mounts.map((mount, index) => ({
        id: `${group.key}::${index}`,
        groupKey: group.key,
        title: group.title,
        mount,
        downloads: group.items.map((item) => ({ ...item })),
        count: group.items.length,
        label: site.ui?.buttonLabel || 'Download',
        tooltip: site.ui?.buttonTooltip || 'Download media',
        placement: site.ui?.placement || {},
        buttonStyle: site.ui?.buttonStyle || {}
      }))
    );
  }

  async function collectArcaMediaForPageUrl(site, pageUrl) {
    const normalizedPageUrl = getArcaListEntryId(pageUrl);
    if (!normalizedPageUrl) {
      return [];
    }

    if (getArcaListEntryId(location.href) === normalizedPageUrl) {
      const title = site.parser?.title
        ? buildTitleFromConfig(site)
        : sanitizePathSegment(document.title, 'Arca');
      return getArcaMediaItems(site).map((item) => ({
        ...item,
        folderTitle: item.folderTitle || title,
        pageUrl: normalizedPageUrl,
        pageTitle: title
      }));
    }

    try {
      const payload = await loadArcaListEntryFromFrame(site, {
        articleUrl: normalizedPageUrl,
        previewUrl: ''
      });
      return Array.isArray(payload?.downloadItems) ? payload.downloadItems : [];
    } catch {
      return [];
    }
  }

  const siteAdapters = Object.freeze({
    arca_article: Object.freeze({
      collectMedia: getArcaMediaItems,
      collectInlineTargets: (site) => site.parser?.list ? getArcaListInlineTargets(site) : [],
      collectMediaForPageUrl: collectArcaMediaForPageUrl,
      supportsInlineTargets: (site) => Boolean(site.parser?.list)
    }),
    tweet_media: Object.freeze({
      collectMedia: getTweetMediaItems,
      collectInlineTargets: getTweetInlineTargets,
      supportsInlineTargets: (site) => site.ui?.mode === 'inline'
    })
  });

  function getSiteAdapter(site = getResolvedSite()) {
    return siteAdapters[site?.parser?.engine] || null;
  }

  function getMediaItems() {
    const site = getResolvedSite();
    return getSiteAdapter(site)?.collectMedia?.(site) || [];
  }

  function getArticleTitle() {
    const site = getResolvedSite();
    if (site?.parser?.title) {
      return buildTitleFromConfig(site);
    }

    const pageTitle = String(document.title || '').split(' - ')[0].trim();
    return sanitizePathSegment(pageTitle, 'Arca');
  }

  function getSiteDownloadConfig() {
    const site = getResolvedSite();
    return site?.download && typeof site.download === 'object' ? { ...site.download } : {};
  }

  async function collectMediaForPageUrl(pageUrl) {
    const site = getResolvedSite();
    const adapter = getSiteAdapter(site);
    return adapter?.collectMediaForPageUrl
      ? adapter.collectMediaForPageUrl(site, pageUrl)
      : [];
  }

  function getInlineTargets() {
    const site = getResolvedSite();
    return getSiteAdapter(site)?.collectInlineTargets?.(site) || [];
  }

  function supportsInlineTargets() {
    const site = getResolvedSite();
    return Boolean(getSiteAdapter(site)?.supportsInlineTargets?.(site));
  }
  function invalidateInlineTargetsAvailability() {
    runtime.inlineListEntries.forEach((entry) => {
      if (entry?.allDownloads?.length) {
        entry.needsAvailabilityRefresh = true;
      }
    });
    dispatchInlineTargetsUpdated();
  }

  window.__arcaDL = {
    waitUntilReady: ensureReady,
    getMediaItems,
    getArticleTitle,
    getSiteDownloadConfig,
    collectMediaForPageUrl,
    getInlineTargets,
    supportsInlineTargets,
    invalidateInlineTargetsAvailability,
    prepareInlineTarget,
    getUiConfig,
    getSiteId
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action !== 'collectPageMedia') {
      return undefined;
    }

    ensureReady().then(async () => {
      const items = await collectMediaForPageUrl(String(message.pageUrl || ''));
      sendResponse({ ok: true, items });
    }).catch(() => {
      sendResponse({ ok: false, items: [] });
    });

    return true;
  });

  void ensureReady();
})();
