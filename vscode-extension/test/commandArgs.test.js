const assert = require('node:assert/strict');
const test = require('node:test');

const { extractFunctionCallchain, extractFunctionID, extractFunctionIDs } = require('../dist/commandArgs');

test('command args extract function id from tree item payload', () => {
  assert.equal(extractFunctionID({ functionID: 'pkg.Func' }), 'pkg.Func');
  assert.equal(extractFunctionID('pkg.Other'), 'pkg.Other');
});

test('command args extract function id from tree item command arguments', () => {
  assert.equal(extractFunctionID({
    label: 'Service.List',
    command: {
      command: 'goCallchain.openFunction',
      arguments: ['pkg.Service.List'],
    },
  }), 'pkg.Service.List');
});

test('command args extract function id from tree item resource uri', () => {
  assert.equal(extractFunctionID({
    label: 'Service.List',
    resourceUri: {
      scheme: 'go-callchain-function',
      path: '/pkg.Service.List',
    },
  }), 'pkg.Service.List');
});

test('command args extract function id from encoded tree item resource uri string', () => {
  assert.equal(
    extractFunctionID('go-callchain-function:/pkg%2Fdao.%28ProjectDaoImpl%29.ListByTeamId'),
    'pkg/dao.(ProjectDaoImpl).ListByTeamId',
  );
});

test('command args extract function id embedded in vscode tree context value', () => {
  assert.equal(
    extractFunctionID('goCallchain.function.callchain|go-callchain-function:pkg%2Fdao.%28ProjectDaoImpl%29.ListByTeamId'),
    'pkg/dao.(ProjectDaoImpl).ListByTeamId',
  );
});

test('command args extract function id from wrapped tree item payload', () => {
  assert.equal(extractFunctionID({
    label: 'wrapper',
    treeItem: {
      kind: 'callchain',
      node: {
        function: 'pkg.Service.List',
        children: [],
      },
    },
  }), 'pkg.Service.List');
});

test('command args extract function candidates from impact api payload', () => {
  assert.deepEqual(extractFunctionIDs({
    functionID: 'pkg.RouteAlias',
    functionCandidates: ['pkg.RouteAlias', 'pkg.(Controller).Handler'],
  }), ['pkg.RouteAlias', 'pkg.(Controller).Handler']);
});

test('command args extract function candidates from impact tree node payload', () => {
  assert.deepEqual(extractFunctionIDs({
    kind: 'interface',
    item: {
      method: 'POST',
      path: '/tcm/api/v1/modules',
      handler: 'pkg.RouteAlias',
      changed_function: 'pkg.Changed',
      risk: 'indirect',
      chain: ['pkg.(ModuleController).Create', 'pkg.Changed'],
    },
  }), ['pkg.(ModuleController).Create', 'pkg.Changed', 'pkg.RouteAlias']);
});

test('command args extract function id from raw callchain tree node payload', () => {
  assert.deepEqual(extractFunctionIDs({
    kind: 'callchain',
    node: {
      function: 'pkg.Service.List',
      children: [{ function: 'pkg.Dao.List', children: [] }],
    },
  }), ['pkg.Service.List']);
});

test('command args extract selected callchain subtree from tree node payload', () => {
  const node = {
    function: 'pkg.Service.List',
    children: [{ function: 'pkg.Dao.List', children: [] }],
  };

  assert.deepEqual(extractFunctionCallchain({ kind: 'callchain', node }), {
    function: 'pkg.Service.List',
    tree: node,
  });
});

test('command args extract selected callchain subtree from provider element payload', () => {
  const node = {
    function: 'pkg.Service.List',
    children: [{ function: 'pkg.Dao.List', children: [] }],
  };
  const element = {
    kind: 'callchain',
    node,
    functionID: node.function,
    callchain: { function: node.function, tree: node },
  };

  assert.equal(extractFunctionID(element), 'pkg.Service.List');
  assert.deepEqual(extractFunctionCallchain(element), {
    function: 'pkg.Service.List',
    tree: node,
  });
});

test('command args extract selected callchain subtree from tree item command arguments', () => {
  const node = {
    function: 'pkg.Service.List',
    children: [{ function: 'pkg.Dao.List', children: [] }],
  };

  assert.deepEqual(extractFunctionCallchain({
    label: 'Service.List',
    command: {
      command: 'goCallchain.openFunction',
      arguments: [{ callchain: { function: node.function, tree: node } }],
    },
  }), {
    function: 'pkg.Service.List',
    tree: node,
  });
});

test('command args extract selected callchain subtree from wrapped tree item payload', () => {
  const node = {
    function: 'pkg.Service.List',
    children: [{ function: 'pkg.Dao.List', children: [] }],
  };

  assert.deepEqual(extractFunctionCallchain({
    label: 'wrapper',
    treeItem: { kind: 'callchain', node },
  }), {
    function: 'pkg.Service.List',
    tree: node,
  });
});

test('command args extract function id from interface route tree node payload', () => {
  assert.deepEqual(extractFunctionIDs({
    kind: 'route',
    route: {
      method: 'GET',
      path: '/api/users',
      handler: 'pkg.(UserController).List',
      file: 'router.go',
      line: 12,
    },
  }), ['pkg.(UserController).List']);
});

test('command args extract callchain from impact tree node payload', () => {
  const callchain = extractFunctionCallchain({
    kind: 'interface',
    item: {
      method: 'POST',
      path: '/tcm/api/v1/modules',
      handler: 'pkg.RouteAlias',
      changed_function: 'pkg.Changed',
      risk: 'indirect',
      chain: ['pkg.(ModuleController).Create', 'pkg.Changed'],
    },
  });

  assert.equal(callchain.function, 'pkg.(ModuleController).Create');
  assert.equal(callchain.tree.function, 'pkg.(ModuleController).Create');
  assert.equal(callchain.tree.children[0].function, 'pkg.Changed');
});

test('command args extract explicit callchain payload', () => {
  const callchain = {
    function: 'pkg.Handler',
    tree: {
      function: 'pkg.Handler',
      children: [{ function: 'pkg.Service', children: [] }],
    },
  };

  assert.deepEqual(extractFunctionCallchain({ callchain }), callchain);
});

test('command args ignore invalid callchain payload', () => {
  assert.equal(extractFunctionCallchain({ callchain: { function: 'pkg.Handler' } }), undefined);
});
