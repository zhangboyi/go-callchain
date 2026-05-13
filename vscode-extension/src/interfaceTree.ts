import * as vscode from 'vscode';
import { interfaceCallchainRootNodes, routeHasSelectedCallchain } from './interfaceCallchainViewModel';
import type { ExtensionState } from './state';
import type { CallTreeNode, Route } from './types';
import { FunctionTreeItem, shortFunctionName } from './treeItems';

type InterfaceCallchainNode =
  | { kind: 'empty' }
  | { kind: 'route'; route: Route; selected: boolean }
  | InterfaceCallchainTreeNode;

type InterfaceCallchainTreeNode = {
  kind: 'callchain';
  node: CallTreeNode;
  functionID: string;
  callchain: { function: string; tree: CallTreeNode };
};

export class InterfaceCallchainTreeProvider implements vscode.TreeDataProvider<InterfaceCallchainNode> {
  private readonly changeEmitter = new vscode.EventEmitter<InterfaceCallchainNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly state: ExtensionState) {
    this.state.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(node: InterfaceCallchainNode): vscode.TreeItem {
    switch (node.kind) {
      case 'empty':
        return new FunctionTreeItem({
          label: '点击顶部“分析工作区”加载接口列表',
          tooltip: '分析后接口会显示在这里；查看接口调用链可搜索接口',
          command: { title: '查看接口调用链', command: 'goCallchain.showInterfaceCallchain' },
          collapsibleState: vscode.TreeItemCollapsibleState.None,
        });
      case 'route':
        return this.routeItem(node.route, node.selected);
      case 'callchain':
        return this.callchainItem(node);
    }
  }

  getChildren(node?: InterfaceCallchainNode): InterfaceCallchainNode[] {
    if (!node) {
      return interfaceCallchainRootNodes(this.state.routes, this.state.interfaceCallchain).map((item) => {
        if (item.kind === 'route') {
          return item;
        }
        return { kind: 'empty' };
      });
    }
    if (node.kind === 'route' && routeHasSelectedCallchain(node.route, this.state.interfaceCallchain)) {
      return [callchainNode(this.state.interfaceCallchain!.tree)];
    }
    if (node.kind === 'callchain') {
      return (node.node.children ?? []).map((child) => callchainNode(child));
    }
    return [];
  }

  private routeItem(route: Route, selected: boolean): vscode.TreeItem {
    const item = new FunctionTreeItem({
      label: `${route.method} ${route.path}`,
      description: shortFunctionName(route.handler),
      tooltip: `${route.handler}\n${route.file}:${route.line}`,
      functionID: route.handler,
      collapsibleState: selected
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None,
      command: {
        title: '查看接口调用链',
        command: 'goCallchain.showInterfaceCallchainFromRoute',
        arguments: [route],
      },
      contextValue: selected ? 'goCallchain.route.interface.selected' : 'goCallchain.route.interface',
    });
    item.iconPath = new vscode.ThemeIcon('symbol-interface');
    return item;
  }

  private callchainItem(element: InterfaceCallchainTreeNode): vscode.TreeItem {
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
      contextValue: 'goCallchain.function.interfaceCallchain',
    });
    item.iconPath = new vscode.ThemeIcon(node.edge ? 'symbol-method' : 'debug-start');
    return item;
  }
}

function callchainNode(node: CallTreeNode): InterfaceCallchainTreeNode {
  return {
    kind: 'callchain',
    node,
    functionID: node.function,
    callchain: { function: node.function, tree: node },
  };
}
