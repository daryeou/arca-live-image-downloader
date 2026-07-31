(() => {
  const TWITTER_VIDEO_ID_PATTERN = /(?:(?:amplify_|ext_tw_)?video_thumb|tweet_video_thumb)\/([^/?#.]+)(?:\/|\.)/i;
  const TWITTER_MAIN_JS_PATH_PATTERN = /^\/responsive-web\/client-web(?:-legacy)?\/main\.[a-z0-9._-]+\.js$/i;

  function sanitizePathSegment(value, fallback = '') {
    const normalized = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();

    const cleaned = normalized
      .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
      .substring(0, 100)
      .replace(/[. ]+$/g, '')
      .trim();

    if (!cleaned) {
      return fallback;
    }

    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)) {
      return `_${cleaned}`;
    }

    return cleaned;
  }

  function normalizeSuggestedBasename(value) {
    const text = String(value || '').trim();
    if (!text) {
      return '';
    }

    const dotIndex = text.lastIndexOf('.');
    if (dotIndex > 0 && dotIndex < text.length - 1) {
      const stem = sanitizePathSegment(text.slice(0, dotIndex), '');
      const ext = sanitizePathSegment(text.slice(dotIndex + 1), '');
      if (stem && ext) {
        return `${stem}.${ext}`;
      }
    }

    return sanitizePathSegment(text, '');
  }

  function getUrlFilename(url, suggestedBasename = '', baseHref = '') {
    const normalizedSuggestion = normalizeSuggestedBasename(suggestedBasename);
    if (normalizedSuggestion) {
      return normalizedSuggestion;
    }

    try {
      const parsedUrl = baseHref ? new URL(url, baseHref) : new URL(url);
      const format = sanitizePathSegment(parsedUrl.searchParams.get('format') || '', '');
      let base = decodeURIComponent(parsedUrl.pathname.split('/').pop() || '');
      base = base.replace(/:([a-z0-9_-]+)$/i, '');
      if (format) {
        base = `${base.replace(/\.[^.]+$/g, '')}.${format}`;
      }
      return normalizeSuggestedBasename(base);
    } catch {
      return normalizedSuggestion;
    }
  }

  function toRegExp(pattern, flags = '') {
    if (!pattern) {
      return null;
    }

    try {
      return new RegExp(pattern, flags);
    } catch {
      return null;
    }
  }

  function extractTweetId(value) {
    const match = String(value || '').match(/\/status\/(\d+)/);
    return match ? match[1] : '';
  }

  function extractTwitterVideoId(value) {
    const match = String(value || '').match(TWITTER_VIDEO_ID_PATTERN);
    return match ? match[1] : '';
  }

  function normalizeTwitterMainJsUrl(value) {
    try {
      const url = new URL(String(value || ''));
      if (
        url.protocol !== 'https:'
        || url.hostname !== 'abs.twimg.com'
        || url.port
        || !TWITTER_MAIN_JS_PATH_PATTERN.test(url.pathname)
      ) {
        return '';
      }

      url.hash = '';
      return url.href;
    } catch {
      return '';
    }
  }

  function findTwitterMainJsUrl(values) {
    for (const value of Array.isArray(values) ? values : []) {
      const normalized = normalizeTwitterMainJsUrl(value);
      if (normalized) {
        return normalized;
      }
    }
    return '';
  }

  function findTwitterMediaList(payload) {
    const seen = new Set();
    const mediaKeys = new Set();
    const result = [];
    const queue = [payload];

    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== 'object' || seen.has(node)) {
        continue;
      }

      seen.add(node);
      const media = node.legacy?.extended_entities?.media || node.extended_entities?.media;
      if (Array.isArray(media) && media.length) {
        media.forEach((item) => {
          const key = String(
            item?.id_str
            || item?.id
            || item?.media_key
            || item?.media_url_https
            || item?.media_url
            || ''
          );
          if (!key || !mediaKeys.has(key)) {
            result.push(item);
            if (key) {
              mediaKeys.add(key);
            }
          }
        });
      }

      Object.values(node).forEach((value) => {
        if (value && typeof value === 'object') {
          queue.push(value);
        }
      });
    }

    return result;
  }

  function pickBestTwitterVariant(variants) {
    return (Array.isArray(variants) ? variants : []).reduce((best, variant) => {
      if (!variant?.url || variant.content_type !== 'video/mp4') {
        return best;
      }

      const bitrate = Number.isFinite(variant.bitrate) ? variant.bitrate : 0;
      if (!best || bitrate > best.bitrate) {
        return { ...variant, bitrate };
      }

      return best;
    }, null);
  }

  function extractTwitterVideoSources(payload) {
    return findTwitterMediaList(payload).map((media) => {
      const variant = pickBestTwitterVariant(media?.video_info?.variants);
      if (!variant?.url) {
        return null;
      }

      const previewUrl = media.media_url_https || media.media_url || '';
      return {
        url: variant.url,
        previewUrl,
        videoId: extractTwitterVideoId(previewUrl),
        mediaType: media.type === 'animated_gif' ? 'gif' : 'video'
      };
    }).filter(Boolean);
  }

  function selectTwitterVideoSource(payload, videoId = '') {
    const sources = extractTwitterVideoSources(payload);
    return sources.find((source) =>
      videoId && source.videoId && String(source.videoId) === String(videoId)
    ) || sources[0] || null;
  }

  const api = Object.freeze({
    TWITTER_VIDEO_ID_PATTERN,
    sanitizePathSegment,
    normalizeSuggestedBasename,
    getUrlFilename,
    toRegExp,
    extractTweetId,
    extractTwitterVideoId,
    normalizeTwitterMainJsUrl,
    findTwitterMainJsUrl,
    findTwitterMediaList,
    pickBestTwitterVariant,
    extractTwitterVideoSources,
    selectTwitterVideoSource
  });

  globalThis.ArcaDLShared = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
