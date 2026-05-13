export interface GraphToolbarAction {
  id: string;
  label: string;
  title: string;
}

export function graphToolbarActions(): GraphToolbarAction[] {
  return [
    { id: 'reset-layout', label: 'Reset layout', title: 'Reset graph layout and pan' },
    { id: 'fullscreen-graph', label: 'Toggle fullscreen', title: 'Toggle graph editor fullscreen' },
    { id: 'copy-png', label: 'Copy PNG', title: 'Copy graph PNG to clipboard' },
    { id: 'export-png', label: 'Export PNG', title: 'Export graph as PNG file' },
  ];
}

export function graphToolbarPresentation(): 'menu' {
  return 'menu';
}
