const assert = require('node:assert/strict');
const test = require('node:test');

const { graphCanvasDimensions, graphNodePosition } = require('../dist/graphLayout');

test('graph canvas keeps a usable minimum size for short callchains', () => {
  const size = graphCanvasDimensions(1, 0);

  assert.equal(size.layoutWidth, 794);
  assert.equal(size.layoutHeight, 134);
  assert.ok(size.width >= 960);
  assert.ok(size.height >= 560);
});

test('graph node positions still keep the first node inside the viewport padding', () => {
  const position = graphNodePosition({ depth: 0, y: 0 });

  assert.equal(position.x, 32);
  assert.equal(position.y, 32);
});
