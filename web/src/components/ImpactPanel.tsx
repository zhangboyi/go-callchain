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
  const data = useMemo(() => uniqueImpactedInterfaces(impact?.impacted_interfaces ?? []), [impact]);
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
          rowKey={(row) => `${row.method} ${row.path} ${row.changed_function}`}
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
  { title: 'Handler', dataIndex: 'handler', ellipsis: true, render: (value: string) => <Typography.Text code>{shortFunction(value)}</Typography.Text> },
  { title: 'Changed Function', dataIndex: 'changed_function', ellipsis: true, render: (value: string) => <Typography.Text code>{shortFunction(value)}</Typography.Text> },
];

function uniqueImpactedInterfaces(rows: ImpactedInterface[]): ImpactedInterface[] {
  const indexes = new Map<string, number>();
  const unique: ImpactedInterface[] = [];
  rows.forEach((row) => {
    const key = `${row.method}\u0000${row.path}\u0000${row.handler}\u0000${row.changed_function}`;
    const existingIndex = indexes.get(key);
    if (existingIndex === undefined) {
      indexes.set(key, unique.length);
      unique.push(row);
      return;
    }
    if (shouldReplaceImpact(unique[existingIndex], row)) {
      unique[existingIndex] = row;
    }
  });
  return unique;
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
