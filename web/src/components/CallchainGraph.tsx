import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge as FlowEdge,
  type Node as FlowNode,
  type NodeProps,
  type NodeTypes,
  type ReactFlowInstance,
  Position,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { edgeTypeMeta } from '../graph/edgeTypes';
import type { CallchainGraphEdgeData, CallchainGraphModel, CallchainGraphNodeData } from '../graph/types';

interface CallchainGraphProps {
  model: CallchainGraphModel;
  className?: string;
  onSelectFunction?: (functionID: string) => void;
}

const nodeWidth = 280;
const nodeHeight = 92;

interface CallchainGraphNodeDataWithControls extends CallchainGraphNodeData {
  collapsed?: boolean;
  collapsible?: boolean;
  onToggleCollapse?: (nodeID: string) => void;
  onSelectFunction?: (functionID: string) => void;
}

type CallchainFlowNode = FlowNode<CallchainGraphNodeDataWithControls, 'callchain'>;
const nodeTypes: NodeTypes = { callchain: GraphNode };

export function CallchainGraph({ model, className, onSelectFunction }: CallchainGraphProps) {
  const [collapsedIDs, setCollapsedIDs] = useState<Set<string>>(() => new Set());
  const [visibleNodes, setVisibleNodes, onNodesChange] = useNodesState<FlowNode<CallchainGraphNodeDataWithControls>>([]);
  const reactFlowRef = useRef<ReactFlowInstance<FlowNode<CallchainGraphNodeDataWithControls>, FlowEdge<CallchainGraphEdgeData>> | null>(null);
  const expandedGraph = className?.includes('callchain-graph-expanded') ?? false;
  const fitViewPadding = expandedGraph ? 0.12 : 0.18;
  const minZoom = expandedGraph ? 0.72 : 0.28;
  const collapsibleIDs = useMemo(() => new Set(model.edges.map((edge) => edge.source)), [model.edges]);
  const modelTopologyKey = useMemo(() => graphTopologyKey(model), [model]);
  const visibleModel = useMemo(() => collapseGraph(model, collapsedIDs), [model, collapsedIDs]);
  const toggleCollapse = useCallback((nodeID: string) => {
    setCollapsedIDs((current) => {
      const next = new Set(current);
      if (next.has(nodeID)) {
        next.delete(nodeID);
      } else {
        next.add(nodeID);
      }
      return next;
    });
  }, []);
  const { nodes: layoutNodes, edges } = useMemo(
    () => layoutGraph(visibleModel, collapsedIDs, collapsibleIDs, toggleCollapse, onSelectFunction),
    [collapsedIDs, collapsibleIDs, onSelectFunction, toggleCollapse, visibleModel],
  );
  const visibleTopologyKey = useMemo(() => graphTopologyKey(visibleModel), [visibleModel]);
  const lastVisibleTopologyKeyRef = useRef<string | null>(null);
  const resetLayout = useCallback(() => {
    setVisibleNodes(layoutNodes);
    lastVisibleTopologyKeyRef.current = visibleTopologyKey;
    window.setTimeout(() => {
      void reactFlowRef.current?.fitView({ padding: fitViewPadding, duration: 180 });
    }, 0);
  }, [fitViewPadding, layoutNodes, visibleTopologyKey]);

  useEffect(() => {
    setCollapsedIDs(new Set());
  }, [modelTopologyKey]);

  useEffect(() => {
    const topologyChanged = lastVisibleTopologyKeyRef.current !== visibleTopologyKey;
    lastVisibleTopologyKeyRef.current = visibleTopologyKey;
    if (!topologyChanged) {
      setVisibleNodes((current) => mergeFlowNodes(current, layoutNodes));
      return undefined;
    }
    setVisibleNodes(layoutNodes);
    const timer = window.setTimeout(() => {
      void reactFlowRef.current?.fitView({ padding: fitViewPadding, duration: 180 });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fitViewPadding, layoutNodes, setVisibleNodes, visibleTopologyKey]);

  if (layoutNodes.length === 0) {
    return <div className="graph-empty">No callchain selected</div>;
  }

  return (
    <div className={['callchain-graph', className].filter(Boolean).join(' ')}>
      <button className="graph-reset-button" type="button" onClick={resetLayout}>
        Reset Layout
      </button>
      <ReactFlow
        nodes={visibleNodes}
        edges={edges}
        onNodesChange={onNodesChange}
        fitView
        fitViewOptions={{ padding: fitViewPadding }}
        onInit={(instance) => {
          reactFlowRef.current = instance;
          void instance.fitView({ padding: fitViewPadding });
        }}
        minZoom={minZoom}
        nodesDraggable
        nodesConnectable={false}
        nodeTypes={nodeTypes}
        elementsSelectable
      >
        <Background gap={18} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={(node) => nodeColor((node.data as CallchainGraphNodeData).kind)} />
      </ReactFlow>
    </div>
  );
}

function layoutGraph(
  model: CallchainGraphModel,
  collapsedIDs: Set<string>,
  collapsibleIDs: Set<string>,
  onToggleCollapse: (nodeID: string) => void,
  onSelectFunction?: (functionID: string) => void,
): {
  nodes: Array<FlowNode<CallchainGraphNodeDataWithControls>>;
  edges: Array<FlowEdge<CallchainGraphEdgeData>>;
} {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'LR', nodesep: 36, ranksep: 140, marginx: 20, marginy: 20 });

  for (const node of model.nodes) {
    graph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  }
  for (const edge of model.edges) {
    graph.setEdge(edge.source, edge.target);
  }
  dagre.layout(graph);

  return {
    nodes: model.nodes.map((node) => {
      const position = graph.node(node.id) ?? { x: 0, y: 0 };
      return {
        id: node.id,
        type: 'callchain',
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        position: {
          x: position.x - nodeWidth / 2,
          y: position.y - nodeHeight / 2,
        },
        data: {
          ...node,
          collapsed: collapsedIDs.has(node.id),
          collapsible: collapsibleIDs.has(node.id),
          onToggleCollapse,
          onSelectFunction,
        },
        className: `call-node call-node-${node.kind}${node.selected ? ' call-node-selected' : ''}`,
      };
    }),
    edges: model.edges.map((edge) => {
      const meta = edgeTypeMeta(edge.data.sourceType);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: meta.label,
        animated: edge.data.confidence === 'uncertain',
        className: `call-edge call-edge-${edge.data.confidence ?? 'unknown'} call-edge-source-${meta.group}`,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edgeColor(edge.data.confidence),
          width: 18,
          height: 18,
        },
        style: {
          stroke: edgeColor(edge.data.confidence),
          strokeWidth: 2,
        },
        data: edge.data,
      };
    }),
  };
}

function graphTopologyKey(model: CallchainGraphModel) {
  const nodeIDs = model.nodes.map((node) => node.id).sort();
  const edgeIDs = model.edges.map((edge) => `${edge.id}:${edge.source}->${edge.target}`).sort();
  return `${nodeIDs.join('|')}#${edgeIDs.join('|')}`;
}

function mergeFlowNodes(
  current: Array<FlowNode<CallchainGraphNodeDataWithControls>>,
  next: Array<FlowNode<CallchainGraphNodeDataWithControls>>,
) {
  if (current.length !== next.length) {
    return next;
  }
  const nextByID = new Map(next.map((node) => [node.id, node]));
  if (current.some((node) => !nextByID.has(node.id))) {
    return next;
  }
  return current.map((node) => {
    const nextNode = nextByID.get(node.id);
    if (!nextNode) {
      return node;
    }
    return {
      ...node,
      data: nextNode.data,
      className: nextNode.className,
      sourcePosition: nextNode.sourcePosition,
      targetPosition: nextNode.targetPosition,
      type: nextNode.type,
    };
  });
}

function GraphNode({ data }: NodeProps<CallchainFlowNode>) {
  const canToggle = Boolean(data.collapsible);
  const display = nodeDisplay(data.id, data.label, data.file, data.line);
  const pointerStartRef = useRef<{ x: number; y: number; pointerID: number } | null>(null);
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button')) {
      pointerStartRef.current = null;
      return;
    }
    pointerStartRef.current = { x: event.clientX, y: event.clientY, pointerID: event.pointerId };
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    if (!start || start.pointerID !== event.pointerId || (event.target as HTMLElement).closest('button')) {
      return;
    }
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    if (moved <= 5) {
      data.onSelectFunction?.(data.id);
    }
  };

  return (
    <div
      className="call-node-inner"
      onPointerCancel={() => {
        pointerStartRef.current = null;
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      title={data.id}
    >
      <Handle className="call-node-handle" type="target" position={Position.Left} />
      <div className="call-node-header">
        <div className="call-node-tags">
          <span className="call-node-kind">{data.kind}</span>
          <span className="call-node-file">{display.fileName}</span>
        </div>
        <button
          aria-label={data.collapsed ? 'Expand node' : 'Collapse node'}
          className="call-node-toggle nodrag"
          disabled={!canToggle}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
            data.onToggleCollapse?.(data.id);
          }}
          type="button"
        >
          {data.collapsed ? '+' : '-'}
        </button>
      </div>
      <strong className="call-node-title">{display.title}</strong>
      <span className="call-node-path">{display.codePath}</span>
      <Handle className="call-node-handle" type="source" position={Position.Right} />
    </div>
  );
}

function nodeDisplay(id: string, label: string, file?: string, line?: number) {
  const compactID = id.replace(/^git\.garena\.com\/shopee\//, '');
  const pathParts = compactID.split('/');
  const symbol = pathParts[pathParts.length - 1] || label || compactID;
  const namespace = pathParts.slice(0, -1).join('/');
  const codePath = file ? `${compactPath(file, 4)}${line ? `:${line}` : ''}` : compactPath(namespace, 3);

  return {
    title: compactSymbol(symbol),
    fileName: fileName(file) || compactPath(namespace, 1) || 'unknown',
    codePath: codePath || compactID,
  };
}

function fileName(path: string | undefined) {
  if (!path) {
    return '';
  }
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function compactSymbol(value: string) {
  const withoutPackage = value.replace(/^[a-z][a-zA-Z0-9_]*\./, '');
  return withoutPackage || value;
}

function compactPath(value: string, keepSegments: number) {
  if (!value) {
    return '';
  }
  const parts = value.split('/').filter(Boolean);
  if (parts.length <= keepSegments) {
    return value;
  }
  return `.../${parts.slice(-keepSegments).join('/')}`;
}

function collapseGraph(model: CallchainGraphModel, collapsedIDs: Set<string>): CallchainGraphModel {
  if (collapsedIDs.size === 0) {
    return model;
  }

  const childrenBySource = new Map<string, string[]>();
  for (const edge of model.edges) {
    const children = childrenBySource.get(edge.source) ?? [];
    children.push(edge.target);
    childrenBySource.set(edge.source, children);
  }

  const hiddenIDs = new Set<string>();
  const hideDescendants = (nodeID: string) => {
    for (const childID of childrenBySource.get(nodeID) ?? []) {
      if (hiddenIDs.has(childID)) {
        continue;
      }
      hiddenIDs.add(childID);
      hideDescendants(childID);
    }
  };

  for (const nodeID of collapsedIDs) {
    hideDescendants(nodeID);
  }

  return {
    nodes: model.nodes.filter((node) => !hiddenIDs.has(node.id)),
    edges: model.edges.filter((edge) => !collapsedIDs.has(edge.source) && !hiddenIDs.has(edge.source) && !hiddenIDs.has(edge.target)),
  };
}

function edgeColor(confidence?: string) {
  switch (confidence) {
    case 'exact':
      return '#1769e0';
    case 'inferred':
      return '#a15c00';
    case 'uncertain':
      return '#8a95a5';
    default:
      return '#64748b';
  }
}

function nodeColor(kind: string) {
  switch (kind) {
    case 'handler':
      return '#1769e0';
    case 'service':
      return '#16803c';
    case 'dao':
      return '#a15c00';
    case 'rpc':
      return '#5b6677';
    case 'changed':
      return '#b42318';
    default:
      return '#64748b';
  }
}
