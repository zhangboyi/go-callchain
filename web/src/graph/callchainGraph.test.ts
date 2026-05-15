import { describe, expect, it } from 'vitest';
import { buildCallchainGraph, chainsToCallTree, chainToCallTree, classifyNode } from './callchainGraph';
import type { FunctionDetail, ImpactedInterface } from '../types';

describe('callchain graph conversion', () => {
  it('marks route handler, changed function, and edge confidence', () => {
    const impacted: ImpactedInterface = {
      method: 'POST',
      path: '/api/penalty/detail',
      handler: 'handler.ServiceHandler.GetPenaltyDetailForChatbot',
      changed_function: 'service.PenaltyService.GetPenaltyDetail',
      chain: ['handler.ServiceHandler.GetPenaltyDetailForChatbot', 'service.PenaltyService.GetPenaltyDetail'],
      risk: 'direct',
    };

    const tree = {
      function: impacted.handler,
      children: [
        {
          function: impacted.changed_function,
          edge: {
            caller: impacted.handler,
            callee: impacted.changed_function,
            file: 'handler/service_handler.go',
            line: 44,
            source: 'receiver_method',
            confidence: 'exact',
          },
        },
      ],
    };

    const graph = buildCallchainGraph(tree, {
      route: impacted,
      impactedInterface: impacted,
      selectedFunction: impacted.changed_function,
    });

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: impacted.handler, kind: 'handler' }),
        expect.objectContaining({ id: impacted.changed_function, kind: 'changed', selected: true }),
      ]),
    );
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: impacted.handler,
          target: impacted.changed_function,
          data: expect.objectContaining({ confidence: 'exact', sourceType: 'receiver_method' }),
        }),
      ]),
    );
  });

  it('adds one-hop outgoing evidence from selected function detail', () => {
    const detail: FunctionDetail = {
      function: {
        id: 'service.PenaltyService.GetPenaltyDetail',
        name: 'GetPenaltyDetail',
        package: 'service',
        file: 'service/penalty_service.go',
        start_line: 183,
        end_line: 241,
      },
      incoming_edges: [],
      outgoing_edges: [
        {
          caller: 'service.PenaltyService.GetPenaltyDetail',
          callee: 'dao.PenaltyDAO.QueryPenalty',
          file: 'service/penalty_service.go',
          line: 206,
          source: 'struct_field_constructor_inference',
          confidence: 'inferred',
        },
      ],
    };

    const graph = buildCallchainGraph(
      { function: 'service.PenaltyService.GetPenaltyDetail' },
      { functionDetail: detail, selectedFunction: detail.function.id },
    );

    expect(graph.nodes).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'dao.PenaltyDAO.QueryPenalty', kind: 'dao' })]));
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: detail.function.id,
          target: 'dao.PenaltyDAO.QueryPenalty',
          data: expect.objectContaining({ confidence: 'inferred' }),
        }),
      ]),
    );
  });

  it('marks all MR changed functions as changed graph nodes', () => {
    const graph = buildCallchainGraph(
      {
        function: 'handler.OrderHandler.Detail',
        children: [
          {
            function: 'service.OrderService.Detail',
            children: [
              {
                function: 'dao.OrderDao.GetById',
                children: [],
              },
            ],
          },
        ],
      },
      {
        changedFunctionIDs: ['dao.OrderDao.GetById'],
      },
    );

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'dao.OrderDao.GetById', kind: 'changed' }),
      ]),
    );
  });

  it('converts an impact chain into a linear tree', () => {
    expect(chainToCallTree(['handler.A', 'service.B', 'dao.C'])).toEqual({
      function: 'handler.A',
      children: [
        {
          function: 'service.B',
          children: [
            {
              function: 'dao.C',
              children: [],
            },
          ],
        },
      ],
    });
  });

  it('merges impact chains for the same route into one tree', () => {
    expect(
      chainsToCallTree([
        ['handler.A'],
        ['handler.A', 'service.B'],
        ['handler.A', 'service.B', 'dao.C'],
        ['handler.A', 'service.B', 'dao.D'],
      ]),
    ).toEqual({
      function: 'handler.A',
      children: [
        {
          function: 'service.B',
          children: [
            { function: 'dao.C', children: [] },
            { function: 'dao.D', children: [] },
          ],
        },
      ],
    });
  });

  it('does not include edges removed by edge type filtering before graph conversion', () => {
    const graph = buildCallchainGraph({
      function: 'handler.Create',
      children: [
        {
          function: 'service.Create',
          edge: { caller: 'handler.Create', callee: 'service.Create', file: 'handler.go', line: 12, source: 'package_variable', confidence: 'exact' },
          children: [],
        },
      ],
    });

    expect(graph.nodes.map((node) => node.id)).toEqual(['handler.Create', 'service.Create']);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].data.sourceType).toBe('package_variable');
  });

  it('classifies common function roles', () => {
    expect(classifyNode('user.UserService.Create')).toBe('service');
    expect(classifyNode('dao.UserDAO.Get')).toBe('dao');
    expect(classifyNode('client.UserRPCClient.Get')).toBe('rpc');
    expect(classifyNode('pkg.Handle')).toBe('function');
  });
});
