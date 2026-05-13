import { SearchOutlined } from '@ant-design/icons';
import { Empty, Input, List, Tag, Typography } from 'antd';
import type { Route } from '../types';

interface ObjectRailProps {
  routes: Route[];
  filter: string;
  selectedRoute: Route | null;
  onFilterChange: (value: string) => void;
  onSelectRoute: (route: Route) => void;
}

export function ObjectRail({
  routes,
  filter,
  selectedRoute,
  onFilterChange,
  onSelectRoute,
}: ObjectRailProps) {
  const keyword = filter.trim().toLowerCase();
  const routeItems = routes
    .filter((route) => `${route.method} ${route.path} ${route.handler}`.toLowerCase().includes(keyword))
    .slice(0, 80);

  return (
    <aside className="object-rail">
      <div className="section-head">
        <div className="pane-title">Objects</div>
        <span className="object-meta">{routes.length} routes</span>
      </div>
      <div className="rail-body">
        <Input prefix={<SearchOutlined />} value={filter} onChange={(event) => onFilterChange(event.target.value)} placeholder="Search route / handler" />
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
                <div className="object-card">
                  <div className="object-route-line">
                    <Tag color={methodColor(route.method)}>{route.method}</Tag>
                    <Typography.Text className="object-route-path">{route.path}</Typography.Text>
                  </div>
                  <Typography.Text className="object-meta-code" type="secondary" code>
                    {route.handler}
                  </Typography.Text>
                </div>
              </List.Item>
            )}
          />
        )}
      </div>
    </aside>
  );
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
