import * as vscode from 'vscode';
import type { ExtensionState } from './state';
import type { ChangedFunction, ImpactedInterface } from './types';
import { impactFunctionCandidates, impactInterfaceCallchain, impactPrimaryFunctionID } from './impactCallchain';
import { FunctionTreeItem, shortFunctionName } from './treeItems';

type ImpactNode =
  | { kind: 'empty'; label: string }
  | { kind: 'group'; label: string; group: 'changed' | 'interfaces' }
  | { kind: 'changed'; item: ChangedFunction }
  | { kind: 'interface'; item: ImpactedInterface }
  | { kind: 'chain'; functionID: string; index: number };

export class ImpactTreeProvider implements vscode.TreeDataProvider<ImpactNode> {
  private readonly changeEmitter = new vscode.EventEmitter<ImpactNode | undefined>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(private readonly state: ExtensionState) {
    this.state.onDidChange(() => this.refresh());
  }

  refresh(): void {
    this.changeEmitter.fire(undefined);
  }

  getTreeItem(node: ImpactNode): vscode.TreeItem {
    switch (node.kind) {
      case 'empty':
        return new FunctionTreeItem({
          label: node.label,
          collapsibleState: vscode.TreeItemCollapsibleState.None,
        });
      case 'group':
        return new FunctionTreeItem({
          label: node.label,
          collapsibleState: vscode.TreeItemCollapsibleState.Expanded,
        });
      case 'changed':
        return this.changedItem(node.item);
      case 'interface':
        const functionID = impactPrimaryFunctionID(node.item);
        const functionCandidates = impactFunctionCandidates(node.item);
        return new FunctionTreeItem({
          label: `${node.item.method} ${node.item.path}`,
          description: node.item.risk,
          tooltip: `${node.item.handler}\nchanged: ${node.item.changed_function}`,
          functionID,
          functionCandidates,
          callchain: impactInterfaceCallchain(node.item),
          collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
          command: {
            title: '查看接口调用链',
            command: 'goCallchain.showInterfaceCallchainFromImpact',
            arguments: [node.item],
          },
          contextValue: 'goCallchain.function.interface',
        });
      case 'chain':
        return new FunctionTreeItem({
          label: `${node.index + 1}. ${shortFunctionName(node.functionID)}`,
          description: this.isChangedFunction(node.functionID) ? 'changed' : undefined,
          tooltip: node.functionID,
          functionID: node.functionID,
          command: openFunctionCommand(node.functionID),
          contextValue: 'goCallchain.function.chain',
        });
    }
  }

  getChildren(node?: ImpactNode): ImpactNode[] {
    const impact = this.state.impact;
    if (!impact) {
      return [{ kind: 'empty', label: '运行 Go Callchain: Analyze MR Impact' }];
    }
    if (!node) {
      return [
        { kind: 'group', label: `Changed Functions (${impact.changed_functions.length})`, group: 'changed' },
        { kind: 'group', label: `Impacted Interfaces (${impact.impacted_interfaces.length})`, group: 'interfaces' },
      ];
    }
    if (node.kind === 'group' && node.group === 'changed') {
      return impact.changed_functions.map((item) => ({ kind: 'changed', item }));
    }
    if (node.kind === 'group' && node.group === 'interfaces') {
      return impact.impacted_interfaces.map((item) => ({ kind: 'interface', item }));
    }
    if (node.kind === 'interface') {
      return node.item.chain.map((functionID, index) => ({ kind: 'chain', functionID, index }));
    }
    return [];
  }

  private changedItem(item: ChangedFunction): vscode.TreeItem {
    const treeItem = new FunctionTreeItem({
      label: shortFunctionName(item.id),
      description: `${item.file}:${item.start_line}`,
      tooltip: item.id,
      functionID: item.id,
      command: openFunctionCommand(item.id),
      contextValue: 'goCallchain.function.changed',
    });
    treeItem.iconPath = new vscode.ThemeIcon('git-commit');
    return treeItem;
  }

  private isChangedFunction(functionID: string): boolean {
    return this.state.impact?.changed_functions.some((item) => item.id === functionID) ?? false;
  }
}

function openFunctionCommand(functionID: string, functionCandidates?: string[]): vscode.Command {
  return {
    title: 'Open Function',
    command: 'goCallchain.openFunction',
    arguments: functionCandidates ? [{ functionID, functionCandidates }] : [functionID],
  };
}
