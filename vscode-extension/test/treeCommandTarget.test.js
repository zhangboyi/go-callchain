const assert = require('node:assert/strict');
const test = require('node:test');

const { TreeCommandTarget } = require('../dist/treeCommandTarget');

test('tree command target uses explicit command argument first', () => {
  const target = new TreeCommandTarget();
  target.rememberSelection([{ functionID: 'pkg.Selected' }]);

  assert.deepEqual(target.resolve(['pkg.Explicit']), 'pkg.Explicit');
});

test('tree command target falls back to last selected tree node when command has no argument', () => {
  const target = new TreeCommandTarget();
  const selected = {
    kind: 'callchain',
    node: { function: 'pkg.Service.List', children: [] },
  };
  target.rememberSelection([selected]);

  assert.deepEqual(target.resolve([]), selected);
});

test('tree command target skips wrapper arguments and uses resolvable tree payload', () => {
  const target = new TreeCommandTarget();
  const selected = {
    kind: 'callchain',
    node: { function: 'pkg.Service.List', children: [] },
  };

  assert.deepEqual(target.resolve([{ label: 'wrapper' }, selected]), selected);
});

test('tree command target skips vscode context strings and uses clicked tree payload', () => {
  const target = new TreeCommandTarget();
  const selected = {
    kind: 'callchain',
    node: { function: 'pkg.Selected', children: [] },
  };
  const clicked = {
    kind: 'callchain',
    node: { function: 'pkg.Clicked', children: [] },
  };
  target.rememberSelection([selected]);

  assert.deepEqual(target.resolve(['goCallchain.function.callchain', clicked]), clicked);
});

test('tree command target does not treat vscode context strings as function ids', () => {
  const target = new TreeCommandTarget();
  const selected = {
    kind: 'callchain',
    node: { function: 'pkg.Selected', children: [] },
  };
  target.rememberSelection([selected]);

  assert.deepEqual(target.resolve(['goCallchain.function.callchain']), selected);
});

test('tree command target uses function id embedded in vscode context string', () => {
  const target = new TreeCommandTarget();
  const selected = {
    kind: 'callchain',
    node: { function: 'pkg.Selected', children: [] },
  };
  const context = 'goCallchain.function.callchain|go-callchain-function:pkg.Clicked';
  target.rememberSelection([selected]);

  assert.equal(target.resolve([context]), context);
});

test('tree command target ignores empty selections', () => {
  const target = new TreeCommandTarget();
  const selected = { functionID: 'pkg.Selected' };
  target.rememberSelection([selected]);
  target.rememberSelection([]);

  assert.deepEqual(target.resolve([]), selected);
});

test('tree command target can remember the last opened function target', () => {
  const target = new TreeCommandTarget();
  const opened = {
    functionID: 'pkg.Service.List',
    callchain: {
      function: 'pkg.Service.List',
      tree: { function: 'pkg.Service.List', children: [] },
    },
  };
  target.rememberOpenedTarget(opened);

  assert.deepEqual(target.resolve([]), opened);
});

test('tree command target prefers clicked item resource uri over last opened source target', () => {
  const target = new TreeCommandTarget();
  const opened = {
    functionID: 'pkg.Root',
    callchain: {
      function: 'pkg.Root',
      tree: { function: 'pkg.Root', children: [] },
    },
  };
  const clicked = {
    label: 'Service.List',
    resourceUri: {
      scheme: 'go-callchain-function',
      path: '/pkg.Service.List',
    },
  };
  target.rememberOpenedTarget(opened);

  assert.deepEqual(target.resolve([clicked]), clicked);
});
