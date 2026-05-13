export interface GraphTooltipNode {
  functionID: string;
  label: string;
  detail: string;
}

export interface GraphTooltipEdge {
  source?: string;
  confidence?: string;
}

export function graphNodeTooltip(node: GraphTooltipNode): string {
  return uniqueLines([node.label, node.detail, node.functionID]).join('\n');
}

export function graphEdgeTooltip(edge: GraphTooltipEdge): string {
  return uniqueLines([edge.source, edge.confidence]).join(' · ');
}

export function truncateText(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, Math.max(1, length - 1))}…`;
}

export function graphInteractionCapabilities(): {
  dragNodes: true;
  panCanvas: true;
  exportPng: true;
  copyPng: true;
  fullscreen: true;
  fastTooltips: true;
  collapseNodes: true;
} {
  return {
    dragNodes: true,
    panCanvas: true,
    exportPng: true,
    copyPng: true,
    fullscreen: true,
    fastTooltips: true,
    collapseNodes: true,
  };
}

export function graphTooltipDelayMs(): number {
  return 80;
}

function uniqueLines(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const value of values) {
    const line = value?.trim();
    if (!line || seen.has(line)) {
      continue;
    }
    seen.add(line);
    lines.push(line);
  }
  return lines;
}
