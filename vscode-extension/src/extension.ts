import * as path from 'path';
import * as vscode from 'vscode';
import { GoFunctionCodeLensProvider } from './codeLens';
import { extractFunctionCallchain, extractFunctionID, extractFunctionIDs } from './commandArgs';
import { getConfig } from './config';
import { sourceOpenIntent } from './editorOpenOptions';
import { findChangedFunctionByIdentity } from './functionIdentity';
import { currentBranch, listBranches } from './git';
import { FunctionCallchainTreeProvider } from './functionTree';
import { CallchainGraphPanel } from './graphPanel';
import { impactInterfaceCallchain } from './impactCallchain';
import { ImpactTreeProvider } from './impactTree';
import { InterfaceCallchainTreeProvider } from './interfaceTree';
import { moreActionsForView, type MoreActionsView } from './moreActions';
import { ServiceClient } from './serviceClient';
import { ServiceRuntime } from './serviceRuntime';
import { ExtensionState } from './state';
import { TreeCommandTarget } from './treeCommandTarget';
import { shortFunctionName } from './treeItems';
import type { GoFunction, ImpactedInterface, Route } from './types';
import { resolveGoWorkspacePath, resolveSelectedGoWorkspaceCandidates } from './workspaceResolver';

let state: ExtensionState;
let runtime: ServiceRuntime;
let output: vscode.OutputChannel;
let codeLensProvider: GoFunctionCodeLensProvider;
let extensionContext: vscode.ExtensionContext;
let graphPanel: CallchainGraphPanel;
let treeCommandTarget: TreeCommandTarget;

const analysisDirectoryKey = 'goCallchain.analysisDirectory';

export function activate(context: vscode.ExtensionContext): void {
  extensionContext = context;
  output = vscode.window.createOutputChannel('Go Callchain');
  state = new ExtensionState();
  runtime = new ServiceRuntime(context, output);
  graphPanel = new CallchainGraphPanel();
  treeCommandTarget = new TreeCommandTarget();

  const impactProvider = new ImpactTreeProvider(state);
  const interfaceCallchainProvider = new InterfaceCallchainTreeProvider(state);
  const callchainProvider = new FunctionCallchainTreeProvider(state);
  codeLensProvider = new GoFunctionCodeLensProvider();
  const impactTreeView = vscode.window.createTreeView('goCallchain.impactView', { treeDataProvider: impactProvider });
  const interfaceTreeView = vscode.window.createTreeView('goCallchain.interfaceCallchainView', { treeDataProvider: interfaceCallchainProvider });
  const functionTreeView = vscode.window.createTreeView('goCallchain.functionCallchainView', { treeDataProvider: callchainProvider });

  context.subscriptions.push(
    output,
    impactTreeView,
    interfaceTreeView,
    functionTreeView,
    impactTreeView.onDidChangeSelection((event) => treeCommandTarget.rememberSelection(event.selection)),
    interfaceTreeView.onDidChangeSelection((event) => treeCommandTarget.rememberSelection(event.selection)),
    functionTreeView.onDidChangeSelection((event) => treeCommandTarget.rememberSelection(event.selection)),
    vscode.languages.registerCodeLensProvider({ scheme: 'file', language: 'go' }, codeLensProvider),
    registerCommand('goCallchain.analyzeWorkspace', () => analyzeWorkspace(true)),
    registerCommand('goCallchain.selectAnalysisDirectory', selectAnalysisDirectory),
    registerCommand('goCallchain.clearAnalysisDirectory', clearAnalysisDirectory),
    registerCommand('goCallchain.analyzeLocalBranchImpact', analyzeLocalBranchImpact),
    registerCommand('goCallchain.showInterfaceCallchain', showInterfaceCallchain),
    registerCommand('goCallchain.showInterfaceCallchainFromRoute', (...args) => showInterfaceCallchainFromRoute(treeCommandTarget.resolve(args))),
    registerCommand('goCallchain.showInterfaceCallchainFromImpact', (...args) => showInterfaceCallchainFromImpact(treeCommandTarget.resolve(args))),
    registerCommand('goCallchain.showFunctionCallchain', showFunctionCallchain),
    registerCommand('goCallchain.showCallchainGraph', showCallchainGraph),
    registerCommand('goCallchain.showSelectedCallchainGraph', (...args) => showCallchainGraph(treeCommandTarget.resolve(args))),
    registerCommand('goCallchain.restartService', () => restartService(context)),
    registerCommand('goCallchain.refresh', refresh),
    registerCommand('goCallchain.moreInterfaceActions', () => moreActions('interface')),
    registerCommand('goCallchain.moreImpactActions', () => moreActions('impact')),
    registerCommand('goCallchain.moreFunctionActions', () => moreActions('function')),
    registerCommand('goCallchain.openFunction', (...args) => openFunction(treeCommandTarget.resolve(args))),
    registerCommand('goCallchain.showTreeFunctionCallchain', (...args) => showTreeFunctionCallchain(treeCommandTarget.resolve(args))),
    registerCommand('goCallchain.showFunctionCallchainAtLocation', showFunctionCallchainAtLocation),
    registerCommand('goCallchain.showFunctionImpactAtLocation', showFunctionImpactAtLocation),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('goCallchain')) {
        codeLensProvider.refresh();
      }
    }),
  );
}

export function deactivate(): void {
  graphPanel?.dispose();
  runtime?.stop();
}

function registerCommand(command: string, callback: (...args: unknown[]) => Promise<void> | void): vscode.Disposable {
  return vscode.commands.registerCommand(command, async (...args: unknown[]) => {
    try {
      await callback(...args);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      output.appendLine(`[error] ${message}`);
      void vscode.window.showErrorMessage(message);
    }
  });
}

async function analyzeWorkspace(force: boolean): Promise<void> {
  const workspacePath = getGoWorkspacePath();
  const config = getConfig();
  const client = new ServiceClient(config.serviceUrl);
  state.updateWorkspace(workspacePath);
  await runtime.ensure(client, config, workspacePath);

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'Go Callchain: analyzing workspace',
      cancellable: true,
    },
    async (progress, token) => {
      const resp = await client.analyzeWorkspace(workspacePath, config.mode, force);
      progress.report({ message: resp.status });
      const task = await client.waitForTask(
        resp.task_id,
        (status) => {
          state.updateTask(status);
          progress.report({ message: taskMessage(status) });
        },
        () => token.isCancellationRequested,
      );
      state.updateTask(task);
      state.updateWorkspace(task.workspace || workspacePath);
      const [functions, routes] = await Promise.all([
        client.listFunctions(task.task_id),
        client.listRoutes(task.task_id),
      ]);
      state.updateFunctions(functions);
      state.updateRoutes(routes);
    },
  );
  codeLensProvider.refresh();
  void vscode.commands.executeCommand('workbench.view.extension.goCallchain');
  void vscode.window.showInformationMessage(`Go Callchain analyzed: ${state.functions.length} functions, ${state.routes.length} routes`);
}

async function ensureAnalyzed(force: boolean): Promise<void> {
  const workspacePath = getGoWorkspacePath();
  if (!force && state.workspacePath === workspacePath && state.task?.status === 'done' && state.functions.length > 0) {
    return;
  }
  await analyzeWorkspace(force);
}

async function analyzeLocalBranchImpact(): Promise<void> {
  const workspacePath = getGoWorkspacePath();
  const config = getConfig();
  const client = new ServiceClient(config.serviceUrl);
  state.updateWorkspace(workspacePath);
  await runtime.ensure(client, config, workspacePath);

  const branches = await listBranches(workspacePath);
  const current = await currentBranch(workspacePath).catch(() => '');
  const preferredBase = preferredBranch(config.defaultBase, branches);
  const base = await pickRef('Select base ref', branches, preferredBase);
  if (!base) {
    return;
  }
  const head = await pickRef('Select head ref', branches, current || branches[0] || '');
  if (!head) {
    return;
  }
  if (current && current !== head) {
    void vscode.window.showWarningMessage(`当前 checkout 是 ${current}，影响面按 ${head} 分析；源码跳转会打开当前工作区文件。`);
  }
  output.appendLine(`[impact] source Go module: ${workspacePath}`);
  output.appendLine(`[impact] range: ${base}...${head}`);

  const impact = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Go Callchain: impact ${base}...${head}`,
      cancellable: false,
    },
    async () => client.mrImpact({ type: 'local', path: workspacePath }, base, head, config.mode, config.defaultDepth),
  );
  state.updateImpact(impact);
  await ensureAnalyzed(true).catch((error) => output.appendLine(`[warn] analyze after impact failed: ${String(error)}`));
  void vscode.commands.executeCommand('workbench.view.extension.goCallchain');
  void vscode.window.showInformationMessage(
    `Impact done: ${impact.changed_functions.length} changed functions, ${impact.impacted_interfaces.length} impacted interfaces`,
  );
}

async function showFunctionCallchain(): Promise<void> {
  await ensureAnalyzed(false);
  const fn = await pickFunction('Select function');
  if (!fn) {
    return;
  }
  await showFunctionCallchainByID(fn.id);
}

async function showInterfaceCallchain(): Promise<void> {
  await ensureAnalyzed(false);
  const route = await pickRoute('Select interface');
  if (!route) {
    return;
  }
  await showInterfaceCallchainByRoute(route);
}

async function showInterfaceCallchainFromRoute(arg: unknown): Promise<void> {
  const route = extractRouteArg(arg);
  if (!route) {
    throw new Error('interface route not found');
  }
  await showInterfaceCallchainByRoute(route);
}

async function showInterfaceCallchainFromImpact(arg: unknown): Promise<void> {
  const impact = extractImpactArg(arg);
  if (!impact) {
    throw new Error('impacted interface not found');
  }
  await ensureAnalyzed(false);
  const route = state.routes.find((item) => item.method === impact.method && item.path === impact.path) ?? {
    method: impact.method,
    path: impact.path,
    handler: impact.handler,
    file: '',
    line: 0,
  };
  await showInterfaceCallchainByRoute(route, impact);
}

async function showCallchainGraph(arg?: unknown): Promise<void> {
  const callchain = extractFunctionCallchain(arg);
  const functionID = callchain?.function || extractFunctionID(arg);
  if (functionID) {
    await revealFunctionSource([functionID], {
      preview: true,
      preserveFocus: true,
      ignoreMissing: true,
    });
    treeCommandTarget.rememberOpenedTarget(arg);
  }
  if (callchain) {
    state.updateFunctionCallchain(callchain);
  } else {
    if (functionID) {
      await showFunctionCallchainByID(functionID);
    }
  }
  if (!state.functionCallchain) {
    await showFunctionCallchain();
  }
  if (!state.functionCallchain) {
    return;
  }
  graphPanel.show(extensionContext, state.functionCallchain, state.functions, state.impact?.changed_functions ?? []);
}

async function showInterfaceCallchainByRoute(route: Route, fallbackImpact?: ImpactedInterface): Promise<void> {
  await ensureAnalyzed(false);
  const taskID = state.taskID;
  if (!taskID) {
    throw new Error('workspace is not analyzed');
  }
  const config = getConfig();
  const client = new ServiceClient(config.serviceUrl);
  await runtime.ensure(client, config, getGoWorkspacePath());
  try {
    const response = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Go Callchain: ${route.method} ${route.path}`,
        cancellable: false,
      },
      async () => client.interfaceCallchain(taskID, route.method, route.path, config.defaultDepth),
    );
    state.updateInterfaceCallchain(response);
  } catch (error) {
    if (!fallbackImpact) {
      throw error;
    }
    const fallback = impactInterfaceCallchain(fallbackImpact);
    state.updateInterfaceCallchain({
      route,
      tree: fallback.tree,
    });
  }
  void vscode.commands.executeCommand('workbench.view.extension.goCallchain');
}

async function showFunctionCallchainAtLocation(filePath: unknown, line: unknown): Promise<void> {
  await ensureAnalyzed(false);
  const fn = functionAtLocation(filePath, line);
  if (!fn) {
    return;
  }
  await showFunctionCallchainByID(fn.id);
}

async function showFunctionImpactAtLocation(filePath: unknown, line: unknown): Promise<void> {
  await ensureAnalyzed(false);
  const fn = functionAtLocation(filePath, line);
  if (!fn) {
    return;
  }
  if (!state.impact) {
    await analyzeLocalBranchImpact();
    if (!state.impact) {
      return;
    }
  }
  const matches = impactedByFunction(fn.id);
  if (matches.length === 0) {
    void vscode.window.showInformationMessage(`No impacted interfaces found for ${shortFunctionName(fn.id)}`);
    return;
  }
  const selected = await vscode.window.showQuickPick(
    matches.map((item) => ({
      label: `${item.method} ${item.path}`,
      description: item.risk,
      detail: item.chain.join(' -> '),
      item,
    })),
    { title: `Impacted interfaces for ${shortFunctionName(fn.id)}`, matchOnDetail: true },
  );
  if (selected) {
    state.updateFunctionCallchain(impactInterfaceCallchain(selected.item));
    void vscode.commands.executeCommand('workbench.view.extension.goCallchain');
  }
}

async function showTreeFunctionCallchain(arg: unknown): Promise<void> {
  const callchain = extractFunctionCallchain(arg);
  if (callchain) {
    state.updateFunctionCallchain(callchain);
    void vscode.commands.executeCommand('workbench.view.extension.goCallchain');
    return;
  }
  const functionID = extractFunctionID(arg);
  if (!functionID) {
    throw new Error('function id not found');
  }
  await showFunctionCallchainByID(functionID);
}

async function showFunctionCallchainByID(functionID: string): Promise<void> {
  await ensureAnalyzed(false);
  const taskID = state.taskID;
  if (!taskID) {
    throw new Error('workspace is not analyzed');
  }
  const config = getConfig();
  const client = new ServiceClient(config.serviceUrl);
  await runtime.ensure(client, config, getGoWorkspacePath());
  const response = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Go Callchain: ${shortFunctionName(functionID)}`,
      cancellable: false,
    },
    async () => client.functionCallchain(taskID, functionID, config.defaultDepth),
  );
  state.updateFunctionCallchain(response);
  void vscode.commands.executeCommand('workbench.view.extension.goCallchain');
}

async function openFunction(arg: unknown): Promise<void> {
  treeCommandTarget.rememberOpenedTarget(arg);
  const functionIDs = extractFunctionIDs(arg);
  if (functionIDs.length === 0) {
    throw new Error('function id not found');
  }
  await revealFunctionSource(functionIDs);
}

async function revealFunctionSource(
  functionIDs: string[],
  options: { preview?: boolean; preserveFocus?: boolean; ignoreMissing?: boolean } = {},
): Promise<void> {
  const location = resolveFirstFunctionLocation(functionIDs);
  if (!location) {
    if (options.ignoreMissing) {
      return;
    }
    throw new Error(`function location not found: ${functionIDs[0]}`);
  }
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(location.file));
  const intent = sourceOpenIntent(vscode.window.visibleTextEditors);
  const editor = await vscode.window.showTextDocument(document, {
    viewColumn: intent.viewColumn === 'beside' ? vscode.ViewColumn.Beside : intent.viewColumn,
    preview: options.preview ?? intent.preview,
    preserveFocus: options.preserveFocus ?? intent.preserveFocus,
  });
  const line = Math.max(0, location.line - 1);
  const range = new vscode.Range(line, 0, line, 0);
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

function resolveFirstFunctionLocation(functionIDs: string[]): { file: string; line: number } | undefined {
  for (const functionID of functionIDs) {
    const location = resolveFunctionLocation(functionID);
    if (location) {
      return location;
    }
  }
  return undefined;
}

async function restartService(context: vscode.ExtensionContext): Promise<void> {
  const workspacePath = getGoWorkspacePath();
  const config = getConfig();
  runtime.restart(config, workspacePath);
  const client = new ServiceClient(config.serviceUrl);
  await runtime.ensure(client, config, workspacePath);
  void vscode.window.showInformationMessage('go-callchain-service restarted');
  await context.globalState.update('goCallchain.lastRestartAt', new Date().toISOString());
}

async function selectAnalysisDirectory(): Promise<void> {
  const root = getWorkspaceRoot();
  const selected = await vscode.window.showOpenDialog({
    title: 'Select Go repository directory',
    defaultUri: vscode.Uri.file(root),
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: 'Use Directory',
  });
  const folder = selected?.[0]?.fsPath;
  if (!folder) {
    return;
  }
  const resolved = await resolveSelectedAnalysisDirectory(root, folder);
  if (!resolved) {
    throw new Error(`selected directory does not contain go.mod: ${folder}`);
  }
  await extensionContext.workspaceState.update(analysisDirectoryKey, resolved);
  state.updateWorkspace(resolved);
  void vscode.window.showInformationMessage(`Go Callchain analysis directory: ${resolved}`);
  await analyzeWorkspace(true);
}

async function resolveSelectedAnalysisDirectory(root: string, folder: string): Promise<string | undefined> {
  const modules = resolveSelectedGoWorkspaceCandidates(folder);
  if (modules.length <= 1) {
    return modules[0];
  }
  const picked = await vscode.window.showQuickPick(
    modules.map((modulePath) => ({
      label: path.relative(root, modulePath) || path.basename(modulePath),
      description: modulePath,
      modulePath,
    })),
    {
      title: 'Select Go module',
      placeHolder: 'Selected directory contains multiple go.mod files',
      matchOnDescription: true,
    },
  );
  return picked?.modulePath;
}

async function clearAnalysisDirectory(): Promise<void> {
  await extensionContext.workspaceState.update(analysisDirectoryKey, undefined);
  void vscode.window.showInformationMessage('Go Callchain analysis directory cleared');
}

async function moreActions(view: MoreActionsView): Promise<void> {
  const selected = await vscode.window.showQuickPick(
    moreActionsForView(view),
    { title: 'Go Callchain 更多操作' },
  );
  if (selected) {
    await vscode.commands.executeCommand(selected.command);
  }
}

async function refresh(): Promise<void> {
  if (state.task?.status === 'done') {
    await ensureAnalyzed(true);
    return;
  }
  await analyzeWorkspace(true);
}

function getWorkspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    throw new Error('open a Go workspace first');
  }
  return folder.uri.fsPath;
}

function getGoWorkspacePath(): string {
  const root = getWorkspaceRoot();
  const config = getConfig();
  const explicitDirectory = extensionContext.workspaceState.get<string>(analysisDirectoryKey) || config.repositoryPath;
  const activeFile = vscode.window.activeTextEditor?.document.uri.scheme === 'file'
    ? vscode.window.activeTextEditor.document.uri.fsPath
    : undefined;
  const resolved = resolveGoWorkspacePath(root, activeFile, explicitDirectory);
  if (!resolved) {
    throw new Error(`local source must contain go.mod: ${explicitDirectory || root}`);
  }
  if (explicitDirectory) {
    output.appendLine(`[workspace] selected Go module: ${resolved}`);
    return resolved;
  }
  if (resolved !== root) {
    output.appendLine(`[workspace] resolved Go module: ${resolved}`);
  }
  return resolved;
}

async function pickRef(title: string, branches: string[], preferred: string): Promise<string | undefined> {
  const values = Array.from(new Set([preferred, ...branches].filter(Boolean)));
  const custom = '$(edit) Enter custom ref';
  const picked = await vscode.window.showQuickPick(
    [...values.map((value) => ({ label: value })), { label: custom }],
    { title, placeHolder: preferred },
  );
  if (!picked) {
    return undefined;
  }
  if (picked.label === custom) {
    return vscode.window.showInputBox({ title, prompt: 'Branch, tag, or commit', value: preferred });
  }
  return picked.label;
}

function preferredBranch(preferred: string, branches: string[]): string {
  if (!preferred || branches.includes(preferred)) {
    return preferred;
  }
  const remotePreferred = `origin/${preferred}`;
  return branches.includes(remotePreferred) ? remotePreferred : preferred;
}

async function pickFunction(title: string): Promise<GoFunction | undefined> {
  const selected = await vscode.window.showQuickPick(
    state.functions.map((fn) => ({
      label: shortFunctionName(fn.id),
      description: `${fn.file}:${fn.start_line}`,
      detail: fn.id,
      fn,
    })),
    { title, matchOnDescription: true, matchOnDetail: true },
  );
  return selected?.fn;
}

async function pickRoute(title: string): Promise<Route | undefined> {
  if (state.routes.length === 0) {
    void vscode.window.showInformationMessage('No routes found in current analysis');
    return undefined;
  }
  const selected = await vscode.window.showQuickPick(
    state.routes.map((route) => ({
      label: `${route.method} ${route.path}`,
      description: shortFunctionName(route.handler),
      detail: `${route.handler} ${route.file}:${route.line}`,
      route,
    })),
    { title, matchOnDescription: true, matchOnDetail: true },
  );
  return selected?.route;
}

function extractImpactArg(arg: unknown): ImpactedInterface | undefined {
  if (isImpactedInterface(arg)) {
    return arg;
  }
  if (arg && typeof arg === 'object' && 'item' in arg) {
    const item = (arg as { item?: unknown }).item;
    return isImpactedInterface(item) ? item : undefined;
  }
  return undefined;
}

function isImpactedInterface(value: unknown): value is ImpactedInterface {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as { method?: unknown; path?: unknown; handler?: unknown; changed_function?: unknown; chain?: unknown; risk?: unknown };
  return typeof item.method === 'string'
    && typeof item.path === 'string'
    && typeof item.handler === 'string'
    && typeof item.changed_function === 'string'
    && Array.isArray(item.chain)
    && item.chain.every((candidate) => typeof candidate === 'string')
    && typeof item.risk === 'string';
}

function extractRouteArg(arg: unknown): Route | undefined {
  if (isRoute(arg)) {
    return arg;
  }
  if (arg && typeof arg === 'object' && 'route' in arg) {
    const route = (arg as { route?: unknown }).route;
    return isRoute(route) ? route : undefined;
  }
  return undefined;
}

function isRoute(value: unknown): value is Route {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const route = value as { method?: unknown; path?: unknown; handler?: unknown; file?: unknown; line?: unknown };
  return typeof route.method === 'string'
    && typeof route.path === 'string'
    && typeof route.handler === 'string'
    && typeof route.file === 'string'
    && typeof route.line === 'number';
}

function functionAtLocation(filePath: unknown, line: unknown): GoFunction | undefined {
  if (typeof filePath !== 'string' || typeof line !== 'number') {
    void vscode.window.showErrorMessage('invalid function location');
    return undefined;
  }
  const fn = state.findFunctionAtLocation(filePath, line);
  if (!fn) {
    void vscode.window.showErrorMessage(`function not found at ${filePath}:${line}`);
  }
  return fn;
}

function resolveFunctionLocation(functionID: string): { file: string; line: number } | undefined {
  const fn = state.functionByID(functionID);
  if (fn) {
    const file = path.isAbsolute(fn.file) ? fn.file : path.join(state.workspacePath || getGoWorkspacePath(), fn.file);
    return { file, line: fn.start_line };
  }
  const changed = state.impact ? findChangedFunctionByIdentity(state.impact.changed_functions, functionID) : undefined;
  if (changed) {
    const file = path.isAbsolute(changed.file) ? changed.file : path.join(state.workspacePath || getGoWorkspacePath(), changed.file);
    return { file, line: changed.start_line };
  }
  return undefined;
}

function impactedByFunction(functionID: string): ImpactedInterface[] {
  return (state.impact?.impacted_interfaces ?? []).filter(
    (item) => item.changed_function === functionID || item.chain.includes(functionID),
  );
}

function taskMessage(status: { status: string; phase?: string; progress?: number }): string {
  const pieces = [status.status];
  if (status.phase) {
    pieces.push(status.phase);
  }
  if (status.progress !== undefined) {
    pieces.push(`${status.progress}%`);
  }
  return pieces.join(' ');
}
