export interface GraphCollapseEdge {
  from: string;
  to: string;
}

export function graphChildrenByNode(edges: readonly GraphCollapseEdge[]): Map<string, string[]> {
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    const values = children.get(edge.from) ?? [];
    values.push(edge.to);
    children.set(edge.from, values);
  }
  return children;
}

export function graphDescendantKeys(edges: readonly GraphCollapseEdge[], nodeKey: string): string[] {
  const children = graphChildrenByNode(edges);
  const descendants: string[] = [];
  const seen = new Set<string>();

  function visit(key: string): void {
    for (const child of children.get(key) ?? []) {
      if (seen.has(child)) {
        continue;
      }
      seen.add(child);
      descendants.push(child);
      visit(child);
    }
  }

  visit(nodeKey);
  return descendants;
}

export function graphHiddenNodeKeys(
  edges: readonly GraphCollapseEdge[],
  collapsedNodeKeys: readonly string[],
): string[] {
  const hidden = new Set<string>();
  for (const key of collapsedNodeKeys) {
    for (const descendant of graphDescendantKeys(edges, key)) {
      hidden.add(descendant);
    }
  }
  return Array.from(hidden);
}
