const assert = require('node:assert/strict');
const test = require('node:test');

const { moreActionsForView } = require('../dist/moreActions');

test('interface callchain more actions only expose interface workflow actions', () => {
  assert.deepEqual(moreActionsForView('interface').map((item) => item.command), [
    'goCallchain.showInterfaceCallchain',
    'goCallchain.showCallchainGraph',
    'goCallchain.refresh',
    'goCallchain.selectAnalysisDirectory',
    'goCallchain.clearAnalysisDirectory',
    'goCallchain.restartService',
  ]);
});

test('mr impact more actions only expose impact workflow actions', () => {
  assert.deepEqual(moreActionsForView('impact').map((item) => item.command), [
    'goCallchain.analyzeLocalBranchImpact',
    'goCallchain.refresh',
    'goCallchain.selectAnalysisDirectory',
    'goCallchain.clearAnalysisDirectory',
    'goCallchain.restartService',
  ]);
});

test('function callchain more actions only expose function workflow actions', () => {
  assert.deepEqual(moreActionsForView('function').map((item) => item.command), [
    'goCallchain.showFunctionCallchain',
    'goCallchain.showCallchainGraph',
    'goCallchain.refresh',
    'goCallchain.selectAnalysisDirectory',
    'goCallchain.clearAnalysisDirectory',
    'goCallchain.restartService',
  ]);
});
