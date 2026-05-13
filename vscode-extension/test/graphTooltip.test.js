const assert = require('node:assert/strict');
const test = require('node:test');

const { graphEdgeTooltip, graphNodeTooltip, graphInteractionCapabilities, graphTooltipDelayMs, truncateText } = require('../dist/graphTooltip');

test('graph node tooltip keeps full function and source location', () => {
  const tooltip = graphNodeTooltip({
    label: 'VeryLongServiceImpl.ListTestcaseByDomainAndParams',
    detail: 'app/tcm/service/very_long_service_file.go:128',
    functionID: 'tcm-be/app/tcm/service.(VeryLongServiceImpl).ListTestcaseByDomainAndParams',
  });

  assert.match(tooltip, /VeryLongServiceImpl\.ListTestcaseByDomainAndParams/);
  assert.match(tooltip, /app\/tcm\/service\/very_long_service_file\.go:128/);
  assert.match(tooltip, /tcm-be\/app\/tcm\/service\.\(VeryLongServiceImpl\)\.ListTestcaseByDomainAndParams/);
});

test('graph edge tooltip keeps source and confidence', () => {
  assert.equal(graphEdgeTooltip({ source: 'struct_field_constructor_inference', confidence: 'exact' }), 'struct_field_constructor_inference · exact');
});

test('truncateText only truncates visible card text', () => {
  assert.equal(truncateText('abcdef', 4), 'abc…');
  assert.equal(truncateText('abc', 4), 'abc');
});

test('graph interaction capabilities include node dragging and png export', () => {
  assert.deepEqual(graphInteractionCapabilities(), {
    dragNodes: true,
    panCanvas: true,
    exportPng: true,
    copyPng: true,
    fullscreen: true,
    fastTooltips: true,
    collapseNodes: true,
  });
});

test('graph tooltips appear quickly without relying on native title delay', () => {
  assert.equal(graphTooltipDelayMs(), 80);
});
