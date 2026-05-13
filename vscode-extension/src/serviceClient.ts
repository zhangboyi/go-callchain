import type {
  AnalyzeMode,
  AnalyzeResponse,
  FunctionCallchainResponse,
  FunctionDetail,
  GoFunction,
  InterfaceCallchainResponse,
  MRImpactResponse,
  RepoSource,
  Route,
  TaskStatusResponse,
} from './types';

export class ServiceClient {
  constructor(private readonly baseUrl: string) {}

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  analyzeWorkspace(workspacePath: string, mode: AnalyzeMode, force = false): Promise<AnalyzeResponse> {
    return this.request<AnalyzeResponse>('/api/v1/analyze', {
      method: 'POST',
      body: JSON.stringify({
        source: { type: 'local', path: workspacePath },
        mode,
        force,
      }),
    });
  }

  getTask(taskID: string): Promise<TaskStatusResponse> {
    return this.request<TaskStatusResponse>(`/api/v1/analyze/${encodeURIComponent(taskID)}`);
  }

  async waitForTask(
    taskID: string,
    onStatus?: (status: TaskStatusResponse) => void,
    isCancelled?: () => boolean,
  ): Promise<TaskStatusResponse> {
    for (;;) {
      if (isCancelled?.()) {
        throw new Error('analysis cancelled');
      }
      const status = await this.getTask(taskID);
      onStatus?.(status);
      if (status.status === 'done') {
        return status;
      }
      if (status.status === 'failed') {
        throw new Error(status.error || 'analysis failed');
      }
      await delay(800);
    }
  }

  async listFunctions(taskID: string): Promise<GoFunction[]> {
    const data = await this.request<{ functions: GoFunction[] }>(`/api/v1/functions?task_id=${encodeURIComponent(taskID)}`);
    return data.functions ?? [];
  }

  async listRoutes(taskID: string): Promise<Route[]> {
    const data = await this.request<{ routes: Route[] }>(`/api/v1/routes?task_id=${encodeURIComponent(taskID)}`);
    return data.routes ?? [];
  }

  interfaceCallchain(taskID: string, method: string, path: string, depth: number): Promise<InterfaceCallchainResponse> {
    return this.request<InterfaceCallchainResponse>('/api/v1/callchain/interface', {
      method: 'POST',
      body: JSON.stringify({ task_id: taskID, method, path, depth }),
    });
  }

  functionCallchain(taskID: string, functionID: string, depth: number): Promise<FunctionCallchainResponse> {
    return this.request<FunctionCallchainResponse>('/api/v1/callchain/function', {
      method: 'POST',
      body: JSON.stringify({ task_id: taskID, function: functionID, depth }),
    });
  }

  functionDetail(taskID: string, functionID: string): Promise<FunctionDetail> {
    return this.request<FunctionDetail>(
      `/api/v1/functions/detail?task_id=${encodeURIComponent(taskID)}&id=${encodeURIComponent(functionID)}`,
    );
  }

  mrImpact(source: RepoSource, base: string, head: string, mode: AnalyzeMode, depth: number): Promise<MRImpactResponse> {
    return this.request<MRImpactResponse>('/api/v1/impact/mr', {
      method: 'POST',
      body: JSON.stringify({ source, base, head, mode, depth }),
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
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
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
