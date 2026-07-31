const assert = require('node:assert/strict');

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
  console.log('twitter-api tests: PASS');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
