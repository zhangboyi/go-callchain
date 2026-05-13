const assert = require('node:assert/strict');
const test = require('node:test');

const { graphToolbarActions, graphToolbarPresentation } = require('../dist/graphToolbar');

test('graph toolbar aggregates actions into one menu', () => {
  assert.equal(graphToolbarPresentation(), 'menu');
  assert.deepEqual(graphToolbarActions().map((item) => item.id), [
    'reset-layout',
    'fullscreen-graph',
    'copy-png',
    'export-png',
  ]);
});
