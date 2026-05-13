const assert = require('node:assert/strict');
const test = require('node:test');

const { graphChildrenByNode, graphDescendantKeys, graphHiddenNodeKeys } = require('../dist/graphCollapse');

test('graph collapse maps children by node', () => {
  const children = graphChildrenByNode([
    { from: 'root', to: 'a' },
    { from: 'root', to: 'b' },
    { from: 'a', to: 'a1' },
  ]);

  assert.deepEqual(children.get('root'), ['a', 'b']);
  assert.deepEqual(children.get('a'), ['a1']);
});

test('graph collapse returns recursive descendants', () => {
  assert.deepEqual(graphDescendantKeys([
    { from: 'root', to: 'a' },
    { from: 'a', to: 'a1' },
    { from: 'root', to: 'b' },
  ], 'root'), ['a', 'a1', 'b']);
});

test('graph collapse hides descendants of collapsed nodes', () => {
  assert.deepEqual(graphHiddenNodeKeys([
    { from: 'root', to: 'a' },
    { from: 'a', to: 'a1' },
    { from: 'root', to: 'b' },
  ], ['a']), ['a1']);
});
