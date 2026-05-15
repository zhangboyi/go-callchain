import { Empty, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { shortFunction } from '../graph/callchainGraph';
import type { ImpactedInterface, MRImpactResponse } from '../types';

interface ImpactPanelProps {
  impact: MRImpactResponse | null;
  selected: ImpactedInterface | null;
  onSelect: (row: ImpactedInterface) => void;
}

export function ImpactPanel({ impact, selected, onSelect }: ImpactPanelProps) {
  const data = useMemo(() => aggregateImpactedAPIs(impact?.impacted_interfaces ?? []), [impact]);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const emptyDescription = impact
    ? impact.changed_functions.length > 0
      ? 'Changed functions found, but no route is impacted within current depth.'
      : 'No changed functions found in this ref range.'
    : 'Run MR Impact to inspect affected interfaces.';

  useEffect(() => {
    setCurrentPage(1);
  }, [data.length]);

  return (
    <section className="impact-panel">
      {data.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyDescription} />
      ) : (
        <Table
          rowKey={(row) => `${row.method} ${row.path} ${row.handler}`}
          size="small"
          columns={impactColumns}
          dataSource={data}
          pagination={{
            current: currentPage,
            pageSize,
            total: data.length,
            size: 'small',
            showSizeChanger: true,
            pageSizeOptions: [8, 15, 30, 50, 100],
            showTotal: (total, range) => `${range[0]}-${range[1]} / ${total}`,
            onChange: (page, nextPageSize) => {
              setCurrentPage(page);
              setPageSize(nextPageSize);
            },
          }}
          scroll={{ x: 1100 }}
          expandable={{
            expandedRowRender: (row) => (
              <Table<ImpactedInterface>
                className="impact-function-table"
                rowKey={(item) => `${item.method} ${item.path} ${item.changed_function}`}
                size="small"
                columns={impactFunctionColumns}
                dataSource={row.changed_items}
                pagination={false}
                onRow={(item) => ({
                  onClick: (event) => {
                    event.stopPropagation();
                    onSelect(item);
                  },
                })}
                rowClassName={(item) => (selected?.method === item.method && selected.path === item.path && selected.changed_function === item.changed_function ? 'selected-row' : '')}
              />
            ),
            rowExpandable: (row) => row.changed_items.length > 0,
          }}
          onRow={(row) => ({
            onClick: () => onSelect(row),
          })}
          rowClassName={(row) =>
            selected?.method === row.method && selected.path === row.path && selected.handler === row.handler ? 'selected-row' : ''
          }
        />
      )}
    </section>
  );
}

interface ImpactedAPI extends ImpactedInterface {
  changed_functions: string[];
  changed_items: ImpactedInterface[];
  direct_count: number;
  indirect_count: number;
}

const impactColumns: ColumnsType<ImpactedAPI> = [
  { title: 'Method', dataIndex: 'method', width: 86, render: (value: string) => <Tag color={methodColor(value)}>{value}</Tag> },
  { title: 'Path', dataIndex: 'path', ellipsis: true },
  {
    title: 'Risk',
    width: 150,
    render: (_, row) => (
      <>
        {row.direct_count > 0 && <Tag color="red">direct {row.direct_count}</Tag>}
        {row.indirect_count > 0 && <Tag color="gold">indirect {row.indirect_count}</Tag>}
      </>
    ),
  },
  { title: 'Handler', dataIndex: 'handler', ellipsis: true, render: (value: string) => <Typography.Text code>{shortFunction(value)}</Typography.Text> },
  {
    title: 'Changed Functions',
    width: 190,
    render: (_, row) => <Typography.Text>{row.changed_functions.length} functions</Typography.Text>,
  },
];

const impactFunctionColumns: ColumnsType<ImpactedInterface> = [
  { title: 'Risk', dataIndex: 'risk', width: 100, render: (value: string) => <Tag color={value === 'direct' ? 'red' : 'gold'}>{value}</Tag> },
  {
    title: 'Changed Function',
    dataIndex: 'changed_function',
    ellipsis: true,
    render: (value: string) => <Typography.Text code>{shortFunction(value)}</Typography.Text>,
  },
  { title: 'Depth', width: 80, render: (_, row) => row.chain.length },
];

function aggregateImpactedAPIs(rows: ImpactedInterface[]): ImpactedAPI[] {
  const groups = new Map<string, ImpactedAPI>();
  rows.forEach((row) => {
    const key = `${row.method}\u0000${row.path}\u0000${row.handler}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        ...row,
        changed_functions: [row.changed_function],
        changed_items: [row],
        direct_count: row.risk === 'direct' ? 1 : 0,
        indirect_count: row.risk === 'direct' ? 0 : 1,
      });
      return;
    }
    if (!group.changed_functions.includes(row.changed_function)) {
      group.changed_functions.push(row.changed_function);
      group.changed_items.push(row);
    }
    if (row.risk === 'direct') {
      group.direct_count += 1;
    } else {
      group.indirect_count += 1;
    }
    if (shouldReplaceImpact(group, row)) {
      group.changed_function = row.changed_function;
      group.chain = row.chain;
      group.risk = row.risk;
    }
  });
  return [...groups.values()];
}

function shouldReplaceImpact(existing: ImpactedInterface, next: ImpactedInterface): boolean {
  if (riskRank(next.risk) !== riskRank(existing.risk)) {
    return riskRank(next.risk) < riskRank(existing.risk);
  }
  return next.chain.length > 0 && (existing.chain.length === 0 || next.chain.length < existing.chain.length);
}

function riskRank(risk: string): number {
  return risk === 'direct' ? 0 : 1;
}

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
