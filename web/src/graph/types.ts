import type { Edge, GoFunction } from '../types';
import type { EdgeSourceType } from './edgeTypes';

export type GraphNodeKind = 'route' | 'handler' | 'service' | 'dao' | 'rpc' | 'changed' | 'function';

export interface CallchainGraphNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  kind: GraphNodeKind;
  file?: string;
  line?: number;
  selected?: boolean;
  function?: GoFunction;
}

export interface CallchainGraphEdgeData extends Record<string, unknown> {
  sourceType?: EdgeSourceType;
  confidence?: string;
  file?: string;
  line?: number;
  edge?: Edge;
}

export interface CallchainGraphModel {
  nodes: CallchainGraphNodeData[];
  edges: Array<{
    id: string;
    source: string;
    target: string;
    data: CallchainGraphEdgeData;
  }>;
}
