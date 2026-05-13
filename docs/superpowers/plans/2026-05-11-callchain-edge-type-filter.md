# Callchain Edge Type Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-controlled edge type filter for Call Chain Graph, Tree, and Evidence views so noisy call sources can be hidden without rerunning analysis.

**Architecture:** Keep analysis results unchanged and perform filtering entirely in the React view layer. Add a small edge type domain module, a compact Ant Design filter component, and wire the same selected edge type set into graph conversion, tree rendering, and evidence tables.

**Tech Stack:** React 18, TypeScript, Ant Design 5, @xyflow/react, Vitest.

---

## File Structure

- Create `web/src/graph/edgeTypes.ts`
  - Owns edge source metadata, grouping, default visibility, tree/detail filtering, and source type collection.
- Create `web/src/components/EdgeTypeFilter.tsx`
  - Renders edge type controls with `All`, `Core only`, and `Hide utility` actions.
- Modify `web/src/components/CallchainPanel.tsx`
  - Owns visible edge type state and applies filtering consistently to Graph, Tree, Evidence, and expanded drawer.
- Modify `web/src/components/CallchainGraph.tsx`
  - Style edge labels using source type metadata and keep graph layout reset behavior unchanged.
- Modify `web/src/graph/types.ts`
  - Type `sourceType` as a known edge source string where possible.
- Modify `web/src/styles.css`
  - Add compact filter bar, edge legend colors, and source type tag styles.
- Add `web/src/graph/edgeTypes.test.ts`
  - Unit tests for source collection and tree/evidence filtering.
- Modify `web/src/graph/callchainGraph.test.ts`
  - Ensure graph conversion still preserves source type labels after filtering input.

---

### Task 1: Add Edge Source Domain Helpers

**Files:**
- Create: `web/src/graph/edgeTypes.ts`
- Test: `web/src/graph/edgeTypes.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  collectCallTreeEdgeTypes,
  collectFunctionDetailEdgeTypes,
  defaultVisibleEdgeTypes,
  filterCallTreeByEdgeTypes,
  filterFunctionDetailEdges,
  hideUtilityEdgeTypes,
} from './edgeTypes';
import type { CallTreeNode, FunctionDetail } from '../types';

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
    expect(filtered.incoming_edges).toEqual([]);
    expect(filtered.outgoing_edges).toEqual([
      { caller: 'handler.Create', callee: 'service.Create', file: 'handler.go', line: 12, source: 'package_variable', confidence: 'exact' },
    ]);
  });

  it('keeps current behavior by default and supports hide utility preset', () => {
    expect(defaultVisibleEdgeTypes.has('package_selector')).toBe(true);
    expect(hideUtilityEdgeTypes.has('package_selector')).toBe(false);
    expect(hideUtilityEdgeTypes.has('package_variable')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm --prefix web test -- --run web/src/graph/edgeTypes.test.ts
```

Expected: FAIL because `web/src/graph/edgeTypes.ts` does not exist.

- [ ] **Step 3: Implement edge type helpers**

```ts
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
  const available = new Set(availableTypes);
  const kept = new Set(Array.from(current).filter((type) => available.has(type)));
  for (const type of availableTypes) {
    if (!current.has(type) && defaultVisibleEdgeTypes.has(type)) {
      kept.add(type);
    }
  }
  return kept;
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
  const order = new Map(edgeTypeCatalog.map((item, index) => [item.type, index]));
  return Array.from(types).sort((left, right) => (order.get(left) ?? 999) - (order.get(right) ?? 999) || left.localeCompare(right));
}

function humanizeEdgeType(type: string) {
  return type
    .split('_')
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}
```

- [ ] **Step 4: Run tests**

```bash
npm --prefix web test -- --run web/src/graph/edgeTypes.test.ts
```

Expected: PASS.

---

### Task 2: Add Edge Type Filter UI

**Files:**
- Create: `web/src/components/EdgeTypeFilter.tsx`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Implement compact filter component**

```tsx
import { Button, Checkbox, Popover, Space, Tag, Tooltip, Typography } from 'antd';
import { FilterOutlined } from '@ant-design/icons';
import type { CheckboxValueType } from 'antd/es/checkbox/Group';
import { coreOnlyEdgeTypes, edgeTypeMeta, hideUtilityEdgeTypes } from '../graph/edgeTypes';

interface EdgeTypeFilterProps {
  availableTypes: string[];
  visibleTypes: Set<string>;
  onChange: (next: Set<string>) => void;
}

export function EdgeTypeFilter({ availableTypes, visibleTypes, onChange }: EdgeTypeFilterProps) {
  const selectedCount = availableTypes.filter((type) => visibleTypes.has(type)).length;
  const content = (
    <Space direction="vertical" size={10} className="edge-type-filter-popover">
      <Space size={8} wrap>
        <Button size="small" onClick={() => onChange(new Set(availableTypes))}>All</Button>
        <Button size="small" onClick={() => onChange(pickAvailable(coreOnlyEdgeTypes, availableTypes))}>Core only</Button>
        <Button size="small" onClick={() => onChange(pickAvailable(hideUtilityEdgeTypes, availableTypes))}>Hide utility</Button>
      </Space>
      <Checkbox.Group
        className="edge-type-checkboxes"
        value={availableTypes.filter((type) => visibleTypes.has(type))}
        onChange={(values: CheckboxValueType[]) => onChange(new Set(values.map(String)))}
      >
        {availableTypes.map((type) => {
          const meta = edgeTypeMeta(type);
          return (
            <Tooltip key={type} title={meta.description} placement="right">
              <Checkbox value={type}>
                <Space size={6}>
                  <span>{meta.label}</span>
                  <Tag className={`edge-type-tag edge-type-tag-${meta.group}`}>{meta.group}</Tag>
                </Space>
              </Checkbox>
            </Tooltip>
          );
        })}
      </Checkbox.Group>
    </Space>
  );

  return (
    <Popover trigger="click" placement="bottomRight" content={content}>
      <Button size="small" icon={<FilterOutlined />} disabled={availableTypes.length === 0}>
        Edge Types
        <Typography.Text type="secondary" className="edge-type-count">
          {selectedCount}/{availableTypes.length}
        </Typography.Text>
      </Button>
    </Popover>
  );
}

function pickAvailable(types: Set<string>, availableTypes: string[]) {
  return new Set(availableTypes.filter((type) => types.has(type)));
}
```

- [ ] **Step 2: Add styles**

Append to `web/src/styles.css`:

```css
.edge-type-filter-popover {
  min-width: 260px;
  max-width: 360px;
}

.edge-type-checkboxes {
  display: grid;
  grid-template-columns: 1fr;
  row-gap: 8px;
}

.edge-type-count {
  margin-left: 6px;
  font-size: 12px;
}

.edge-type-tag {
  margin-inline-end: 0;
  border-radius: 6px;
  font-size: 11px;
  line-height: 18px;
}

.edge-type-tag-route {
  color: #1769e0;
  background: #eef5ff;
  border-color: #b8d6ff;
}

.edge-type-tag-core {
  color: #16803c;
  background: #edf9f1;
  border-color: #bce8c8;
}

.edge-type-tag-utility {
  color: #7a4a00;
  background: #fff7e8;
  border-color: #ffd591;
}

.edge-type-tag-inferred {
  color: #5b6677;
  background: #f4f6f8;
  border-color: #d7dee8;
}

.callchain-tools {
  display: flex;
  align-items: center;
  gap: 8px;
}
```

- [ ] **Step 3: Run type check**

```bash
npm --prefix web run build
```

Expected: PASS or fail only because the component is not wired yet if TypeScript flags unused exports. If unused exports fail, proceed to Task 3 and rerun build.

---

### Task 3: Wire Filtering Into CallchainPanel

**Files:**
- Modify: `web/src/components/CallchainPanel.tsx`

- [ ] **Step 1: Import helpers and component**

Update imports:

```tsx
import { useEffect, useMemo, useState } from 'react';
import {
  collectCallTreeEdgeTypes,
  collectFunctionDetailEdgeTypes,
  defaultVisibleEdgeTypes,
  edgeTypeMeta,
  filterCallTreeByEdgeTypes,
  filterFunctionDetailEdges,
  normalizeVisibleEdgeTypes,
} from '../graph/edgeTypes';
import { EdgeTypeFilter } from './EdgeTypeFilter';
```

- [ ] **Step 2: Add filter state and filtered models**

Inside `CallchainPanel` before `graphModel`:

```tsx
const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<Set<string>>(() => new Set(defaultVisibleEdgeTypes));

const availableEdgeTypes = useMemo(() => {
  return Array.from(
    new Set([
      ...collectCallTreeEdgeTypes(callchain?.tree),
      ...collectFunctionDetailEdgeTypes(functionDetail),
    ]),
  );
}, [callchain, functionDetail]);

useEffect(() => {
  setVisibleEdgeTypes((current) => normalizeVisibleEdgeTypes(current, availableEdgeTypes));
}, [availableEdgeTypes]);

const filteredTree = useMemo(() => filterCallTreeByEdgeTypes(callchain?.tree, visibleEdgeTypes), [callchain, visibleEdgeTypes]);
const filteredFunctionDetail = useMemo(() => filterFunctionDetailEdges(functionDetail, visibleEdgeTypes), [functionDetail, visibleEdgeTypes]);
```

- [ ] **Step 3: Build graph and tree from filtered data**

Replace current `graphModel` and `treeData`:

```tsx
const graphModel = useMemo(
  () =>
    buildCallchainGraph(filteredTree, {
      route: selectedRoute,
      selectedFunction,
      functions,
      functionDetail: filteredFunctionDetail,
      impactedInterface,
    }),
  [filteredFunctionDetail, filteredTree, functions, impactedInterface, selectedFunction, selectedRoute],
);

const treeData = filteredTree ? [toTreeNode(filteredTree)] : [];
```

- [ ] **Step 4: Add filter control beside Expand**

Replace the right side of `.section-head`:

```tsx
<div className="callchain-tools">
  <EdgeTypeFilter availableTypes={availableEdgeTypes} visibleTypes={visibleEdgeTypes} onChange={setVisibleEdgeTypes} />
  <Button icon={<FullscreenOutlined />} size="small" onClick={() => setGraphOpen(true)}>
    Expand
  </Button>
</div>
```

- [ ] **Step 5: Use filtered detail in Evidence**

Replace `EvidenceTable` usage:

```tsx
children: <EvidenceTable functionDetail={filteredFunctionDetail} />,
```

- [ ] **Step 6: Show edge source type in tree nodes**

Replace the `Tag` in `toTreeNode`:

```tsx
{node.edge && <Tag>{edgeTypeMeta(node.edge.source).label}</Tag>}
{node.edge && <Tag>{node.edge.confidence}</Tag>}
```

- [ ] **Step 7: Run focused tests/build**

```bash
npm --prefix web run build
```

Expected: PASS.

---

### Task 4: Improve Graph Edge Labels and Styling

**Files:**
- Modify: `web/src/components/CallchainGraph.tsx`
- Modify: `web/src/graph/types.ts`
- Modify: `web/src/styles.css`

- [ ] **Step 1: Type edge source data**

In `web/src/graph/types.ts`:

```ts
import type { Edge, GoFunction } from '../types';
import type { EdgeSourceType } from './edgeTypes';
```

Update `CallchainGraphEdgeData`:

```ts
export interface CallchainGraphEdgeData extends Record<string, unknown> {
  sourceType?: EdgeSourceType;
  confidence?: string;
  file?: string;
  line?: number;
  edge?: Edge;
}
```

- [ ] **Step 2: Use readable edge labels**

In `web/src/components/CallchainGraph.tsx`, import:

```tsx
import { edgeTypeMeta } from '../graph/edgeTypes';
```

Replace edge label/class creation in `layoutGraph`:

```tsx
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
```

- [ ] **Step 3: Keep labels readable**

Add to `web/src/styles.css`:

```css
.call-edge-source-utility .react-flow__edge-text {
  fill: #7a4a00;
}

.call-edge-source-inferred .react-flow__edge-text {
  fill: #5b6677;
}

.call-edge-source-core .react-flow__edge-text,
.call-edge-source-route .react-flow__edge-text {
  fill: #1f2937;
}
```

- [ ] **Step 4: Run graph tests**

```bash
npm --prefix web test -- --run web/src/graph/callchainGraph.test.ts
```

Expected: PASS.

---

### Task 5: Add Regression Coverage for Panel-Level Filtering

**Files:**
- Test: `web/src/graph/edgeTypes.test.ts`
- Modify: `web/src/graph/callchainGraph.test.ts`

- [ ] **Step 1: Add graph conversion assertion for filtered tree**

Append to `web/src/graph/callchainGraph.test.ts`:

```ts
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
```

- [ ] **Step 2: Run all frontend tests**

```bash
npm --prefix web test -- --run
```

Expected: PASS.

---

### Task 6: Manual Verification

**Files:**
- No code changes.

- [ ] **Step 1: Build frontend**

```bash
npm --prefix web run build
```

Expected: PASS.

- [ ] **Step 2: Run backend tests**

```bash
go test ./...
```

Expected: PASS.

- [ ] **Step 3: Restart local service**

```bash
go build -o .agent-work/runtime/bin/go-callchain-service ./cmd/server
```

Then restart the running service on `127.0.0.1:8787`.

- [ ] **Step 4: Browser verification**

Open:

```text
http://127.0.0.1:8787/
```

Verify:

- `Edge Types` appears in the Call Chain header.
- `All` preserves the current graph.
- `Hide utility` removes `package_selector` edges such as `common.GenResp`.
- `Core only` keeps route/core business edges and removes inferred/noisy edges.
- Graph, Tree, Evidence change together.
- `Expand` drawer uses the same filter state.
- `Reset Layout`, node drag, collapse/expand still work after filtering.

---

## Risks

- If filtering removes the only child edge, the graph may show only the selected root. This is expected; the UI should still render a valid one-node graph.
- Filtering is intentionally view-only. API responses and cached analysis results must not change.
- `FunctionDetail` one-hop edges are capped in `buildCallchainGraph`; filtering happens before that cap, so visible one-hop count may be lower than 12.

## Completion Criteria

- Users can hide/show edge source types without rerunning analysis.
- Graph, Tree, and Evidence are consistent under the same filter.
- Current default behavior is unchanged because all available edge types are selected by default.
- `npm --prefix web test -- --run`, `npm --prefix web run build`, and `go test ./...` pass.
