#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const projectRootArg = process.argv[2];
const projectRoot = projectRootArg ? path.resolve(projectRootArg) : process.cwd();

const results = [];
let hasFailure = false;
let manifest;
let manifestPath;

function recordResult(status, name, description, detail) {
  const line = detail ? `${status} ${name} - ${description}: ${detail}` : `${status} ${name} - ${description}`;
  console.log(line);
  if (status === 'FAIL') {
    hasFailure = true;
  }
}

function runCheck(name, description, fn) {
  try {
    const detail = fn();
    if (detail === 'SKIP') {
      recordResult('SKIP', name, description);
    } else if (typeof detail === 'string' && detail.startsWith('SKIP:')) {
      recordResult('SKIP', name, description, detail.slice(5).trim());
    } else if (detail && detail.note) {
      recordResult('PASS', name, description, detail.note);
    } else {
      recordResult('PASS', name, description);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    recordResult('FAIL', name, description, message);
  }
}

function ensure(condition, errorMessage) {
  if (!condition) {
    throw new Error(errorMessage);
  }
}

function tryBuildManifestIfNeeded(root) {
  const tsManifestPath = path.join(root, 'project.ts');
  const yamlManifestPath = path.join(root, 'project.yaml');
  if (fs.existsSync(tsManifestPath) && !fs.existsSync(yamlManifestPath)) {
    const result = spawnSync('npx', ['subql', 'build-manifest'], {
      cwd: root,
      stdio: 'inherit',
      env: process.env,
    });
    if (result.status !== 0) {
      throw new Error('Failed to build manifest from project.ts via `subql build-manifest`.');
    }
  }
}

runCheck('project-root', 'Project root directory exists', () => {
  ensure(fs.existsSync(projectRoot), `Directory not found: ${projectRoot}`);
});

runCheck('manifest-detection', 'Locate project.yaml', () => {
  tryBuildManifestIfNeeded(projectRoot);
  const candidate = path.join(projectRoot, 'project.yaml');
  ensure(fs.existsSync(candidate), 'project.yaml not found. Run `subql build-manifest` if using project.ts.');
  manifestPath = candidate;
  return { note: path.relative(projectRoot, manifestPath) };
});

runCheck('manifest-parse', 'Load project manifest', () => {
  ensure(manifestPath, 'Manifest path not resolved.');
  const manifestContent = fs.readFileSync(manifestPath, 'utf8');
  ensure(manifestContent.trim().length > 0, 'project.yaml is empty.');
  manifest = yaml.load(manifestContent);
  ensure(typeof manifest === 'object' && manifest !== null, 'project.yaml did not parse to an object.');
});

runCheck('manifest-spec-version', 'Manifest declares specVersion >= 1.0.0', () => {
  ensure(manifest, 'Manifest must be parsed before validating spec version.');
  ensure(typeof manifest.specVersion === 'string', 'specVersion must be a string.');
  ensure(manifest.specVersion.localeCompare('1.0.0', undefined, { numeric: true }) >= 0, 'specVersion must be >= 1.0.0.');
  return { note: manifest.specVersion };
});

runCheck('manifest-runner', 'Runner node is set to @subql/node-concordium', () => {
  ensure(manifest?.runner?.node?.name, 'runner.node.name is missing.');
  ensure(manifest.runner.node.name === '@subql/node-concordium', `runner.node.name expected "@subql/node-concordium", received "${manifest.runner.node.name}".`);
});

runCheck('manifest-schema', 'Schema file path exists', () => {
  ensure(manifest?.schema, 'schema section missing from manifest.');
  const schemaFile = typeof manifest.schema === 'string' ? manifest.schema : manifest.schema.file;
  ensure(schemaFile, 'schema.file is not defined.');
  const schemaPath = path.resolve(path.dirname(manifestPath), schemaFile);
  ensure(fs.existsSync(schemaPath), `Schema file not found: ${schemaFile}`);
  const content = fs.readFileSync(schemaPath, 'utf8').trim();
  ensure(content.length > 0, `Schema file ${schemaFile} is empty.`);
  return { note: schemaFile };
});

runCheck('manifest-datasources', 'At least one dataSource with handlers is configured', () => {
  ensure(Array.isArray(manifest?.dataSources), 'dataSources must be an array.');
  ensure(manifest.dataSources.length > 0, 'dataSources array is empty.');
  manifest.dataSources.forEach((ds, index) => {
    ensure(typeof ds.kind === 'string', `dataSources[${index}].kind must be a string.`);
    ensure(ds.mapping?.handlers && Array.isArray(ds.mapping.handlers) && ds.mapping.handlers.length > 0, `dataSources[${index}] must define at least one handler.`);
  });
});

runCheck('package-json', 'Required package.json scripts exist', () => {
  const pkgPath = path.join(projectRoot, 'package.json');
  ensure(fs.existsSync(pkgPath), 'package.json not found.');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  ensure(pkg.scripts?.codegen, 'package.json missing scripts.codegen.');
  ensure(pkg.scripts?.build, 'package.json missing scripts.build.');
});

runCheck('build-artifacts', 'Build output directory exists (dist/)', () => {
  const distPath = path.join(projectRoot, 'dist');
  if (!fs.existsSync(distPath)) {
    console.log('INFO build-artifacts - dist directory missing, running `subql build`...');
    const result = spawnSync('npx', ['subql', 'build'], {
      cwd: projectRoot,
      stdio: 'inherit',
      env: process.env,
    });
    if (result.status !== 0) {
      throw new Error('`subql build` failed while attempting to create dist output.');
    }
    ensure(fs.existsSync(distPath), 'dist directory still missing after running `subql build`.');
    return { note: `${path.relative(projectRoot, distPath)} (created)` };
  }
  return { note: path.relative(projectRoot, distPath) };
});

runCheck('mapping-artifacts', 'Mapping files referenced in manifest exist', () => {
  ensure(Array.isArray(manifest?.dataSources), 'dataSources must be available to check mappings.');
  const missing = [];
  for (const [index, ds] of manifest.dataSources.entries()) {
    const mappingFile = ds.mapping?.file;
    if (!mappingFile) {
      missing.push(`dataSources[${index}].mapping.file is missing`);
      continue;
    }
    const resolved = path.resolve(path.dirname(manifestPath), mappingFile);
    if (!fs.existsSync(resolved)) {
      missing.push(`${mappingFile}`);
    }
  }
  ensure(missing.length === 0, `Missing mapping artifacts: ${missing.join(', ')}`);
});

if (hasFailure) {
  console.error('SubQuery project validation failed.');
  process.exitCode = 1;
} else {
  console.log('SubQuery project validation passed.');
}
