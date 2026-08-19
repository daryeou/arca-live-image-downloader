const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../src/shared/media-utils.js');

const mainJsUrl =
  'https://abs.twimg.com/responsive-web/client-web/main.synthetic.js';
const tweetId = '1234567890';
const calls = [];
const expectedPayload = {
  data: {
    tweetResult: {
      result: {
        rest_id: tweetId
      }
    }
  }
};

function response({ status = 200, text = '', json = null }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return text;
    },
    async json() {
      return json;
    }
  };
}

global.fetch = async (url, options = {}) => {
  const requestUrl = String(url);
  calls.push({ url: requestUrl, options });

  if (requestUrl === mainJsUrl) {
    return response({
      text:
        'AAAAAAAAA_SYNTHETIC_PUBLIC_TOKEN ' +
        'queryId:"SyntheticOperationId",' +
        'operationName:"TweetResultByRestId"'
    });
  }

  if (requestUrl === 'https://api.twitter.com/1.1/guest/activate.json') {
    assert.equal(options.method, 'POST');
    assert.equal(
      options.headers.authorization,
      'Bearer AAAAAAAAA_SYNTHETIC_PUBLIC_TOKEN'
    );
    return response({
      json: {
        guest_token: 'synthetic-guest-token'
      }
    });
  }

  if (
    requestUrl.startsWith(
      'https://x.com/i/api/graphql/SyntheticOperationId/TweetResultByRestId'
    )
  ) {
    assert.match(requestUrl, /1234567890/);
    assert.equal(
      options.headers.authorization,
      'Bearer AAAAAAAAA_SYNTHETIC_PUBLIC_TOKEN'
    );
    assert.equal(options.headers['x-guest-token'], 'synthetic-guest-token');
    return response({ json: expectedPayload });
  }

  throw new Error(`Unexpected network request: ${requestUrl}`);
};

require('../src/background/twitter-api.js');

async function run() {
  const detailsRequest =
    await globalThis.ArcaDLTwitterApi.buildDetailsRequest(tweetId, {
      mainJsUrl
    });

  assert.match(
    detailsRequest.url,
    /\/SyntheticOperationId\/TweetResultByRestId/
  );
  assert.match(detailsRequest.url, /1234567890/);
  assert.equal(
    detailsRequest.bearerToken,
    'AAAAAAAAA_SYNTHETIC_PUBLIC_TOKEN'
  );

  const payload = await globalThis.ArcaDLTwitterApi.fetchTweetDetails(
    tweetId,
    { mainJsUrl }
  );

  assert.deepEqual(payload, expectedPayload);
  assert.equal(calls.filter((call) => call.url === mainJsUrl).length, 1);
  assert.equal(calls.length, 3);

  const originalFetch = global.fetch;
  const originalSetTimeout = global.setTimeout;
  const originalClearTimeout = global.clearTimeout;
  try {
    let requestAborted = false;
    global.setTimeout = (callback) => {
      queueMicrotask(callback);
      return 1;
    };
    global.clearTimeout = () => {};
    global.fetch = (_url, options = {}) => {
      if (!options.signal) {
        return Promise.reject(new Error('missing-abort-signal'));
      }
      return new Promise((_resolve, reject) => {
        const abort = () => {
          requestAborted = true;
          reject(new Error('aborted'));
        };
        if (options.signal.aborted) abort();
        else options.signal.addEventListener('abort', abort, { once: true });
      });
    };

    await assert.rejects(
      () => globalThis.ArcaDLTwitterApi.fetchTweetDetails(tweetId, { mainJsUrl }),
      /aborted/
    );
    assert.equal(requestAborted, true);
    requestAborted = false;

    global.document = { cookie: '', scripts: [] };
    global.location = { href: `https://x.com/example/status/${tweetId}`, origin: 'https://x.com' };
    global.performance = { getEntriesByType: () => [] };
    let messageCount = 0;
    global.chrome = {
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          messageCount += 1;
          if (message.action === 'getTwitterDetailsRequest') {
            callback({
              ok: true,
              request: {
                url: `https://x.com/i/api/graphql/synthetic/${tweetId}`,
                bearerToken: 'synthetic-token'
              }
            });
          }
        }
      }
    };
    require('../src/content/twitter-resolver.js');

    const resolved = await Promise.race([
      globalThis.ArcaDLTwitterResolver.resolve({
        type: 'video',
        statusPath: `/example/status/${tweetId}`,
        originalUrl: 'blob:synthetic-video'
      }, 'Synthetic tweet'),
      new Promise((_resolve, reject) => {
        originalSetTimeout(() => reject(new Error('resolver-timeout-missing')), 100);
      })
    ]);
    assert.equal(resolved, null);
    assert.equal(messageCount, 2);
    assert.equal(requestAborted, true);
  } finally {
    global.fetch = originalFetch;
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
  }

  const contentUiSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'content', 'content-ui.js'),
    'utf8'
  );
  assert.match(contentUiSource, /LOCAL_DOWNLOAD_ATTEMPT_TIMEOUT_MS/);
  assert.match(contentUiSource, /LOCAL_DOWNLOAD_MAX_ATTEMPTS/);
  assert.doesNotMatch(
    contentUiSource,
    /async function downloadLocalItem[\s\S]*?while\s*\(true\)/
  );
  assert.match(contentUiSource, /RUNTIME_MESSAGE_TIMEOUT_MS/);
  assert.match(contentUiSource, /function sendRuntimeMessage/);
  assert.doesNotMatch(
    contentUiSource,
    /chrome\.runtime\.sendMessage\(\{ action, downloads, title \}, async/
  );

  const backgroundSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'background', 'background.js'),
    'utf8'
  );
  assert.doesNotMatch(
    backgroundSource,
    /await Promise\.allSettled\(\s*tabs\.map/
  );

  console.log('twitter API and resolver tests: PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
