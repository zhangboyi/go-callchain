const assert = require('node:assert/strict');
const test = require('node:test');

const {
  interfaceCallchainRootNodes,
  routeHasSelectedCallchain,
} = require('../dist/interfaceCallchainViewModel');

const overviewRoute = {
  method: 'GET',
  path: '/tcm/api/v1/analysis/overview/cards',
  handler: 'app/tcm/controller.(AnalysisController).OverviewCard',
  file: 'app/tcm/router/analysis_route.go',
  line: 12,
};

const tableRoute = {
  method: 'GET',
  path: '/tcm/api/v1/analysis/overview/table',
  handler: 'app/tcm/controller.(AnalysisController).OverviewTable',
  file: 'app/tcm/router/analysis_route.go',
  line: 18,
};

test('interface callchain view renders analyzed routes as root entries', () => {
  assert.deepEqual(interfaceCallchainRootNodes([overviewRoute, tableRoute]), [
    { kind: 'route', route: overviewRoute, selected: false },
    { kind: 'route', route: tableRoute, selected: false },
  ]);
});

test('interface callchain view keeps empty action before routes are analyzed', () => {
  assert.deepEqual(interfaceCallchainRootNodes([]), [{ kind: 'empty' }]);
});

test('interface callchain view expands only the selected route callchain', () => {
  const callchain = {
    route: overviewRoute,
    tree: { function: overviewRoute.handler, children: [] },
  };

  const nodes = interfaceCallchainRootNodes([overviewRoute, tableRoute], callchain);

  assert.equal(nodes[0].selected, true);
  assert.equal(nodes[1].selected, false);
  assert.equal(routeHasSelectedCallchain(overviewRoute, callchain), true);
  assert.equal(routeHasSelectedCallchain(tableRoute, callchain), false);
});

test('interface callchain view keeps an impact fallback route visible', () => {
  const callchain = {
    route: overviewRoute,
    tree: { function: overviewRoute.handler, children: [] },
  };

  assert.deepEqual(interfaceCallchainRootNodes([], callchain), [
    { kind: 'route', route: overviewRoute, selected: true },
  ]);
});
