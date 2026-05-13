import type { CallTreeNode, Edge, FunctionDetail } from '../types';

export type EdgeSourceType =
  | 'gin_route_handler'
  | 'direct_call'
  | 'package_selector'
  | 'receiver_method'
  | 'constructor_variable'
  | 'package_variable'
  | 'struct_field_constructor_inference'
  | 'ssa_callgraph'
  | 'swagger_router_comment'
  | 'xproto_route_metadata'
  | 'openapi_spec'
  | string;

export type EdgeTypeGroup = 'core' | 'utility' | 'inferred' | 'route';

export interface EdgeTypeMeta {
  type: EdgeSourceType;
  label: string;
  description: string;
  group: EdgeTypeGroup;
}

export const edgeTypeCatalog: EdgeTypeMeta[] = [
  { type: 'gin_route_handler', label: 'Gin Route', description: 'Gin route registration to handler entry', group: 'route' },
  { type: 'swagger_router_comment', label: 'Swagger Route', description: 'Swagger @Router comment to handler entry', group: 'route' },
  { type: 'xproto_route_metadata', label: 'xProto Route', description: 'xProto route metadata to handler entry', group: 'route' },
  { type: 'openapi_spec', label: 'OpenAPI Route', description: 'OpenAPI spec route to handler entry', group: 'route' },
  { type: 'direct_call', label: 'Direct Call', description: 'Direct function call in the same scope', group: 'core' },
  { type: 'receiver_method', label: 'Receiver Method', description: 'Method call on a known receiver', group: 'core' },
  { type: 'constructor_variable', label: 'Constructor Variable', description: 'Method call on a variable inferred from explicit type or constructor', group: 'core' },
  { type: 'package_variable', label: 'Package Variable', description: 'Method call on a package-level variable', group: 'core' },
  { type: 'package_selector', label: 'Package Selector', description: 'Package function call such as common.GenResp()', group: 'utility' },
  { type: 'struct_field_constructor_inference', label: 'Struct Field', description: 'Call inferred through struct field constructor bindings', group: 'inferred' },
  { type: 'ssa_callgraph', label: 'SSA Callgraph', description: 'Accurate mode edge from Go SSA call graph', group: 'inferred' },
];

export const knownEdgeTypes = new Set(edgeTypeCatalog.map((item) => item.type));
export const defaultVisibleEdgeTypes = new Set(edgeTypeCatalog.map((item) => item.type));
export const coreOnlyEdgeTypes = new Set(edgeTypeCatalog.filter((item) => item.group === 'core' || item.group === 'route').map((item) => item.type));
export const hideUtilityEdgeTypes = new Set(edgeTypeCatalog.filter((item) => item.group !== 'utility').map((item) => item.type));

const metaByType = new Map(edgeTypeCatalog.map((item) => [item.type, item]));

export function edgeTypeMeta(type: string | undefined): EdgeTypeMeta {
  if (!type) {
    return { type: 'unknown', label: 'Unknown', description: 'Unknown edge source', group: 'inferred' };
  }
  return metaByType.get(type) ?? { type, label: humanizeEdgeType(type), description: type, group: 'inferred' };
}

export function collectCallTreeEdgeTypes(tree: CallTreeNode | null | undefined): string[] {
  const types = new Set<string>();
  walkTree(tree, (edge) => {
    if (edge.source) {
      types.add(edge.source);
    }
  });
  return sortEdgeTypes(types);
}

export function collectFunctionDetailEdgeTypes(detail: FunctionDetail | null | undefined): string[] {
  const types = new Set<string>();
  for (const edge of [...(detail?.incoming_edges ?? []), ...(detail?.outgoing_edges ?? [])]) {
    if (edge.source) {
      types.add(edge.source);
    }
  }
  return sortEdgeTypes(types);
}

export function filterCallTreeByEdgeTypes(tree: CallTreeNode | null | undefined, visibleTypes: Set<string>): CallTreeNode | null {
  if (!tree) {
    return null;
  }
  return {
    ...tree,
    children: (tree.children ?? [])
      .filter((child) => !child.edge?.source || visibleTypes.has(child.edge.source))
      .map((child) => filterCallTreeByEdgeTypes(child, visibleTypes))
      .filter((child): child is CallTreeNode => child !== null),
  };
}

export function filterFunctionDetailEdges(detail: FunctionDetail | null | undefined, visibleTypes: Set<string>): FunctionDetail | null {
  if (!detail) {
    return null;
  }
  return {
    ...detail,
    incoming_edges: detail.incoming_edges.filter((edge) => visibleTypes.has(edge.source)),
    outgoing_edges: detail.outgoing_edges.filter((edge) => visibleTypes.has(edge.source)),
  };
}

export function normalizeVisibleEdgeTypes(current: Set<string>, availableTypes: string[]): Set<string> {
  const next = new Set(current);
  for (const type of availableTypes) {
    if (!knownEdgeTypes.has(type)) {
      next.add(type);
    }
  }
  return next;
}

export function replaceAvailableEdgeTypes(current: Set<string>, availableTypes: string[], selectedAvailableTypes: Set<string>): Set<string> {
  const available = new Set(availableTypes);
  const next = new Set(Array.from(current).filter((type) => !available.has(type)));
  for (const type of selectedAvailableTypes) {
    next.add(type);
  }
  return next;
}

function walkTree(tree: CallTreeNode | null | undefined, visit: (edge: Edge) => void) {
  if (!tree) {
    return;
  }
  for (const child of tree.children ?? []) {
    if (child.edge) {
      visit(child.edge);
    }
    walkTree(child, visit);
  }
}

function sortEdgeTypes(types: Set<string>): string[] {
  return Array.from(types).sort((left, right) => edgeTypeMeta(left).label.localeCompare(edgeTypeMeta(right).label) || left.localeCompare(right));
}

function humanizeEdgeType(type: string) {
  return type
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}
