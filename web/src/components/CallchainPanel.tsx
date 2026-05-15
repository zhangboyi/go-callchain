import { BranchesOutlined, FullscreenOutlined } from '@ant-design/icons';
import { Button, Descriptions, Drawer, Space, Table, Tabs, Tag, Tree, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { DataNode } from 'antd/es/tree';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildCallchainGraph, shortFunction } from '../graph/callchainGraph';
import {
  collectCallTreeEdgeTypes,
  collectFunctionDetailEdgeTypes,
  defaultVisibleEdgeTypes,
  edgeTypeMeta,
  filterCallTreeByEdgeTypes,
  filterFunctionDetailEdges,
  normalizeVisibleEdgeTypes,
  replaceAvailableEdgeTypes,
} from '../graph/edgeTypes';
import type { CallTreeNode, FunctionDetail, GoFunction, ImpactedInterface, InterfaceCallchainResponse, Route } from '../types';
import { CallchainGraph } from './CallchainGraph';
import { EdgeTypeFilter } from './EdgeTypeFilter';

interface CallchainPanelProps {
  callchain: InterfaceCallchainResponse | { function: string; tree: CallTreeNode } | null;
  selectedRoute: Route | null;
  selectedFunction?: string;
  functions: GoFunction[];
  functionDetail: FunctionDetail | null;
  impactedInterface: ImpactedInterface | null;
  changedFunctionIDs?: string[];
  onSelectFunction: (functionID: string) => void;
}

export function CallchainPanel({
  callchain,
  selectedRoute,
  selectedFunction,
  functions,
  functionDetail,
  impactedInterface,
  changedFunctionIDs = [],
  onSelectFunction,
}: CallchainPanelProps) {
  const [graphOpen, setGraphOpen] = useState(false);
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<Set<string>>(() => new Set(defaultVisibleEdgeTypes));
  const availableEdgeTypes = useMemo(() => {
    return Array.from(new Set([...collectCallTreeEdgeTypes(callchain?.tree), ...collectFunctionDetailEdgeTypes(functionDetail)]));
  }, [callchain, functionDetail]);
  const changeVisibleEdgeTypes = useCallback(
    (nextAvailableTypes: Set<string>) => {
      setVisibleEdgeTypes((current) => replaceAvailableEdgeTypes(current, availableEdgeTypes, nextAvailableTypes));
    },
    [availableEdgeTypes],
  );

  useEffect(() => {
    setVisibleEdgeTypes((current) => normalizeVisibleEdgeTypes(current, availableEdgeTypes));
  }, [availableEdgeTypes]);

  const filteredTree = useMemo(() => filterCallTreeByEdgeTypes(callchain?.tree, visibleEdgeTypes), [callchain, visibleEdgeTypes]);
  const filteredFunctionDetail = useMemo(() => filterFunctionDetailEdges(functionDetail, visibleEdgeTypes), [functionDetail, visibleEdgeTypes]);
  const graphModel = useMemo(
    () =>
      buildCallchainGraph(filteredTree, {
        route: selectedRoute,
        selectedFunction,
        functions,
        impactedInterface,
        changedFunctionIDs,
      }),
    [changedFunctionIDs, filteredTree, functions, impactedInterface, selectedFunction, selectedRoute],
  );

  const treeData = filteredTree ? [toTreeNode(filteredTree)] : [];

  return (
    <section className="tree-pane detail-pane">
      <div className="section-head">
        <div className="pane-title">
          <BranchesOutlined />
          <span>Call Chain</span>
        </div>
        <div className="callchain-tools">
          <EdgeTypeFilter availableTypes={availableEdgeTypes} visibleTypes={visibleEdgeTypes} onChange={changeVisibleEdgeTypes} />
          <Button icon={<FullscreenOutlined />} size="small" onClick={() => setGraphOpen(true)}>
            Expand
          </Button>
        </div>
      </div>
      <div className="detail-body">
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
              children: treeData.length > 0 ? <Tree showLine defaultExpandAll treeData={treeData} /> : <div className="graph-empty">No callchain selected</div>,
            },
            {
              key: 'evidence',
              label: 'Evidence',
              children: <EvidenceTable functionDetail={filteredFunctionDetail} />,
            },
          ]}
        />
      </div>
      <Drawer
        title="Call Chain Graph"
        width="calc(100vw - 48px)"
        open={graphOpen}
        zIndex={1200}
        onClose={() => setGraphOpen(false)}
        destroyOnClose
      >
        <CallchainGraph className="callchain-graph-expanded" model={graphModel} onSelectFunction={onSelectFunction} />
      </Drawer>
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
  {
    title: 'Source',
    dataIndex: 'source',
    width: 150,
    render: (value: string) => {
      const meta = edgeTypeMeta(value);
      return <Tag className={`edge-type-tag edge-type-tag-${meta.group}`}>{meta.label}</Tag>;
    },
  },
  { title: 'Confidence', dataIndex: 'confidence', width: 110, render: (value: string) => <Tag>{value}</Tag> },
  { title: 'Line', dataIndex: 'line', width: 72 },
];

function toTreeNode(node: CallTreeNode): DataNode {
  return {
    key: node.function + (node.edge ? `${node.edge.file}:${node.edge.line}` : ''),
    title: (
      <Space size={8}>
        <Typography.Text code>{shortFunction(node.function)}</Typography.Text>
        {node.edge && <Tag>{edgeTypeMeta(node.edge.source).label}</Tag>}
        {node.edge && <Tag>{node.edge.confidence}</Tag>}
      </Space>
    ),
    children: node.children?.map(toTreeNode),
  };
}
