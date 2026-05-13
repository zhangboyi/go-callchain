const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { resolveServiceLaunch } = require('../dist/serviceLauncher');

function baseConfig(overrides = {}) {
  return {
    serviceUrl: 'http://127.0.0.1:8787',
    autoStartService: true,
    serviceBinary: '',
    serviceCommand: 'go run ./cmd/server -addr 127.0.0.1:8787',
    serviceCwd: '',
    repositoryPath: '',
    defaultBase: 'master',
    defaultDepth: 8,
    mode: 'fast',
    ...overrides,
  };
}

test('uses bundled platform binary before serviceCommand', () => {
  const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'go-callchain-ext-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'go-callchain-workspace-'));
  const binary = path.join(extensionPath, 'bin', 'darwin-arm64', 'go-callchain-service');
  fs.mkdirSync(path.dirname(binary), { recursive: true });
  fs.writeFileSync(binary, '');

  const launch = resolveServiceLaunch({
    extensionPath,
    workspacePath,
    config: baseConfig(),
    platform: 'darwin',
    arch: 'arm64',
  });

  assert.equal(launch.command, binary);
  assert.deepEqual(launch.args, ['-addr', '127.0.0.1:8787']);
  assert.equal(launch.cwd, workspacePath);
  assert.equal(launch.shell, false);
});

test('uses explicit serviceBinary before bundled binary', () => {
  const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'go-callchain-ext-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'go-callchain-workspace-'));
  const bundled = path.join(extensionPath, 'bin', 'darwin-arm64', 'go-callchain-service');
  const explicit = path.join(extensionPath, 'custom-service');
  fs.mkdirSync(path.dirname(bundled), { recursive: true });
  fs.writeFileSync(bundled, '');
  fs.writeFileSync(explicit, '');

  const launch = resolveServiceLaunch({
    extensionPath,
    workspacePath,
    config: baseConfig({ serviceBinary: explicit }),
    platform: 'darwin',
    arch: 'arm64',
  });

  assert.equal(launch.command, explicit);
  assert.deepEqual(launch.args, ['-addr', '127.0.0.1:8787']);
  assert.equal(launch.shell, false);
});

test('falls back to serviceCommand when no binary is available', () => {
  const extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'go-callchain-ext-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'go-callchain-workspace-'));
  const serviceCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'go-callchain-service-'));

  const launch = resolveServiceLaunch({
    extensionPath,
    workspacePath,
    config: baseConfig({ serviceCwd }),
    platform: 'darwin',
    arch: 'arm64',
  });

  assert.equal(launch.command, 'go run ./cmd/server -addr 127.0.0.1:8787');
  assert.deepEqual(launch.args, []);
  assert.equal(launch.cwd, serviceCwd);
  assert.equal(launch.shell, true);
});
