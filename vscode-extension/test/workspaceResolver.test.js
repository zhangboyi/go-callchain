const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { resolveGoWorkspacePath, resolveSelectedGoWorkspaceCandidates } = require('../dist/workspaceResolver');

test('uses the workspace root when it contains go.mod', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'go-callchain-root-'));
  fs.writeFileSync(path.join(root, 'go.mod'), 'module root\n');

  const resolved = resolveGoWorkspacePath(root);

  assert.equal(resolved, root);
});

test('uses a Go module child when workspace root is a parent folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'go-callchain-parent-'));
  fs.mkdirSync(path.join(root, 'frontend'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backend'), { recursive: true });
  fs.writeFileSync(path.join(root, 'frontend', 'package.json'), '{}');
  fs.writeFileSync(path.join(root, 'backend', 'go.mod'), 'module backend\n');

  const resolved = resolveGoWorkspacePath(root);

  assert.equal(resolved, path.join(root, 'backend'));
});

test('prefers active Go file nearest module when there are multiple Go modules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'go-callchain-multi-'));
  const api = path.join(root, 'api');
  const worker = path.join(root, 'worker');
  fs.mkdirSync(path.join(api, 'handler'), { recursive: true });
  fs.mkdirSync(worker, { recursive: true });
  fs.writeFileSync(path.join(api, 'go.mod'), 'module api\n');
  fs.writeFileSync(path.join(worker, 'go.mod'), 'module worker\n');
  const activeFile = path.join(api, 'handler', 'handler.go');
  fs.writeFileSync(activeFile, 'package handler\n');

  const resolved = resolveGoWorkspacePath(root, activeFile);

  assert.equal(resolved, api);
});

test('uses explicit analysis directory before active Go file module', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'go-callchain-explicit-'));
  const backend = path.join(root, 'backend');
  const worker = path.join(root, 'worker');
  fs.mkdirSync(backend, { recursive: true });
  fs.mkdirSync(path.join(worker, 'job'), { recursive: true });
  fs.writeFileSync(path.join(backend, 'go.mod'), 'module backend\n');
  fs.writeFileSync(path.join(worker, 'go.mod'), 'module worker\n');
  const activeFile = path.join(worker, 'job', 'job.go');
  fs.writeFileSync(activeFile, 'package job\n');

  const resolved = resolveGoWorkspacePath(root, activeFile, backend);

  assert.equal(resolved, backend);
});

test('resolves relative explicit analysis directory from workspace root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'go-callchain-relative-'));
  const backend = path.join(root, 'services', 'backend');
  fs.mkdirSync(backend, { recursive: true });
  fs.writeFileSync(path.join(backend, 'go.mod'), 'module backend\n');

  const resolved = resolveGoWorkspacePath(root, undefined, 'services/backend');

  assert.equal(resolved, backend);
});

test('selected analysis directory returns all child modules instead of picking the first one', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'go-callchain-selected-multi-'));
  const api = path.join(root, 'api');
  const worker = path.join(root, 'worker');
  fs.mkdirSync(api, { recursive: true });
  fs.mkdirSync(worker, { recursive: true });
  fs.writeFileSync(path.join(api, 'go.mod'), 'module api\n');
  fs.writeFileSync(path.join(worker, 'go.mod'), 'module worker\n');

  const candidates = resolveSelectedGoWorkspaceCandidates(root);

  assert.deepEqual(candidates, [api, worker]);
});

test('selected analysis directory keeps exact module when go.mod is directly inside it', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'go-callchain-selected-exact-'));
  const api = path.join(root, 'api');
  fs.mkdirSync(api, { recursive: true });
  fs.writeFileSync(path.join(api, 'go.mod'), 'module api\n');

  const candidates = resolveSelectedGoWorkspaceCandidates(api);

  assert.deepEqual(candidates, [api]);
});
