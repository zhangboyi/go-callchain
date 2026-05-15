export type SourceType = 'local' | 'git' | 'managed';
export type RepoSourceType = 'local' | 'git';
export type AnalyzeMode = 'fast' | 'accurate';

export interface RepoSource {
  type: RepoSourceType;
  path?: string;
  url?: string;
  ref?: string;
}

export interface ManagedRepository {
  id: string;
  name: string;
  url: string;
  default_ref?: string;
  last_sync_at?: string;
  last_sync_error?: string;
}

export interface RepositoryRef {
  name: string;
  type: 'branch' | 'tag';
  commit?: string;
}

export interface RepositorySyncResponse {
  status: string;
  repository: ManagedRepository;
  refs: RepositoryRef[];
}

export interface AnalyzeResponse {
  task_id: string;
  status: string;
}

export interface TaskStatusResponse {
  task_id: string;
  status: string;
  phase?: string;
  progress?: number;
  workspace?: string;
  commit?: string;
  functions?: number;
  edges?: number;
  routes?: number;
  error?: string;
  cache_hit?: boolean;
  mode?: AnalyzeMode;
  started_at?: string;
  finished_at?: string;
}

export interface Route {
  method: string;
  path: string;
  handler: string;
  file: string;
  line: number;
}

export interface Edge {
  caller: string;
  callee: string;
  file: string;
  line: number;
  source: string;
  confidence: string;
}

export interface CallTreeNode {
  function: string;
  edge?: Edge;
  children?: CallTreeNode[];
}

export interface InterfaceCallchainResponse {
  route: Route;
  tree: CallTreeNode;
}

export interface GoFunction {
  id: string;
  name: string;
  package: string;
  receiver?: string;
  file: string;
  start_line: number;
  end_line: number;
}

export interface FunctionCallchainResponse {
  function: string;
  tree: CallTreeNode;
}

export interface FunctionDetail {
  function: GoFunction;
  incoming_edges: Edge[];
  outgoing_edges: Edge[];
}

export type FileTreeNodeType = 'directory' | 'file' | 'function';

export interface FileTreeNode {
  key: string;
  type: FileTreeNodeType;
  name: string;
  path?: string;
  function_id?: string;
  start_line?: number;
  end_line?: number;
  children?: FileTreeNode[];
}

export interface FileContentResponse {
  path: string;
  content: string;
}

export interface ChangedFunction {
  id: string;
  file: string;
  start_line: number;
  end_line: number;
}

export interface ImpactedInterface {
  method: string;
  path: string;
  handler: string;
  changed_function: string;
  chain: string[];
  risk: string;
}

export interface MRImpactResponse {
  task_id?: string;
  changed_functions: ChangedFunction[];
  impacted_interfaces: ImpactedInterface[];
}
