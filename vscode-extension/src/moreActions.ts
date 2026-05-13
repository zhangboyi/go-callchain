export type MoreActionsView = 'interface' | 'impact' | 'function';

export interface MoreAction {
  label: string;
  description: string;
  command: string;
}

const commonActions: MoreAction[] = [
  { label: '重新分析当前目录', description: '重新解析当前 Go module', command: 'goCallchain.refresh' },
  { label: '选择分析目录', description: '指定包含 go.mod 的仓库目录', command: 'goCallchain.selectAnalysisDirectory' },
  { label: '清除分析目录', description: '恢复自动识别 go.mod', command: 'goCallchain.clearAnalysisDirectory' },
  { label: '重启服务', description: '重启插件内置 go-callchain-service', command: 'goCallchain.restartService' },
];

export function moreActionsForView(view: MoreActionsView): MoreAction[] {
  switch (view) {
    case 'interface':
      return [
        { label: '查看接口调用链', description: '从接口列表选择入口并展示调用链', command: 'goCallchain.showInterfaceCallchain' },
        { label: '查看当前 Graph', description: '展示当前接口调用链图', command: 'goCallchain.showCallchainGraph' },
        ...commonActions,
      ];
    case 'impact':
      return [
        { label: '分析 MR Impact', description: '选择 base...head 并分析受影响接口', command: 'goCallchain.analyzeLocalBranchImpact' },
        ...commonActions,
      ];
    case 'function':
      return [
        { label: '查看函数调用链', description: '从函数列表选择入口并展示调用链', command: 'goCallchain.showFunctionCallchain' },
        { label: '查看当前 Graph', description: '展示当前函数调用链图', command: 'goCallchain.showCallchainGraph' },
        ...commonActions,
      ];
  }
}
