const assert = require('node:assert/strict');
const test = require('node:test');

const { goFunctionCodeLensActions } = require('../dist/codeLensActions');

test('go function CodeLens only exposes callchain entry', () => {
  const actions = goFunctionCodeLensActions();

  assert.deepEqual(actions.map((item) => item.title), ['Show Callchain']);
  assert.ok(!actions.some((item) => item.title.includes('Impact')));
});
