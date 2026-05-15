import type { CallTreeNode, FunctionDetail, GoFunction, ImpactedInterface } from '../types';
import type { CallchainGraphModel, CallchainGraphNodeData, GraphNodeKind } from './types';

interface BuildGraphOptions {
  route?: { handler?: string } | null;
  selectedFunction?: string;
  functions?: GoFunction[];
  functionDetail?: FunctionDetail | null;
  impactedInterface?: ImpactedInterface | null;
  changedFunctionIDs?: string[];
}

export function buildCallchainGraph(tree: CallTreeNode | null | undefined, options: BuildGraphOptions = {}): CallchainGraphModel {
  const nodeMap = new Map<string, CallchainGraphNodeData>();
  const edgeMap = new Map<string, CallchainGraphModel['edges'][number]>();
  const functionsByID = new Map((options.functions ?? []).map((fn) => [fn.id, fn]));
  const changedFunctionIDs = new Set(options.changedFunctionIDs ?? []);

  if (!tree?.function) {
    return { nodes: [], edges: [] };
  }

  visitTree(tree, undefined);
  appendOneHopEdges(options.functionDetail, nodeMap, edgeMap, options.selectedFunction, functionsByID, changedFunctionIDs);

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
  };

  function visitTree(node: CallTreeNode, parentID: string | undefined) {
    const nodeID = node.function;
    if (!nodeMap.has(nodeID)) {
      nodeMap.set(nodeID, {
        id: nodeID,
        label: shortFunction(nodeID),
        kind: classifyNode(nodeID, options.route, options.impactedInterface, changedFunctionIDs),
        selected: nodeID === options.selectedFunction || nodeID === options.impactedInterface?.changed_function,
        ...functionNodeData(functionsByID.get(nodeID)),
      });
    }

    if (parentID) {
      const edge = node.edge;
      const edgeID = `${parentID}->${nodeID}:${edge?.line ?? edgeMap.size}`;
      edgeMap.set(edgeID, {
        id: edgeID,
        source: parentID,
        target: nodeID,
        data: {
          sourceType: edge?.source,
          confidence: edge?.confidence,
          file: edge?.file,
          line: edge?.line,
          edge,
        },
      });
    }

    for (const child of node.children ?? []) {
      visitTree(child, nodeID);
    }
  }
}

function appendOneHopEdges(
  detail: FunctionDetail | null | undefined,
  nodeMap: Map<string, CallchainGraphNodeData>,
  edgeMap: Map<string, CallchainGraphModel['edges'][number]>,
  selectedFunction?: string,
  functionsByID = new Map<string, GoFunction>(),
  changedFunctionIDs = new Set<string>(),
) {
  if (!detail || !selectedFunction || detail.function.id !== selectedFunction) {
    return;
  }

  const selectedNode = nodeMap.get(selectedFunction);
  if (selectedNode) {
    selectedNode.file = detail.function.file;
    selectedNode.line = detail.function.start_line;
    selectedNode.function = detail.function;
  }

  for (const edge of detail.outgoing_edges.slice(0, 12)) {
    if (!nodeMap.has(edge.callee)) {
      nodeMap.set(edge.callee, {
        id: edge.callee,
        label: shortFunction(edge.callee),
        kind: classifyNode(edge.callee, undefined, undefined, changedFunctionIDs),
        ...functionNodeData(functionsByID.get(edge.callee)),
      });
    }
    const edgeID = `${edge.caller}->${edge.callee}:${edge.line}`;
    if (!edgeMap.has(edgeID)) {
      edgeMap.set(edgeID, {
        id: edgeID,
        source: edge.caller,
        target: edge.callee,
        data: {
          sourceType: edge.source,
          confidence: edge.confidence,
          file: edge.file,
          line: edge.line,
          edge,
        },
      });
    }
  }
}

function functionNodeData(fn: GoFunction | undefined): Partial<CallchainGraphNodeData> {
  if (!fn) {
    return {};
  }
  return {
    file: fn.file,
    line: fn.start_line,
    function: fn,
  };
}

export function chainToCallTree(chain: string[]): CallTreeNode {
  const [first, ...rest] = chain;
  return {
    function: first ?? '',
    children: rest.length > 0 ? [chainToCallTree(rest)] : [],
  };
}

export function chainsToCallTree(chains: string[][]): CallTreeNode {
  const rootChain = chains.find((chain) => chain.length > 0) ?? [];
  const root = chainToCallTree(rootChain.slice(0, 1));
  for (const chain of chains) {
    appendChain(root, chain.slice(1));
  }
  return root;
}

function appendChain(node: CallTreeNode, chain: string[]) {
  const [next, ...rest] = chain;
  if (!next) {
    return;
  }
  const children = node.children ?? [];
  let child = children.find((item) => item.function === next);
  if (!child) {
    child = { function: next, children: [] };
    children.push(child);
    node.children = children;
  }
  appendChain(child, rest);
}

export function classifyNode(
  functionID: string,
  route?: { handler?: string } | null,
  impactedInterface?: ImpactedInterface | null,
  changedFunctionIDs: ReadonlySet<string> = new Set(),
): GraphNodeKind {
  const normalized = functionID.toLowerCase();
  if (changedFunctionIDs.has(functionID) || impactedInterface?.changed_function === functionID) {
    return 'changed';
  }
  if (route?.handler === functionID) {
    return 'handler';
  }
  if (normalized.includes('service')) {
    return 'service';
  }
  if (normalized.includes('dao') || normalized.includes('repo')) {
    return 'dao';
  }
  if (normalized.includes('client') || normalized.includes('rpc') || normalized.includes('http')) {
    return 'rpc';
  }
  return 'function';
}

export function shortFunction(value: string): string {
  const parts = value.split('/');
  return parts[parts.length - 1] ?? value;
}
