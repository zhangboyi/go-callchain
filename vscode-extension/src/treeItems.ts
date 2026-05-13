import * as vscode from 'vscode';
import type { FunctionCallchainResponse } from './types';

export class FunctionTreeItem extends vscode.TreeItem {
  readonly functionID?: string;
  readonly functionCandidates?: string[];
  readonly callchain?: FunctionCallchainResponse;

  constructor(options: {
    label: string;
    description?: string;
    tooltip?: string;
    functionID?: string;
    functionCandidates?: string[];
    callchain?: FunctionCallchainResponse;
    collapsibleState?: vscode.TreeItemCollapsibleState;
    command?: vscode.Command;
    contextValue?: string;
  }) {
    super(options.label, options.collapsibleState ?? vscode.TreeItemCollapsibleState.None);
    this.description = options.description;
    this.tooltip = options.tooltip;
    this.functionID = options.functionID;
    this.functionCandidates = options.functionCandidates;
    this.callchain = options.callchain;
    if (options.functionID) {
      this.resourceUri = vscode.Uri.from({
        scheme: 'go-callchain-function',
        path: `/${encodeURIComponent(options.functionID)}`,
      });
    }
    this.command = options.command;
    this.contextValue = contextValueWithFunction(options.contextValue, options.functionID);
  }
}

function contextValueWithFunction(contextValue?: string, functionID?: string): string | undefined {
  if (!contextValue || !functionID) {
    return contextValue;
  }
  return `${contextValue}|go-callchain-function:${encodeURIComponent(functionID)}`;
}

export function shortFunctionName(functionID: string): string {
  const receiverMatch = functionID.match(/\.\(([^)]+)\)\.([^.]+)$/);
  if (receiverMatch) {
    return `${receiverMatch[1]}.${receiverMatch[2]}`;
  }
  const parts = functionID.split(/[/.]/).filter(Boolean);
  return parts.slice(-2).join('.') || functionID;
}
