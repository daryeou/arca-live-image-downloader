(() => {
  const Shared = globalThis.ArcaDLShared;
  let cachedMainJsUrl = '';

  function sendMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response || null);
      });
    });
  }

  function getCookieValue(name) {
    const entry = String(document.cookie || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${name}=`));
    if (!entry) {
      return '';
    }

    try {
      return decodeURIComponent(entry.slice(name.length + 1));
    } catch {
      return entry.slice(name.length + 1);
    }
  }

  function getMainJsUrlFromPage() {
    if (cachedMainJsUrl) {
      return cachedMainJsUrl;
    }

    const candidates = Array.from(document.scripts || [])
      .map((script) => script.src)
      .filter(Boolean);

    try {
      performance.getEntriesByType('resource').forEach((entry) => {
        if (entry?.name) {
          candidates.push(entry.name);
        }
      });
    } catch {
      // Script elements are enough when resource timing is unavailable.
    }

    cachedMainJsUrl = Shared.findTwitterMainJsUrl(candidates);
    return cachedMainJsUrl;
  }

  function getDownloadOptions(options = {}) {
    const config = options.downloadConfig && typeof options.downloadConfig === 'object'
      ? options.downloadConfig
      : {};
    return {
      createFolder: typeof options.createFolder === 'boolean' ? options.createFolder : true,
      prefixOrderInFolder: config.prefixOrderInFolder === true,
      downloadParallelism: Number.isFinite(config.parallelism) ? config.parallelism : undefined,
      interDownloadDelayMs: Number.isFinite(config.interDownloadDelayMs)
        ? config.interDownloadDelayMs
        : undefined
    };
  }

  function toResolvedDownload(item, title, source, options = {}) {
    const tweetId = Shared.extractTweetId(item.statusPath || item.originalUrl || '');
    return {
      url: source.url,
      previewUrl: item.previewUrl || source.previewUrl || source.url,
      type: item.type === 'gif' || source.mediaType === 'gif' ? 'gif' : 'video',
      folderTitle: title || item.folderTitle || '',
      pageUrl: String(item.pageUrl || location.href || ''),
      pageTitle: title || item.pageTitle || item.folderTitle || '',
      sourceIndex: item.sourceIndex,
      downloadBasename: Shared.getUrlFilename(
        source.url,
        item.downloadBasename || `tweet_video_${tweetId}.mp4`,
        location.href
      ),
      ...getDownloadOptions(options)
    };
  }

  async function resolveFromBackground(item, title, options = {}) {
    const response = await sendMessage({
      action: 'resolveTwitterVideo',
      item: {
        url: item.originalUrl,
        statusPath: item.statusPath,
        previewUrl: item.previewUrl,
        type: item.type,
        videoId: item.videoId,
        folderTitle: title,
        pageUrl: String(item.pageUrl || location.href || ''),
        pageTitle: title || item.pageTitle || item.folderTitle || '',
        sourceIndex: item.sourceIndex,
        downloadBasename: item.downloadBasename,
        mainJsUrl: getMainJsUrlFromPage(),
        ...getDownloadOptions(options)
      }
    });
    return response?.ok ? response.download || null : null;
  }

  async function requestDetailsRequest(item, forceRefresh = false) {
    const response = await sendMessage({
      action: 'getTwitterDetailsRequest',
      statusPath: item.statusPath,
      url: item.originalUrl,
      mainJsUrl: getMainJsUrlFromPage(),
      forceRefresh
    });
    return response?.ok ? response.request || null : null;
  }

  async function resolveFromPage(item, title, options = {}) {
    const tweetId = Shared.extractTweetId(item.statusPath || item.originalUrl || '');
    if (!tweetId) {
      return null;
    }

    const execute = async (forceRefresh = false) => {
      const request = await requestDetailsRequest(item, forceRefresh);
      if (!request?.url || !request.bearerToken) {
        return null;
      }

      const csrfToken = getCookieValue('ct0');
      const headers = {
        authorization: `Bearer ${request.bearerToken}`
      };
      if (csrfToken) {
        headers['x-csrf-token'] = csrfToken;
        headers['x-twitter-auth-type'] = 'OAuth2Session';
        headers['x-twitter-active-user'] = 'yes';
      }

      const requestUrl = String(request.url || '').replace(/^https:\/\/x\.com/i, location.origin);
      const response = await fetch(requestUrl, {
        credentials: 'include',
        headers
      });
      if (!response.ok) {
        if (!forceRefresh && (response.status === 401 || response.status === 403 || response.status === 404)) {
          return execute(true);
        }
        return null;
      }

      const source = Shared.selectTwitterVideoSource(await response.json(), item.videoId);
      return source ? toResolvedDownload(item, title, source, options) : null;
    };

    try {
      return await execute(false);
    } catch {
      return null;
    }
  }

  function resolveDirect(item, title, options = {}) {
    const url = String(
      item.blobUrl
      || item.mediaElement?.getAttribute?.('src')
      || item.mediaElement?.currentSrc
      || item.originalUrl
      || ''
    ).trim();
    if (!/^https?:\/\//i.test(url)) {
      return null;
    }

    return {
      url,
      previewUrl: item.previewUrl || url,
      type: item.type === 'gif' ? 'gif' : 'video',
      folderTitle: title || item.folderTitle || '',
      pageUrl: String(item.pageUrl || location.href || ''),
      pageTitle: title || item.pageTitle || item.folderTitle || '',
      sourceIndex: item.sourceIndex,
      downloadBasename: Shared.getUrlFilename(
        url,
        item.downloadBasename || 'tweet_video.mp4',
        location.href
      ),
      ...getDownloadOptions(options)
    };
  }

  async function resolve(item, title, options = {}) {
    const directDownload = resolveDirect(item, title, options);
    if (item.type === 'gif' && directDownload) {
      return directDownload;
    }

    return await resolveFromPage(item, title, options)
      || await resolveFromBackground(item, title, options)
      || directDownload;
  }

  globalThis.ArcaDLTwitterResolver = Object.freeze({ resolve });
})();
