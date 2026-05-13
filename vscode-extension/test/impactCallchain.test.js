const assert = require('node:assert/strict');
const test = require('node:test');

const { impactFunctionCandidates, impactInterfaceCallchain, impactPrimaryFunctionID } = require('../dist/impactCallchain');

test('impact interface callchain uses the selected api chain', () => {
  const callchain = impactInterfaceCallchain({
    method: 'DELETE',
    path: '/tcm/api/v1/testcase_comments/:id',
    handler: 'tcm-be/app/tcm/controller.(TestcaseCommentController).DeleteById',
    changed_function: 'tcm-be/app/tcm/manager.EnforceBySpaceMode',
    risk: 'indirect',
    chain: [
      'tcm-be/app/tcm/controller.(TestcaseCommentController).DeleteById',
      'tcm-be/app/tcm/view.(TestcaseCommentViewImpl).DeleteById',
      'tcm-be/app/tcm/manager.EnforceBySpaceMode',
    ],
  });

  assert.equal(callchain.function, 'tcm-be/app/tcm/controller.(TestcaseCommentController).DeleteById');
  assert.equal(callchain.tree.function, 'tcm-be/app/tcm/controller.(TestcaseCommentController).DeleteById');
  assert.equal(callchain.tree.children[0].function, 'tcm-be/app/tcm/view.(TestcaseCommentViewImpl).DeleteById');
  assert.equal(callchain.tree.children[0].children[0].function, 'tcm-be/app/tcm/manager.EnforceBySpaceMode');
});

test('impact interface callchain keeps service chain as graph root when present', () => {
  const callchain = impactInterfaceCallchain({
    method: 'GET',
    path: '/x',
    handler: 'pkg.Handler',
    changed_function: 'pkg.Changed',
    risk: 'indirect',
    chain: ['pkg.Service', 'pkg.Changed'],
  });

  assert.equal(callchain.function, 'pkg.Service');
  assert.equal(callchain.tree.function, 'pkg.Service');
  assert.deepEqual(impactFunctionCandidates({
    method: 'GET',
    path: '/x',
    handler: 'pkg.Handler',
    changed_function: 'pkg.Changed',
    risk: 'indirect',
    chain: ['pkg.Service', 'pkg.Changed'],
  }), ['pkg.Service', 'pkg.Changed', 'pkg.Handler']);
  assert.equal(impactPrimaryFunctionID({
    method: 'GET',
    path: '/x',
    handler: 'pkg.Handler',
    changed_function: 'pkg.Changed',
    risk: 'indirect',
    chain: ['pkg.Service', 'pkg.Changed'],
  }), 'pkg.Service');
});
