export interface GraphPositionInput {
  depth: number;
  y: number;
}

export interface GraphCanvasDimensions {
  width: number;
  height: number;
  layoutWidth: number;
  layoutHeight: number;
  nodeWidth: number;
  nodeHeight: number;
  xGap: number;
  yGap: number;
  padding: number;
}

const nodeWidth = 310;
const nodeHeight = 70;
const xGap = 110;
const yGap = 24;
const padding = 32;
const minCanvasWidth = 960;
const minCanvasHeight = 560;

export function graphCanvasDimensions(maxDepth: number, maxY: number): GraphCanvasDimensions {
  const layoutWidth = padding * 2 + (maxDepth + 1) * nodeWidth + maxDepth * xGap;
  const layoutHeight = padding * 2 + (maxY + 1) * nodeHeight + maxY * yGap;
  return {
    width: Math.max(layoutWidth, minCanvasWidth),
    height: Math.max(layoutHeight, minCanvasHeight),
    layoutWidth,
    layoutHeight,
    nodeWidth,
    nodeHeight,
    xGap,
    yGap,
    padding,
  };
}

export function graphNodePosition(node: GraphPositionInput): { x: number; y: number } {
  return {
    x: padding + node.depth * (nodeWidth + xGap),
    y: padding + node.y * (nodeHeight + yGap),
  };
}
