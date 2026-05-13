# Go Callchain Service UI Graph Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production UI for callchain exploration with React Flow graph visualization, focused impact paths, function details, and route/function object navigation.

**Architecture:** Keep backend APIs unchanged and add a frontend graph layer that converts existing `CallTreeNode`, `Route`, `FunctionDetail`, and `ImpactedInterface` data into a small focused DAG. Render the graph with `@xyflow/react`, lay it out with `@dagrejs/dagre`, and keep Ant Design for shell, tables, drawers, tabs, status and forms.

**Tech Stack:** React 18, TypeScript, Vite, Ant Design 5, `@xyflow/react`, `@dagrejs/dagre`.

---

## File Structure

- Modify: `web/package.json`
- Modify: `web/package-lock.json`
- Modify: `web/src/types.ts`
- Create: `web/src/graph/types.ts`
- Create: `web/src/graph/callchainGraph.ts`
- Create: `web/src/components/CallchainGraph.tsx`
- Create: `web/src/components/CallchainPanel.tsx`
- Create: `web/src/components/ObjectRail.tsx`
- Create: `web/src/components/ImpactPanel.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`

## Data And UI Principles

- Render selected path first, not the whole repository graph.
- Default graph size: selected chain plus one-hop outgoing children from the selected node.
- Graph view and tree view share the same `callchain` state.
- Function detail keeps incoming/outgoing edge evidence in tables below the graph.
- Repositories with `routes.length === 0` still show Functions, MR Impact, and function graph search.
- Edge color maps to confidence:
  - `exact`: blue solid
  - `inferred`: amber dashed
  - `uncertain`: gray dotted
- Node kind maps to function role:
  - route handler: `handler`
  - name contains `Service`: `service`
  - name contains `DAO`, `Repo`, `Repository`: `dao`
  - name contains `Client`, `RPC`, `HTTP`: `rpc`
  - changed function: `changed`
  - fallback: `function`

---

### Task 1: Add Graph Dependencies

**Files:**
- Modify: `web/package.json`
- Modify: `web/package-lock.json`

- [ ] **Step 1: Install graph packages**

Run:

```bash
npm --prefix web install @xyflow/react@^12.10.2 @dagrejs/dagre@^3.0.0
```

Expected:

```text
added packages
```

- [ ] **Step 2: Verify dependency metadata**

Run:

```bash
npm --prefix web ls @xyflow/react @dagrejs/dagre
```

Expected:

```text
@xyflow/react
@dagrejs/dagre
```

- [ ] **Step 3: Build to confirm dependencies resolve**

Run:

```bash
npm --prefix web run build
```

Expected:

```text
vite build
✓ built
```

---

### Task 2: Define Graph Types

**Files:**
- Create: `web/src/graph/types.ts`
- Modify: `web/src/types.ts`

- [ ] **Step 1: Create graph-specific types**

Create `web/src/graph/types.ts`:

```ts
import type { Edge, GoFunction } from '../types';

export type GraphNodeKind = 'route' | 'handler' | 'service' | 'dao' | 'rpc' | 'changed' | 'function';

export interface CallchainGraphNodeData {
  id: string;
  label: string;
  kind: GraphNodeKind;
  file?: string;
  line?: number;
  selected?: boolean;
  function?: GoFunction;
}

export interface CallchainGraphEdgeData {
  sourceType?: string;
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
```

- [ ] **Step 2: Keep existing API types stable**

Confirm `web/src/types.ts` still exports these existing interfaces without changing API field names:

```ts
export interface Edge {
  caller: string;
  callee: string;
  file: string;
  line: number;
  source: string;
  confidence: string;
}

export interface CallTreeNode {
  function: string;
  edge?: Edge;
  children?: CallTreeNode[];
}
```

- [ ] **Step 3: Type-check**

Run:

```bash
npm --prefix web run build
```

Expected:

```text
✓ built
```

---

### Task 3: Build Callchain Graph Conversion

**Files:**
- Create: `web/src/graph/callchainGraph.ts`

- [ ] **Step 1: Implement tree-to-graph conversion and role classification**

Create `web/src/graph/callchainGraph.ts`:

```ts
import type { CallTreeNode, FunctionDetail, GoFunction, ImpactedInterface, Route } from '../types';
import type { CallchainGraphModel, CallchainGraphNodeData, GraphNodeKind } from './types';

interface BuildGraphOptions {
  route?: Route | null;
  selectedFunction?: string;
  functionDetail?: FunctionDetail | null;
  impactedInterface?: ImpactedInterface | null;
}

export function buildCallchainGraph(tree: CallTreeNode | null | undefined, options: BuildGraphOptions = {}): CallchainGraphModel {
  const nodeMap = new Map<string, CallchainGraphNodeData>();
  const edgeMap = new Map<string, CallchainGraphModel['edges'][number]>();

  if (!tree?.function) {
    return { nodes: [], edges: [] };
  }

  visitTree(tree, undefined);
  appendOneHopEdges(options.functionDetail, nodeMap, edgeMap, options.selectedFunction);

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
        kind: classifyNode(nodeID, options.route, options.impactedInterface),
        selected: nodeID === options.selectedFunction || nodeID === options.impactedInterface?.changed_function,
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
) {
  if (!detail || !selectedFunction) {
    return;
  }

  for (const edge of detail.outgoing_edges.slice(0, 12)) {
    if (!nodeMap.has(edge.callee)) {
      nodeMap.set(edge.callee, {
        id: edge.callee,
        label: shortFunction(edge.callee),
        kind: classifyNode(edge.callee),
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

export function chainToCallTree(chain: string[]): CallTreeNode {
  const [first, ...rest] = chain;
  return {
    function: first ?? '',
    children: rest.length > 0 ? [chainToCallTree(rest)] : [],
  };
}

export function classifyNode(functionID: string, route?: Route | null, impactedInterface?: ImpactedInterface | null): GraphNodeKind {
  const normalized = functionID.toLowerCase();
  if (route?.handler === functionID) {
    return 'handler';
  }
  if (impactedInterface?.changed_function === functionID) {
    return 'changed';
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
```

- [ ] **Step 2: Build**

Run:

```bash
npm --prefix web run build
```

Expected:

```text
✓ built
```

---

### Task 4: Create React Flow Graph Component

**Files:**
- Create: `web/src/components/CallchainGraph.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Implement graph renderer**

Create `web/src/components/CallchainGraph.tsx`:

```tsx
import { Background, Controls, MiniMap, ReactFlow, type Edge as FlowEdge, type Node as FlowNode, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import type { CallchainGraphModel, CallchainGraphNodeData } from '../graph/types';

interface CallchainGraphProps {
  model: CallchainGraphModel;
  onSelectFunction?: (functionID: string) => void;
}

const nodeWidth = 240;
const nodeHeight = 72;

export function CallchainGraph({ model, onSelectFunction }: CallchainGraphProps) {
  const { nodes, edges } = layoutGraph(model);

  if (nodes.length === 0) {
    return <div className="graph-empty">No callchain selected</div>;
  }

  return (
    <div className="callchain-graph">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onNodeClick={(_, node) => onSelectFunction?.(node.id)}
      >
        <Background gap={18} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={(node) => nodeColor((node.data as CallchainGraphNodeData).kind)} />
      </ReactFlow>
    </div>
  );
}

function layoutGraph(model: CallchainGraphModel): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'TB', nodesep: 42, ranksep: 74, marginx: 18, marginy: 18 });

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
        type: 'default',
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
        position: {
          x: position.x - nodeWidth / 2,
          y: position.y - nodeHeight / 2,
        },
        data: {
          ...node,
          label: <GraphNode data={node} />,
        },
        className: `call-node call-node-${node.kind}${node.selected ? ' call-node-selected' : ''}`,
      };
    }),
    edges: model.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.data.sourceType ?? edge.data.confidence ?? '',
      animated: edge.data.confidence === 'uncertain',
      className: `call-edge call-edge-${edge.data.confidence ?? 'unknown'}`,
    })),
  };
}

function GraphNode({ data }: { data: CallchainGraphNodeData }) {
  return (
    <div className="call-node-inner">
      <span className="call-node-kind">{data.kind}</span>
      <strong>{data.label}</strong>
      <span>{data.file ? `${data.file}:${data.line ?? ''}` : data.id}</span>
    </div>
  );
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
```

- [ ] **Step 2: Add graph styles**

Append to `web/src/styles.css`:

```css
.callchain-graph {
  height: 360px;
  min-height: 320px;
  overflow: hidden;
  background: #fbfcfe;
  border: 1px solid #e5edf5;
  border-radius: 6px;
}

.graph-empty {
  display: grid;
  place-items: center;
  height: 240px;
  color: #8a95a5;
  background: #fbfcfe;
  border: 1px dashed #ccd6e2;
  border-radius: 6px;
}

.call-node {
  width: 240px;
  border: 1px solid #cad5e3;
  border-radius: 6px;
  background: #ffffff;
  box-shadow: 0 4px 14px rgba(15, 23, 42, 0.07);
}

.call-node-selected {
  border-color: #b42318;
  box-shadow: 0 0 0 3px rgba(180, 35, 24, 0.12);
}

.call-node-inner {
  display: grid;
  gap: 4px;
  padding: 8px 10px;
  font-size: 12px;
}

.call-node-inner strong,
.call-node-inner span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.call-node-kind {
  width: fit-content;
  padding: 1px 6px;
  color: #334155;
  background: #eef2f6;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.call-node-handler {
  border-left: 4px solid #1769e0;
}

.call-node-service {
  border-left: 4px solid #16803c;
}

.call-node-dao {
  border-left: 4px solid #a15c00;
}

.call-node-rpc {
  border-left: 4px solid #5b6677;
}

.call-node-changed {
  border-left: 4px solid #b42318;
}

.call-node-function {
  border-left: 4px solid #64748b;
}

.call-edge-exact .react-flow__edge-path {
  stroke: #1769e0;
  stroke-width: 2;
}

.call-edge-inferred .react-flow__edge-path {
  stroke: #a15c00;
  stroke-width: 2;
  stroke-dasharray: 6 4;
}

.call-edge-uncertain .react-flow__edge-path {
  stroke: #8a95a5;
  stroke-width: 2;
  stroke-dasharray: 2 4;
}

.react-flow__edge-textbg {
  fill: #ffffff;
}
```

- [ ] **Step 3: Build**

Run:

```bash
npm --prefix web run build
```

Expected:

```text
✓ built
```

---

### Task 5: Create Callchain Panel With Graph, Tree, And Evidence

**Files:**
- Create: `web/src/components/CallchainPanel.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Implement panel component**

Create `web/src/components/CallchainPanel.tsx`:

```tsx
import { BranchesOutlined } from '@ant-design/icons';
import { Descriptions, Space, Table, Tabs, Tag, Tree, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { DataNode } from 'antd/es/tree';
import { useMemo } from 'react';
import { buildCallchainGraph } from '../graph/callchainGraph';
import type { CallTreeNode, FunctionDetail, ImpactedInterface, InterfaceCallchainResponse, Route } from '../types';
import { CallchainGraph } from './CallchainGraph';

interface CallchainPanelProps {
  callchain: InterfaceCallchainResponse | { function: string; tree: CallTreeNode } | null;
  selectedRoute: Route | null;
  selectedFunction?: string;
  functionDetail: FunctionDetail | null;
  impactedInterface: ImpactedInterface | null;
  onSelectFunction: (functionID: string) => void;
}

export function CallchainPanel({
  callchain,
  selectedRoute,
  selectedFunction,
  functionDetail,
  impactedInterface,
  onSelectFunction,
}: CallchainPanelProps) {
  const graphModel = useMemo(
    () =>
      buildCallchainGraph(callchain?.tree, {
        route: selectedRoute,
        selectedFunction,
        functionDetail,
        impactedInterface,
      }),
    [callchain, functionDetail, impactedInterface, selectedFunction, selectedRoute],
  );

  const treeData = callchain ? [toTreeNode(callchain.tree)] : [];

  return (
    <section className="tree-pane detail-pane">
      <div className="pane-title">
        <BranchesOutlined />
        <span>Call Chain</span>
      </div>
      <Tabs
        size="small"
        items={[
          {
            key: 'graph',
            label: 'Graph',
            children: <CallchainGraph model={graphModel} onSelectFunction={onSelectFunction} />,
          },
          {
            key: 'tree',
            label: 'Tree',
            children: <Tree showLine defaultExpandAll treeData={treeData} />,
          },
          {
            key: 'evidence',
            label: 'Evidence',
            children: <EvidenceTable functionDetail={functionDetail} />,
          },
        ]}
      />
    </section>
  );
}

function EvidenceTable({ functionDetail }: { functionDetail: FunctionDetail | null }) {
  if (!functionDetail) {
    return <div className="graph-empty">Select a function to inspect edge evidence</div>;
  }

  return (
    <Space direction="vertical" size={12} className="full-width">
      <Descriptions size="small" column={1}>
        <Descriptions.Item label="Function">{functionDetail.function.id}</Descriptions.Item>
        <Descriptions.Item label="File">{`${functionDetail.function.file}:${functionDetail.function.start_line}-${functionDetail.function.end_line}`}</Descriptions.Item>
      </Descriptions>
      <Table
        size="small"
        rowKey={(edge) => `${edge.caller}-${edge.callee}-${edge.line}`}
        columns={edgeColumns}
        dataSource={[...(functionDetail.incoming_edges ?? []), ...(functionDetail.outgoing_edges ?? [])]}
        pagination={{ pageSize: 8, size: 'small' }}
      />
    </Space>
  );
}

const edgeColumns: ColumnsType<FunctionDetail['incoming_edges'][number]> = [
  { title: 'Caller', dataIndex: 'caller', ellipsis: true, render: (value: string) => <Typography.Text code>{shortFunction(value)}</Typography.Text> },
  { title: 'Callee', dataIndex: 'callee', ellipsis: true, render: (value: string) => <Typography.Text code>{shortFunction(value)}</Typography.Text> },
  { title: 'Source', dataIndex: 'source', width: 160 },
  { title: 'Confidence', dataIndex: 'confidence', width: 110, render: (value: string) => <Tag>{value}</Tag> },
  { title: 'Line', dataIndex: 'line', width: 80 },
];

function toTreeNode(node: CallTreeNode): DataNode {
  return {
    key: node.function + (node.edge ? `${node.edge.file}:${node.edge.line}` : ''),
    title: (
      <Space size={8}>
        <Typography.Text code>{shortFunction(node.function)}</Typography.Text>
        {node.edge && <Tag>{node.edge.confidence}</Tag>}
      </Space>
    ),
    children: node.children?.map(toTreeNode),
  };
}

function shortFunction(value: string): string {
  const parts = value.split('/');
  return parts[parts.length - 1] ?? value;
}
```

- [ ] **Step 2: Replace the current right tree panel in `App.tsx`**

Add import:

```tsx
import { CallchainPanel } from './components/CallchainPanel';
```

Replace the current `<section className="tree-pane">...</section>` block with:

```tsx
<CallchainPanel
  callchain={callchain}
  selectedRoute={selectedRoute}
  selectedFunction={functionInput}
  functionDetail={functionDetail}
  impactedInterface={selectedImpactedInterface}
  onSelectFunction={(functionID) => {
    void openFunctionDetail(functionID);
  }}
/>
```

- [ ] **Step 3: Add selected impacted interface state**

Add state near the existing `impact` state:

```tsx
const [selectedImpactedInterface, setSelectedImpactedInterface] = useState<ImpactedInterface | null>(null);
```

Update the impacted table row click:

```tsx
onRow={(row) => ({
  onClick: () => {
    setSelectedImpactedInterface(row);
    setCallchain({ function: row.changed_function, tree: chainToTree(row.chain) });
    setFunctionInput(row.changed_function);
    setRawPayload(row);
  },
})}
```

- [ ] **Step 4: Remove duplicate local helpers after import**

Remove `toTreeNode` from `App.tsx` if it is no longer used.

- [ ] **Step 5: Build**

Run:

```bash
npm --prefix web run build
```

Expected:

```text
✓ built
```

---

### Task 6: Add Object Rail For Routes And Functions

**Files:**
- Create: `web/src/components/ObjectRail.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Implement object rail**

Create `web/src/components/ObjectRail.tsx`:

```tsx
import { SearchOutlined } from '@ant-design/icons';
import { Empty, Input, List, Space, Tag, Typography } from 'antd';
import type { GoFunction, Route } from '../types';

interface ObjectRailProps {
  routes: Route[];
  functions: GoFunction[];
  filter: string;
  selectedRoute: Route | null;
  selectedFunction: string;
  onFilterChange: (value: string) => void;
  onSelectRoute: (route: Route) => void;
  onSelectFunction: (functionID: string) => void;
}

export function ObjectRail({
  routes,
  functions,
  filter,
  selectedRoute,
  selectedFunction,
  onFilterChange,
  onSelectRoute,
  onSelectFunction,
}: ObjectRailProps) {
  const keyword = filter.trim().toLowerCase();
  const routeItems = routes
    .filter((route) => `${route.method} ${route.path} ${route.handler}`.toLowerCase().includes(keyword))
    .slice(0, 30);
  const functionItems = functions
    .filter((fn) => `${fn.id} ${fn.file}`.toLowerCase().includes(keyword))
    .slice(0, 60);

  return (
    <aside className="object-rail">
      <div className="pane-title">Objects</div>
      <Input prefix={<SearchOutlined />} value={filter} onChange={(event) => onFilterChange(event.target.value)} />
      <div className="object-group-title">Routes</div>
      {routeItems.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No routes" />
      ) : (
        <List
          size="small"
          dataSource={routeItems}
          renderItem={(route) => (
            <List.Item
              className={selectedRoute?.method === route.method && selectedRoute.path === route.path ? 'object-item-active' : ''}
              onClick={() => onSelectRoute(route)}
            >
              <Space direction="vertical" size={2} className="full-width">
                <Space>
                  <Tag color="blue">{route.method}</Tag>
                  <Typography.Text ellipsis>{route.path}</Typography.Text>
                </Space>
                <Typography.Text type="secondary" ellipsis code>
                  {route.handler}
                </Typography.Text>
              </Space>
            </List.Item>
          )}
        />
      )}
      <div className="object-group-title">Functions</div>
      <List
        size="small"
        dataSource={functionItems}
        renderItem={(fn) => (
          <List.Item className={selectedFunction === fn.id ? 'object-item-active' : ''} onClick={() => onSelectFunction(fn.id)}>
            <Space direction="vertical" size={2} className="full-width">
              <Typography.Text ellipsis code>
                {fn.id}
              </Typography.Text>
              <Typography.Text type="secondary" ellipsis>
                {fn.file}:{fn.start_line}
              </Typography.Text>
            </Space>
          </List.Item>
        )}
      />
    </aside>
  );
}
```

- [ ] **Step 2: Add state and component usage in `App.tsx`**

Add state:

```tsx
const [objectFilter, setObjectFilter] = useState('');
```

Add import:

```tsx
import { ObjectRail } from './components/ObjectRail';
```

Insert `ObjectRail` between source panel and main content:

```tsx
<ObjectRail
  routes={routes}
  functions={functions}
  filter={objectFilter}
  selectedRoute={selectedRoute}
  selectedFunction={functionInput}
  onFilterChange={setObjectFilter}
  onSelectRoute={(route) => {
    if (task?.task_id) {
      void selectRoute(task.task_id, route).catch((err) => setError(errorMessage(err)));
    }
  }}
  onSelectFunction={(functionID) => {
    setFunctionInput(functionID);
    void openFunctionDetail(functionID);
  }}
/>
```

- [ ] **Step 3: Update grid layout styles**

Replace `.main-grid` in `web/src/styles.css`:

```css
.main-grid {
  display: grid;
  grid-template-columns: 320px 300px minmax(520px, 1fr) minmax(420px, 0.9fr);
  gap: 1px;
  min-height: calc(100vh - 56px);
  background: #d7dee8;
}
```

Append:

```css
.object-rail {
  min-width: 0;
  padding: 18px;
  overflow: auto;
  background: #ffffff;
}

.object-group-title {
  margin: 16px 0 8px;
  color: #667385;
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}

.object-item-active {
  background: #e8f3ff;
}

.object-rail .ant-list-item {
  cursor: pointer;
  border-radius: 6px;
}

.object-rail .ant-list-item:hover {
  background: #f7fbff;
}
```

- [ ] **Step 4: Build**

Run:

```bash
npm --prefix web run build
```

Expected:

```text
✓ built
```

---

### Task 7: Improve MR Impact Panel

**Files:**
- Create: `web/src/components/ImpactPanel.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Extract MR impact table**

Create `web/src/components/ImpactPanel.tsx`:

```tsx
import { BranchesOutlined } from '@ant-design/icons';
import { Empty, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ImpactedInterface, MRImpactResponse } from '../types';

interface ImpactPanelProps {
  impact: MRImpactResponse | null;
  selected: ImpactedInterface | null;
  onSelect: (row: ImpactedInterface) => void;
}

export function ImpactPanel({ impact, selected, onSelect }: ImpactPanelProps) {
  const data = impact?.impacted_interfaces ?? [];

  return (
    <section className="impact-panel">
      <div className="pane-title">
        <BranchesOutlined />
        <span>MR Impact</span>
      </div>
      {data.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No impacted interfaces" />
      ) : (
        <Table
          rowKey={(row) => `${row.method} ${row.path} ${row.changed_function}`}
          size="small"
          columns={impactColumns}
          dataSource={data}
          pagination={{ pageSize: 8, size: 'small' }}
          onRow={(row) => ({
            onClick: () => onSelect(row),
          })}
          rowClassName={(row) =>
            selected?.method === row.method && selected.path === row.path && selected.changed_function === row.changed_function ? 'selected-row' : ''
          }
        />
      )}
    </section>
  );
}

const impactColumns: ColumnsType<ImpactedInterface> = [
  { title: 'Method', dataIndex: 'method', width: 86, render: (value: string) => <Tag color={methodColor(value)}>{value}</Tag> },
  { title: 'Path', dataIndex: 'path', ellipsis: true },
  { title: 'Risk', dataIndex: 'risk', width: 90, render: (value: string) => <Tag color={value === 'direct' ? 'red' : 'gold'}>{value}</Tag> },
  { title: 'Changed Function', dataIndex: 'changed_function', ellipsis: true, render: (value: string) => <Typography.Text code>{shortFunction(value)}</Typography.Text> },
];

function methodColor(method: string): string {
  switch (method) {
    case 'GET':
      return 'blue';
    case 'POST':
      return 'green';
    case 'PUT':
      return 'gold';
    case 'PATCH':
      return 'purple';
    case 'DELETE':
      return 'red';
    default:
      return 'default';
  }
}

function shortFunction(value: string): string {
  const parts = value.split('/');
  return parts[parts.length - 1] ?? value;
}
```

- [ ] **Step 2: Use `ImpactPanel` in `App.tsx`**

Add import:

```tsx
import { ImpactPanel } from './components/ImpactPanel';
```

Replace the current impacted interfaces table with:

```tsx
<ImpactPanel
  impact={impact}
  selected={selectedImpactedInterface}
  onSelect={(row) => {
    setSelectedImpactedInterface(row);
    setCallchain({ function: row.changed_function, tree: chainToTree(row.chain) });
    setFunctionInput(row.changed_function);
    setRawPayload(row);
  }}
/>
```

- [ ] **Step 3: Build**

Run:

```bash
npm --prefix web run build
```

Expected:

```text
✓ built
```

---

### Task 8: Final UI Polish And Responsive Behavior

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Keep top-level source controls compact**

Move source controls into the top area when the grid is widened:

```tsx
<header className="topbar">
  <div className="brand">
    <CodeOutlined />
    <span>Go Callchain Service</span>
  </div>
  <Space>
    <Tag color={task?.status === 'done' ? 'green' : task?.status === 'failed' ? 'red' : 'blue'}>{task?.status ?? 'idle'}</Tag>
    <Button icon={<EyeOutlined />} onClick={() => setRawOpen(true)} disabled={!rawPayload}>
      JSON
    </Button>
  </Space>
</header>
```

- [ ] **Step 2: Add responsive grid rules**

Append to `web/src/styles.css`:

```css
@media (max-width: 1380px) {
  .main-grid {
    grid-template-columns: 300px minmax(520px, 1fr) minmax(420px, 0.9fr);
  }

  .object-rail {
    display: none;
  }
}

@media (max-width: 1100px) {
  .main-grid {
    grid-template-columns: 1fr;
  }

  .source-pane,
  .routes-pane,
  .tree-pane,
  .object-rail {
    min-height: auto;
  }

  .callchain-graph {
    height: 420px;
  }
}
```

- [ ] **Step 3: Build**

Run:

```bash
npm --prefix web run build
```

Expected:

```text
✓ built
```

---

### Task 9: Manual Verification

**Files:**
- No file edits

- [ ] **Step 1: Start backend server**

Run:

```bash
go run ./cmd/server
```

Expected:

```text
go-callchain-service listening on http://127.0.0.1:8787
```

- [ ] **Step 2: Open app**

Open:

```text
http://127.0.0.1:8787
```

- [ ] **Step 3: Verify local route graph**

Input:

```text
/Users/boyi.zhang/Work/BizProjects/TCM/TCM-BE
```

Expected:

```text
Routes table has rows
Selecting a route renders Graph and Tree tabs
Clicking a graph node opens Function Detail evidence
```

- [ ] **Step 4: Verify Git repository without routes**

Input:

```text
https://git.garena.com/shopee/seller-server/seller-governance/account-health/account-health-core.git
```

Expected:

```text
Routes empty state is visible
Functions list is still visible
Function graph search works
No "Cannot read properties of null" error appears
```

- [ ] **Step 5: Verify MR impact graph**

Input:

```text
base: master
head: feature/SPSL-146292
```

Expected:

```text
MR Impact table renders changed functions or empty state
Selecting an impact row renders a path graph
Selected changed function node is highlighted
```

---

## Validation Commands

Run before completion:

```bash
go test ./...
npm --prefix web run build
```

Expected:

```text
ok
✓ built
```

## Risks

- React Flow adds bundle weight. Keep graph scoped to focused paths and avoid rendering the full repository graph by default.
- Dagre layout can produce wide graphs for dense branches. Limit one-hop expansion and add a depth selector only after the first graph version is stable.
- Function IDs can be long. Graph node labels must use ellipsis and expose full IDs through selection, drawer, or Raw JSON.
- `routes=0` repositories are valid analysis outputs. Empty route UI must not block function graph exploration.

## Self-Review

- Spec coverage: UI graph view, MR impact path view, function evidence, route-empty repositories, responsive layout and validation are covered.
- Red-flag scan: no unfinished task markers remain.
- Type consistency: graph conversion uses existing `CallTreeNode`, `Edge`, `Route`, `FunctionDetail`, `ImpactedInterface`, and `MRImpactResponse` fields without backend API changes.
