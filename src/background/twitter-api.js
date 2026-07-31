(() => {
  const Shared = globalThis.ArcaDLShared;
  const TWITTER_TOKEN_CACHE_MS = 10 * 60 * 1000;
  const TWITTER_DEFAULT_GRAPHQL_OPERATION_ID = 'zy39CwTyYhU-_0LP7dljjg';
  const TWITTER_MAIN_JS_URL_PATTERN = /https:\/\/abs\.twimg\.com\/responsive-web\/client-web(?:-legacy)?\/main\.[^"' ]+\.js/g;
  const TWITTER_TWEET_RESULT_OPERATION_PATTERN = /queryId:"([^"]+)",operationName:"TweetResultByRestId"/;
  const TWITTER_BEARER_TOKEN_PATTERN = /AAAAAAAAA[^"'\\\s]+/g;
  const TWITTER_GRAPHQL_FEATURES = {
    responsive_web_graphql_exclude_directive_enabled: true,
    verified_phone_label_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    tweetypie_unmention_optimization_enabled: true,
    vibe_api_enabled: false,
    responsive_web_edit_tweet_api_enabled: false,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: false,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: false,
    standardized_nudges_misinfo: false,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: false,
    interactive_text_enabled: false,
    responsive_web_twitter_blue_verified_badge_is_enabled: true,
    responsive_web_text_conversations_enabled: false,
    longform_notetweets_richtext_consumption_enabled: false,
    responsive_web_enhance_cards_enabled: false,
    longform_notetweets_inline_media_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    responsive_web_media_download_video_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    creator_subscriptions_tweet_preview_api_enabled: true
  };
  const TWITTER_GRAPHQL_VARIABLES = {
    with_rux_injections: false,
    includePromotedContent: true,
    withCommunity: true,
    withQuickPromoteEligibilityTweetFields: true,
    withBirdwatchNotes: true,
    withDownvotePerspective: false,
    withReactionsMetadata: false,
    withReactionsPerspective: false,
    withVoice: true,
    withV2Timeline: true
  };

  let tokenCache = {
    fetchedAt: 0,
    mainJsUrl: '',
    bearerToken: '',
    guestToken: '',
    tweetResultOperationId: ''
  };
  let graphqlFeatures = { ...TWITTER_GRAPHQL_FEATURES };
  let graphqlVariables = { ...TWITTER_GRAPHQL_VARIABLES };

  function isFreshTokenCache() {
    return (
      tokenCache.guestToken
      && tokenCache.bearerToken
      && Date.now() - tokenCache.fetchedAt < TWITTER_TOKEN_CACHE_MS
    );
  }

  function normalizeRequestOptions(options = {}) {
    if (typeof options === 'boolean') {
      return { forceRefresh: options, mainJsUrl: '' };
    }

    return {
      forceRefresh: options?.forceRefresh === true,
      mainJsUrl: Shared.normalizeTwitterMainJsUrl(options?.mainJsUrl || '')
    };
  }

  function setMainJsUrl(value) {
    const mainJsUrl = Shared.normalizeTwitterMainJsUrl(value);
    if (!mainJsUrl) {
      return '';
    }

    if (tokenCache.mainJsUrl !== mainJsUrl) {
      tokenCache = {
        fetchedAt: 0,
        mainJsUrl,
        bearerToken: '',
        guestToken: '',
        tweetResultOperationId: ''
      };
    }
    return mainJsUrl;
  }

  async function fetchText(url, options = {}) {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      ...options
    });

    if (!response.ok) {
      throw new Error(`http-${response.status}:${url}`);
    }

    return response.text();
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'omit',
      ...options
    });

    if (!response.ok) {
      throw new Error(`http-${response.status}:${url}`);
    }

    return response.json();
  }

  async function getMainJsUrl(options = {}) {
    const { forceRefresh, mainJsUrl } = normalizeRequestOptions(options);
    if (mainJsUrl) {
      return setMainJsUrl(mainJsUrl);
    }

    if (!forceRefresh && tokenCache.mainJsUrl) {
      return tokenCache.mainJsUrl;
    }

    const html = await fetchText('https://x.com/');
    const mainJsUrls = html.match(TWITTER_MAIN_JS_URL_PATTERN);
    const discoveredMainJsUrl = Shared.findTwitterMainJsUrl(mainJsUrls || []);
    if (!discoveredMainJsUrl) {
      throw new Error('twitter-mainjs-not-found');
    }

    return setMainJsUrl(discoveredMainJsUrl);
  }

  async function ensureMainJsMetadata(options = {}) {
    const normalizedOptions = normalizeRequestOptions(options);
    if (normalizedOptions.mainJsUrl) {
      setMainJsUrl(normalizedOptions.mainJsUrl);
    }
    if (
      !normalizedOptions.forceRefresh
      && tokenCache.bearerToken
      && tokenCache.tweetResultOperationId
    ) {
      return;
    }

    const mainJsUrl = await getMainJsUrl(normalizedOptions);
    const mainJs = await fetchText(mainJsUrl);
    const bearerTokenMatch = mainJs.match(TWITTER_BEARER_TOKEN_PATTERN);
    if (!bearerTokenMatch?.length) {
      throw new Error('twitter-bearer-token-not-found');
    }

    tokenCache.bearerToken = bearerTokenMatch[0].replace(/^Bearer\s+/i, '');
    const operationMatch = mainJs.match(TWITTER_TWEET_RESULT_OPERATION_PATTERN);
    tokenCache.tweetResultOperationId = operationMatch?.[1] || TWITTER_DEFAULT_GRAPHQL_OPERATION_ID;
  }

  async function getGuestToken(options = {}, metadataReady = false) {
    const { forceRefresh } = normalizeRequestOptions(options);
    if (!forceRefresh && isFreshTokenCache()) {
      return tokenCache.guestToken;
    }

    if (!metadataReady) {
      await ensureMainJsMetadata(options);
    }
    const bearerToken = tokenCache.bearerToken;
    const payload = await fetchJson('https://api.twitter.com/1.1/guest/activate.json', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bearerToken}`
      }
    });

    if (!payload?.guest_token) {
      throw new Error('twitter-guest-token-not-found');
    }

    tokenCache = {
      fetchedAt: Date.now(),
      mainJsUrl: tokenCache.mainJsUrl,
      bearerToken,
      guestToken: payload.guest_token,
      tweetResultOperationId: tokenCache.tweetResultOperationId
    };
    return tokenCache.guestToken;
  }

  function formatDetailsUrl(tweetId) {
    const variables = {
      ...graphqlVariables,
      tweetId: String(tweetId)
    };
    return `https://x.com/i/api/graphql/${tokenCache.tweetResultOperationId}/TweetResultByRestId?variables=${encodeURIComponent(
      JSON.stringify(variables)
    )}&features=${encodeURIComponent(JSON.stringify(graphqlFeatures))}`;
  }

  async function buildDetailsRequest(tweetId, options = {}) {
    await ensureMainJsMetadata(options);
    return {
      url: formatDetailsUrl(tweetId),
      bearerToken: tokenCache.bearerToken
    };
  }

  function applyGraphqlErrorHints(payload) {
    const errors = Array.isArray(payload?.errors) ? payload.errors : [];
    let changed = false;

    errors.forEach((error) => {
      const message = String(error?.message || '');
      const variableMatch = message.match(/Variable '([^']+)'/g) || [];
      const featureMatch = message.match(/The following features cannot be null: ([^"]+)/);

      variableMatch.forEach((entry) => {
        const key = entry.match(/Variable '([^']+)'/)?.[1];
        if (key && graphqlVariables[key] !== true) {
          graphqlVariables[key] = true;
          changed = true;
        }
      });

      if (featureMatch?.[1]) {
        featureMatch[1].split(',').map((name) => name.trim()).filter(Boolean).forEach((key) => {
          if (graphqlFeatures[key] !== true) {
            graphqlFeatures[key] = true;
            changed = true;
          }
        });
      }
    });

    return changed;
  }

  async function fetchTweetDetails(tweetId, options = {}) {
    const normalizedOptions = normalizeRequestOptions(options);
    await ensureMainJsMetadata(normalizedOptions);
    const bearerToken = tokenCache.bearerToken;
    const guestToken = await getGuestToken(normalizedOptions, true);
    const detailsUrl = formatDetailsUrl(tweetId);
    const response = await fetch(detailsUrl, {
      cache: 'no-store',
      credentials: 'omit',
      headers: {
        authorization: `Bearer ${bearerToken}`,
        'x-guest-token': guestToken
      }
    });

    if (!response.ok) {
      if (response.status === 400) {
        try {
          const payload = await response.json();
          if (applyGraphqlErrorHints(payload)) {
            return fetchTweetDetails(tweetId, {
              ...normalizedOptions,
              forceRefresh: true
            });
          }
        } catch {
          // Ignore parsing errors and continue with the status-based fallback.
        }
      }

      if (!normalizedOptions.forceRefresh && (response.status === 401 || response.status === 403)) {
        return fetchTweetDetails(tweetId, {
          ...normalizedOptions,
          forceRefresh: true
        });
      }

      if (!normalizedOptions.forceRefresh && response.status === 404) {
        tokenCache.tweetResultOperationId = '';
        return fetchTweetDetails(tweetId, {
          ...normalizedOptions,
          forceRefresh: true
        });
      }

      throw new Error(`twitter-details-${response.status}`);
    }

    return response.json();
  }

  globalThis.ArcaDLTwitterApi = Object.freeze({
    buildDetailsRequest,
    fetchTweetDetails
  });
})();
