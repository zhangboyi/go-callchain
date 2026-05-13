import * as path from 'path';
import * as vscode from 'vscode';
import { findFunctionByIdentity } from './functionIdentity';
import type {
  CallTreeNode,
  FunctionCallchainResponse,
  GoFunction,
  InterfaceCallchainResponse,
  MRImpactResponse,
  Route,
  TaskStatusResponse,
} from './types';

export class ExtensionState {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  workspacePath = '';
  task?: TaskStatusResponse;
  functions: GoFunction[] = [];
  routes: Route[] = [];
  impact?: MRImpactResponse;
  interfaceCallchain?: InterfaceCallchainResponse;
  functionCallchain?: FunctionCallchainResponse;
  status = '未分析';

  get taskID(): string | undefined {
    return this.task?.task_id;
  }

  updateWorkspace(workspacePath: string): void {
    this.workspacePath = workspacePath;
    this.fire();
  }

  updateTask(task: TaskStatusResponse): void {
    this.task = task;
    this.status = task.status;
    this.fire();
  }

  updateFunctions(functions: GoFunction[]): void {
    this.functions = functions;
    this.fire();
  }

  updateRoutes(routes: Route[]): void {
    this.routes = routes;
    this.fire();
  }

  updateImpact(impact: MRImpactResponse): void {
    this.impact = impact;
    this.fire();
  }

  updateInterfaceCallchain(callchain: InterfaceCallchainResponse): void {
    this.interfaceCallchain = callchain;
    this.functionCallchain = {
      function: callchain.tree.function || callchain.route.handler,
      tree: callchain.tree,
    };
    this.fire();
  }

  updateFunctionCallchain(callchain: FunctionCallchainResponse): void {
    this.functionCallchain = callchain;
    this.fire();
  }

  functionByID(functionID: string): GoFunction | undefined {
    return findFunctionByIdentity(this.functions, functionID);
  }

  functionPath(functionID: string): string | undefined {
    const fn = this.functionByID(functionID);
    if (!fn || !this.workspacePath) {
      return undefined;
    }
    return path.isAbsolute(fn.file) ? fn.file : path.join(this.workspacePath, fn.file);
  }

  findFunctionAtLocation(fsPath: string, line: number): GoFunction | undefined {
    const normalized = normalizePath(fsPath);
    return this.functions.find((fn) => {
      const filePath = path.isAbsolute(fn.file) ? fn.file : path.join(this.workspacePath, fn.file);
      if (normalizePath(filePath) !== normalized) {
        return false;
      }
      return line >= fn.start_line && line <= fn.end_line;
    });
  }

  walkCallchain(node: CallTreeNode | undefined, visit: (node: CallTreeNode) => void): void {
    if (!node) {
      return;
    }
    visit(node);
    for (const child of node.children ?? []) {
      this.walkCallchain(child, visit);
    }
  }

  private fire(): void {
    this.changeEmitter.fire();
  }
}

function normalizePath(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, '/');
}
