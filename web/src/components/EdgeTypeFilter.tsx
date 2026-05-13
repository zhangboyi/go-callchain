import { FilterOutlined } from '@ant-design/icons';
import { Button, Checkbox, Popover, Space, Tag, Tooltip, Typography } from 'antd';
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
        <Button size="small" onClick={() => onChange(new Set(availableTypes))}>
          All
        </Button>
        <Button size="small" onClick={() => onChange(pickAvailable(coreOnlyEdgeTypes, availableTypes))}>
          Core only
        </Button>
        <Button size="small" onClick={() => onChange(pickAvailable(hideUtilityEdgeTypes, availableTypes))}>
          Hide utility
        </Button>
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
