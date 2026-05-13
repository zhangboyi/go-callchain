const assert = require('node:assert/strict');
const test = require('node:test');

const { functionCallchainRootKinds } = require('../dist/functionCallchainViewModel');

test('function callchain view shows empty action before analysis', () => {
  assert.deepEqual(functionCallchainRootKinds([]), ['empty']);
});

test('function callchain view does not render the full function list in the result tree', () => {
  assert.deepEqual(functionCallchainRootKinds([{ id: 'pkg.Func' }]), ['empty']);
});

test('function callchain view only renders the current selected callchain', () => {
  assert.deepEqual(
    functionCallchainRootKinds(
      [{ id: 'pkg.Func' }],
      { function: 'pkg.Func', tree: { function: 'pkg.Func', children: [] } },
    ),
    ['callchain'],
  );
});
