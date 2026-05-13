import { describe, expect, it } from 'vitest';
import type { CallTreeNode, FunctionDetail } from '../types';
import {
  collectCallTreeEdgeTypes,
  collectFunctionDetailEdgeTypes,
  defaultVisibleEdgeTypes,
  filterCallTreeByEdgeTypes,
  filterFunctionDetailEdges,
  hideUtilityEdgeTypes,
} from './edgeTypes';

const tree: CallTreeNode = {
  function: 'handler.Create',
  children: [
    {
      function: 'service.Create',
      edge: { caller: 'handler.Create', callee: 'service.Create', file: 'handler.go', line: 12, source: 'package_variable', confidence: 'exact' },
      children: [
        {
          function: 'common.GenResp',
          edge: { caller: 'service.Create', callee: 'common.GenResp', file: 'service.go', line: 22, source: 'package_selector', confidence: 'exact' },
          children: [],
        },
      ],
    },
    {
      function: 'dao.Save',
      edge: { caller: 'handler.Create', callee: 'dao.Save', file: 'handler.go', line: 18, source: 'struct_field_constructor_inference', confidence: 'inferred' },
      children: [],
    },
  ],
};

const detail: FunctionDetail = {
  function: { id: 'handler.Create', name: 'Create', package: 'handler', file: 'handler.go', start_line: 1, end_line: 30 },
  incoming_edges: [
    { caller: 'POST /program/create', callee: 'handler.Create', file: 'router.go', line: 4, source: 'gin_route_handler', confidence: 'exact' },
  ],
  outgoing_edges: [
    { caller: 'handler.Create', callee: 'common.GenResp', file: 'handler.go', line: 25, source: 'package_selector', confidence: 'exact' },
    { caller: 'handler.Create', callee: 'service.Create', file: 'handler.go', line: 12, source: 'package_variable', confidence: 'exact' },
  ],
};

describe('edge type helpers', () => {
  it('collects source types from call tree and function detail', () => {
    expect(collectCallTreeEdgeTypes(tree)).toEqual(['package_selector', 'package_variable', 'struct_field_constructor_inference']);
    expect(collectFunctionDetailEdgeTypes(detail)).toEqual(['gin_route_handler', 'package_selector', 'package_variable']);
  });

  it('filters call tree by visible edge types and removes hidden descendants', () => {
    const filtered = filterCallTreeByEdgeTypes(tree, new Set(['package_variable']));
    expect(filtered).toEqual({
      function: 'handler.Create',
      children: [
        {
          function: 'service.Create',
          edge: { caller: 'handler.Create', callee: 'service.Create', file: 'handler.go', line: 12, source: 'package_variable', confidence: 'exact' },
          children: [],
        },
      ],
    });
  });

  it('filters function detail edges by visible edge types', () => {
    const filtered = filterFunctionDetailEdges(detail, new Set(['package_variable']));
    expect(filtered?.incoming_edges).toEqual([]);
    expect(filtered?.outgoing_edges).toEqual([
      { caller: 'handler.Create', callee: 'service.Create', file: 'handler.go', line: 12, source: 'package_variable', confidence: 'exact' },
    ]);
  });

  it('keeps current behavior by default and supports hide utility preset', () => {
    expect(defaultVisibleEdgeTypes.has('package_selector')).toBe(true);
    expect(hideUtilityEdgeTypes.has('package_selector')).toBe(false);
    expect(hideUtilityEdgeTypes.has('package_variable')).toBe(true);
  });
});
