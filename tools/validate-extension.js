const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function readJson(filePath, errors, checkedFiles) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    checkedFiles.push(filePath);
    return value;
  } catch (error) {
    errors.push(`${normalizePath(filePath)}: ${error.message}`);
    return null;
  }
}

function walkFiles(directory, predicate, output = []) {
  if (!fs.existsSync(directory)) {
    return output;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walkFiles(target, predicate, output);
    } else if (entry.isFile() && predicate(target)) {
      output.push(target);
    }
  }

  return output;
}

function collectManifestPaths(manifest) {
  const references = new Set();
  const add = (value) => {
    if (typeof value === 'string' && value) {
      references.add(value);
    }
  };

  add(manifest?.background?.service_worker);
  for (const script of manifest?.content_scripts || []) {
    for (const file of script?.js || []) {
      add(file);
    }
    for (const file of script?.css || []) {
      add(file);
    }
  }
  for (const value of Object.values(manifest?.icons || {})) {
    add(value);
  }
  for (const value of Object.values(manifest?.action?.default_icon || {})) {
    add(value);
  }

  return [...references];
}

function resolveInside(root, relativePath, label, errors) {
  const target = path.resolve(root, relativePath);
  const boundary = `${path.resolve(root)}${path.sep}`;
  if (target !== path.resolve(root) && !target.startsWith(boundary)) {
    errors.push(`${label}: path escapes src: ${relativePath}`);
    return null;
  }
  return target;
}

function validateReferencedFile(srcRoot, relativePath, errors, checkedFiles) {
  const target = resolveInside(srcRoot, relativePath, 'manifest', errors);
  if (!target) {
    return;
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    errors.push(`Missing manifest file: ${normalizePath(relativePath)}`);
    return;
  }
  checkedFiles.push(target);
}

function validateContentScriptOrder(manifest, errors) {
  for (const [index, script] of (manifest?.content_scripts || []).entries()) {
    const files = Array.isArray(script?.js) ? script.js : [];
    const sharedIndex = files.indexOf('shared/media-utils.js');
    if (sharedIndex > 0) {
      errors.push(
        `content_scripts[${index}]: shared/media-utils.js must load before dependent scripts`
      );
    }
    if (new Set(files).size !== files.length) {
      errors.push(`content_scripts[${index}]: duplicate JavaScript entries`);
    }
  }
}

function validateImportScripts(srcRoot, manifest, errors, checkedFiles) {
  const workerPath = manifest?.background?.service_worker;
  if (!workerPath) {
    return;
  }

  const workerFile = resolveInside(srcRoot, workerPath, 'service worker', errors);
  if (!workerFile || !fs.existsSync(workerFile)) {
    return;
  }

  const source = fs.readFileSync(workerFile, 'utf8');
  const calls = source.matchAll(/importScripts\s*\(([^)]*)\)/g);
  for (const call of calls) {
    const values = call[1].matchAll(/['"]([^'"]+)['"]/g);
    for (const value of values) {
      const target = path.resolve(path.dirname(workerFile), value[1]);
      const boundary = `${path.resolve(srcRoot)}${path.sep}`;
      if (!target.startsWith(boundary)) {
        errors.push(`importScripts path escapes src: ${value[1]}`);
      } else if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        errors.push(`Missing importScripts file: ${normalizePath(value[1])}`);
      } else {
        checkedFiles.push(target);
      }
    }
  }
}

function validateJavaScript(projectRoot, errors, checkedFiles) {
  const directories = [
    path.join(projectRoot, 'src'),
    path.join(projectRoot, 'tools')
  ];
  const files = directories.flatMap((directory) =>
    walkFiles(directory, (file) => path.extname(file) === '.js')
  );

  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], {
      encoding: 'utf8'
    });
    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || 'syntax check failed').trim();
      errors.push(`${normalizePath(path.relative(projectRoot, file))}: ${detail}`);
    } else {
      checkedFiles.push(file);
    }
  }
}

function validateExtension(projectRoot = path.resolve(__dirname, '..')) {
  const root = path.resolve(projectRoot);
  const srcRoot = path.join(root, 'src');
  const errors = [];
  const checkedFiles = [];

  const forbiddenPaths = [
    ['source', 'Legacy directory must be removed: source/'],
    ['src/README.md', 'Repository documentation must not be packaged: src/README.md'],
    ['.codex-skill-build', 'Legacy skill staging must be removed: .codex-skill-build/']
  ];
  for (const [relativePath, message] of forbiddenPaths) {
    if (fs.existsSync(path.join(root, relativePath))) {
      errors.push(message);
    }
  }

  const manifestPath = path.join(srcRoot, 'manifest.json');
  const manifest = readJson(manifestPath, errors, checkedFiles);
  if (manifest) {
    for (const reference of collectManifestPaths(manifest)) {
      validateReferencedFile(srcRoot, reference, errors, checkedFiles);
    }
    validateContentScriptOrder(manifest, errors);
    validateImportScripts(srcRoot, manifest, errors, checkedFiles);
  }

  const siteConfig = readJson(
    path.join(srcRoot, 'config', 'site-config.default.json'),
    errors,
    checkedFiles
  );
  if (siteConfig && !Array.isArray(siteConfig.sites)) {
    errors.push('src/config/site-config.default.json: sites must be an array');
  }

  validateJavaScript(root, errors, checkedFiles);

  return {
    errors,
    checkedFiles: [...new Set(checkedFiles.map((file) => path.resolve(file)))]
  };
}

if (require.main === module) {
  const result = validateExtension();
  if (result.errors.length) {
    console.error(`Extension validation failed with ${result.errors.length} error(s):`);
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`Extension validation: PASS (${result.checkedFiles.length} files checked)`);
  }
}

module.exports = {
  validateExtension
};
