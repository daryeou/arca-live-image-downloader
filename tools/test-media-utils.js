const assert = require('node:assert/strict');
const {
  sanitizePathSegment,
  getUrlFilename,
  extractTweetId,
  extractTwitterVideoId,
  normalizeTwitterMainJsUrl,
  pickBestTwitterVariant,
  selectTwitterVideoSource
} = require('../src/shared/media-utils.js');

assert.equal(sanitizePathSegment('  a:b  '), 'a_b');
assert.equal(sanitizePathSegment('CON'), '_CON');
assert.equal(
  getUrlFilename('https://pbs.twimg.com/media/example?format=jpg&name=small'),
  'example.jpg'
);
assert.equal(extractTweetId('/someone/status/1234567890/video/1'), '1234567890');
assert.equal(
  extractTwitterVideoId('https://pbs.twimg.com/tweet_video_thumb/VideoId.jpg'),
  'VideoId'
);
assert.equal(
  normalizeTwitterMainJsUrl(
    'https://abs.twimg.com/responsive-web/client-web/main.abc123.js#x'
  ),
  'https://abs.twimg.com/responsive-web/client-web/main.abc123.js'
);
assert.equal(normalizeTwitterMainJsUrl('https://example.com/main.js'), '');
assert.equal(
  pickBestTwitterVariant([
    {
      content_type: 'video/mp4',
      bitrate: 256000,
      url: 'https://video.invalid/low.mp4'
    },
    {
      content_type: 'video/mp4',
      bitrate: 832000,
      url: 'https://video.invalid/high.mp4'
    }
  ]).url,
  'https://video.invalid/high.mp4'
);
assert.equal(
  selectTwitterVideoSource({
    legacy: {
      extended_entities: {
        media: [{
          id_str: '1',
          type: 'animated_gif',
          media_url_https:
            'https://pbs.twimg.com/tweet_video_thumb/GifId.jpg',
          video_info: {
            variants: [{
              content_type: 'video/mp4',
              url: 'https://video.invalid/gif.mp4'
            }]
          }
        }]
      }
    }
  }, 'GifId').mediaType,
  'gif'
);

console.log('media-utils tests: PASS');
