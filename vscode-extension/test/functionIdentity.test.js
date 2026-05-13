const assert = require('node:assert/strict');
const test = require('node:test');

const { findFunctionByIdentity, functionIdentityKey } = require('../dist/functionIdentity');

test('function identity normalizes full receiver ids to short receiver method', () => {
  assert.equal(
    functionIdentityKey('tcm-be/app/tcm/controller.(AnalysisController).TestcasePlanExecution'),
    'AnalysisController.TestcasePlanExecution',
  );
});

test('function identity normalizes pointer receiver ids', () => {
  assert.equal(
    functionIdentityKey('tcm-be/app/tcm/controller.(*AnalysisController).TestcasePlanExecution'),
    'AnalysisController.TestcasePlanExecution',
  );
});

test('function identity resolves short names from analyzed functions', () => {
  const fn = {
    id: 'tcm-be/app/tcm/controller.(AnalysisController).TestcasePlanExecution',
    file: 'app/tcm/controller/analysis_controller.go',
    start_line: 22,
  };

  assert.equal(findFunctionByIdentity([fn], 'AnalysisController.TestcasePlanExecution'), fn);
});
