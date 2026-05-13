import type {
  AnalyzeResponse,
  FileContentResponse,
  FileTreeNode,
  FunctionCallchainResponse,
  FunctionDetail,
  GoFunction,
  InterfaceCallchainResponse,
  ManagedRepository,
  MRImpactResponse,
  RepoSource,
  RepositoryRef,
  RepositorySyncResponse,
  Route,
  TaskStatusResponse,
  AnalyzeMode,
} from '../types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    throw new Error(data?.error ?? response.statusText);
  }
  return data as T;
}

export function analyze(source: RepoSource, force: boolean, mode: AnalyzeMode): Promise<AnalyzeResponse> {
  return request<AnalyzeResponse>('/api/v1/analyze', {
    method: 'POST',
    body: JSON.stringify({ source, force, mode }),
  });
}

export async function listRepositories(): Promise<ManagedRepository[]> {
  const data = await request<{ repositories: ManagedRepository[] }>('/api/v1/repositories');
  return data.repositories ?? [];
}

export function saveRepository(payload: {
  id?: string;
  name: string;
  url: string;
  default_ref?: string;
}): Promise<ManagedRepository> {
  return request<ManagedRepository>('/api/v1/repositories', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function deleteRepository(repoID: string): Promise<void> {
  return request<void>(`/api/v1/repositories/${encodeURIComponent(repoID)}`, {
    method: 'DELETE',
  });
}

export async function listRepositoryRefs(repoID: string): Promise<RepositoryRef[]> {
  const data = await request<{ refs: RepositoryRef[] }>(`/api/v1/repositories/${encodeURIComponent(repoID)}/refs`);
  return data.refs ?? [];
}

export function syncRepository(repoID: string): Promise<RepositorySyncResponse> {
  return request<RepositorySyncResponse>(`/api/v1/repositories/${encodeURIComponent(repoID)}/sync`, {
    method: 'POST',
  });
}

export function getTask(taskID: string): Promise<TaskStatusResponse> {
  return request<TaskStatusResponse>(`/api/v1/analyze/${taskID}`);
}

export async function getRoutes(taskID: string): Promise<Route[]> {
  const data = await request<{ routes: Route[] }>(`/api/v1/routes?task_id=${encodeURIComponent(taskID)}`);
  return data.routes ?? [];
}

export function getInterfaceCallchain(
  taskID: string,
  method: string,
  path: string,
): Promise<InterfaceCallchainResponse> {
  return request<InterfaceCallchainResponse>('/api/v1/callchain/interface', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskID, method, path, depth: 8 }),
  });
}

export function getFunctionCallchain(
  taskID: string,
  functionID: string,
  depth = 8,
): Promise<FunctionCallchainResponse> {
  return request<FunctionCallchainResponse>('/api/v1/callchain/function', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskID, function: functionID, depth }),
  });
}

export async function getFunctions(taskID: string): Promise<GoFunction[]> {
  const data = await request<{ functions: GoFunction[] }>(`/api/v1/functions?task_id=${encodeURIComponent(taskID)}`);
  return data.functions ?? [];
}

export function getFunctionDetail(taskID: string, functionID: string): Promise<FunctionDetail> {
  return request<FunctionDetail>(
    `/api/v1/functions/detail?task_id=${encodeURIComponent(taskID)}&id=${encodeURIComponent(functionID)}`,
  );
}

export async function getFileTree(taskID: string): Promise<FileTreeNode> {
  const data = await request<{ tree: FileTreeNode }>(`/api/v1/files/tree?task_id=${encodeURIComponent(taskID)}`);
  return data.tree;
}

export function getFileContent(taskID: string, path: string): Promise<FileContentResponse> {
  return request<FileContentResponse>(
    `/api/v1/files/content?task_id=${encodeURIComponent(taskID)}&path=${encodeURIComponent(path)}`,
  );
}

export function getMRImpact(
  source: RepoSource,
  base: string,
  head: string,
  mode: AnalyzeMode,
  depth = 8,
): Promise<MRImpactResponse> {
  return request<MRImpactResponse>('/api/v1/impact/mr', {
    method: 'POST',
    body: JSON.stringify({ source, base, head, mode, depth }),
  });
}
