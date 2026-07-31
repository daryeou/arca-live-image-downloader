const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateExtension } = require('./validate-extension.js');

function write(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function withFixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arca-validator-'));
  try {
    write(root, 'src/manifest.json', JSON.stringify({
      manifest_version: 3,
      background: { service_worker: 'background/background.js' },
      content_scripts: [{ js: ['shared/media-utils.js', 'content/content.js'] }],
      icons: { 16: 'icons/icon16.png' }
    }));
    write(
      root,
      'src/background/background.js',
      "importScripts('../shared/media-utils.js');"
    );
    write(root, 'src/shared/media-utils.js', 'globalThis.ArcaDLShared = {};');
    write(root, 'src/content/content.js', 'globalThis.fixture = true;');
    write(root, 'src/icons/icon16.png', 'synthetic');
    write(
      root,
      'src/config/site-config.default.json',
      '{"version":1,"sites":[]}'
    );
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

withFixture((root) => {
  assert.deepEqual(validateExtension(root).errors, []);
});

withFixture((root) => {
  fs.rmSync(path.join(root, 'src/content/content.js'));
  assert.match(validateExtension(root).errors.join('\n'), /content[\\/]content\.js/);
});

withFixture((root) => {
  write(root, 'src/shared/media-utils.js', 'function broken( {');
  assert.match(validateExtension(root).errors.join('\n'), /media-utils\.js/);
});

withFixture((root) => {
  fs.mkdirSync(path.join(root, '.codex-skill-build'));
  assert.match(validateExtension(root).errors.join('\n'), /\.codex-skill-build/);
});

withFixture((root) => {
  write(root, 'src/README.md', 'repository-only documentation');
  assert.match(validateExtension(root).errors.join('\n'), /src[\\/]README\.md/);
});

console.log('validate-extension tests: PASS');
