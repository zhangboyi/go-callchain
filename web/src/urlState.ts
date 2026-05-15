import type { AnalyzeMode, SourceType } from './types';

export type URLAppTab = 'callchain' | 'impact' | 'code' | 'docs';

export interface URLState {
  tab?: URLAppTab;
  sourceType?: SourceType;
  mode?: AnalyzeMode;
  localPath?: string;
  gitURL?: string;
  gitRef?: string;
  repositoryID?: string;
  managedRef?: string;
  taskID?: string;
  impactBase?: string;
  impactHead?: string;
  impactRecordID?: string;
}

const tabs = new Set<URLAppTab>(['callchain', 'impact', 'code', 'docs']);
const sourceTypes = new Set<SourceType>(['local', 'git', 'managed']);
const analyzeModes = new Set<AnalyzeMode>(['fast', 'accurate']);

export function parseURLState(search: string): URLState | null {
  const rawSearch = search.startsWith('?') ? search.slice(1) : search;
  if (!rawSearch) {
    return null;
  }

  const params = new URLSearchParams(rawSearch);
  const state: URLState = {};
  const tab = params.get('tab');
  const sourceType = params.get('source');
  const mode = params.get('mode');

  if (isURLAppTab(tab)) {
    state.tab = tab;
  }
  if (isSourceType(sourceType)) {
    state.sourceType = sourceType;
  }
  if (isAnalyzeMode(mode)) {
    state.mode = mode;
  }

  setParsedValue(params, 'local_path', (value) => {
    state.localPath = value;
  });
  setParsedValue(params, 'git_url', (value) => {
    state.gitURL = value;
  });
  setParsedValue(params, 'git_ref', (value) => {
    state.gitRef = value;
  });
  setParsedValue(params, 'repo_id', (value) => {
    state.repositoryID = value;
  });
  setParsedValue(params, 'repo_ref', (value) => {
    state.managedRef = value;
  });
  setParsedValue(params, 'task_id', (value) => {
    state.taskID = value;
  });
  setParsedValue(params, 'impact_base', (value) => {
    state.impactBase = value;
  });
  setParsedValue(params, 'impact_head', (value) => {
    state.impactHead = value;
  });
  setParsedValue(params, 'impact_id', (value) => {
    state.impactRecordID = value;
  });

  return Object.keys(state).length > 0 ? state : null;
}

export function serializeURLState(state: URLState): string {
  const params = new URLSearchParams();

  setOptional(params, 'tab', state.tab);
  setOptional(params, 'source', state.sourceType);
  setOptional(params, 'mode', state.mode);

  switch (state.sourceType) {
    case 'local':
      setOptional(params, 'local_path', state.localPath);
      break;
    case 'git':
      setOptional(params, 'git_url', state.gitURL);
      setOptional(params, 'git_ref', state.gitRef);
      break;
    case 'managed':
      setOptional(params, 'repo_id', state.repositoryID);
      setOptional(params, 'repo_ref', state.managedRef);
      break;
    default:
      break;
  }

  setOptional(params, 'task_id', state.taskID);
  setOptional(params, 'impact_base', state.impactBase);
  setOptional(params, 'impact_head', state.impactHead);
  setOptional(params, 'impact_id', state.impactRecordID);

  return params.toString();
}

export function createImpactRecordID(state: URLState): string {
  const query = serializeURLState({
    ...state,
    taskID: undefined,
    impactRecordID: undefined,
  });
  return hashString(query);
}

function setParsedValue(params: URLSearchParams, key: string, apply: (value: string) => void) {
  const value = params.get(key);
  if (value !== null && value !== '') {
    apply(value);
  }
}

function setOptional(params: URLSearchParams, key: string, value?: string) {
  if (value !== undefined && value !== '') {
    params.set(key, value);
  }
}

function isURLAppTab(value: string | null): value is URLAppTab {
  return value !== null && tabs.has(value as URLAppTab);
}

function isSourceType(value: string | null): value is SourceType {
  return value !== null && sourceTypes.has(value as SourceType);
}

function isAnalyzeMode(value: string | null): value is AnalyzeMode {
  return value !== null && analyzeModes.has(value as AnalyzeMode);
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
