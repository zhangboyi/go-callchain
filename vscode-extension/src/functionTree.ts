import * as vscode from 'vscode';
import { functionCallchainRootKinds } from './functionCallchainViewModel';
import type { ExtensionState } from './state';
import type { CallTreeNode } from './types';
import { FunctionTreeItem, shortFunctionName } from './treeItems';

type FunctionCallchainNode =
  | { kind: 'empty' }
  | FunctionCallchainTreeNode;

type FunctionCallchainTreeNode = {
  kind: 'callchain';
  node: CallTreeNode;
  functionID: string;
  callchain: { function: string; tree: CallTreeNode };
};

export class FunctionCallchainTreeProvider implements vscode.TreeDataProvider<FunctionCallchainNode> {
  private readonly changeEmitter = new vscode.EventEmitter<FunctionCallchainNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly state: ExtensionState) {
    this.state.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(node: FunctionCallchainNode): vscode.TreeItem {
    switch (node.kind) {
      case 'empty':
        return new FunctionTreeItem({
          label: '点击顶部“查看调用链”选择入口函数',
          tooltip: '查看调用链会弹出可搜索函数列表，结果显示在这里',
          command: { title: '查看调用链', command: 'goCallchain.showFunctionCallchain' },
          collapsibleState: vscode.TreeItemCollapsibleState.None,
        });
      case 'callchain':
        return this.callchainItem(node);
    }
  }

  getChildren(node?: FunctionCallchainNode): FunctionCallchainNode[] {
    if (!node) {
      return functionCallchainRootKinds(this.state.functions, this.state.functionCallchain).map((kind) => {
        if (kind === 'callchain') {
          return callchainNode(this.state.functionCallchain!.tree);
        }
        return { kind };
      });
    }
    if (node.kind === 'callchain') {
      return (node.node.children ?? []).map((child) => callchainNode(child));
    }
    return [];
  }

  private callchainItem(element: FunctionCallchainTreeNode): vscode.TreeItem {
    const node = element.node;
    const item = new FunctionTreeItem({
      label: shortFunctionName(node.function),
      description: node.edge ? `${node.edge.source} ${node.edge.confidence}` : undefined,
      tooltip: node.function,
      functionID: element.functionID,
      callchain: element.callchain,
      collapsibleState: node.children?.length
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
      command: {
        title: '打开源码',
        command: 'goCallchain.openFunction',
        arguments: [element],
      },
      contextValue: 'goCallchain.function.callchain',
    });
    item.iconPath = new vscode.ThemeIcon(node.edge ? 'symbol-method' : 'debug-start');
    return item;
  }
}

function callchainNode(node: CallTreeNode): FunctionCallchainTreeNode {
  return {
    kind: 'callchain',
    node,
    functionID: node.function,
    callchain: { function: node.function, tree: node },
  };
}
