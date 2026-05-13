import type { InterfaceCallchainResponse, Route } from './types';

export type InterfaceCallchainRootNode =
  | { kind: 'empty' }
  | { kind: 'route'; route: Route; selected: boolean };

export function interfaceCallchainRootNodes(
  routes: Route[],
  callchain?: InterfaceCallchainResponse,
): InterfaceCallchainRootNode[] {
  const visibleRoutes = withSelectedRoute(routes, callchain?.route);
  if (visibleRoutes.length === 0) {
    return [{ kind: 'empty' }];
  }
  return visibleRoutes.map((route) => ({
    kind: 'route',
    route,
    selected: routeHasSelectedCallchain(route, callchain),
  }));
}

export function routeHasSelectedCallchain(route: Route, callchain?: InterfaceCallchainResponse): boolean {
  return Boolean(callchain && sameRoute(route, callchain.route));
}

function withSelectedRoute(routes: Route[], selected?: Route): Route[] {
  if (!selected || routes.some((route) => sameRoute(route, selected))) {
    return routes;
  }
  return [selected, ...routes];
}

function sameRoute(left: Route, right: Route): boolean {
  return left.method === right.method && left.path === right.path;
}
