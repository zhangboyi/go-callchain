import {
  ApiOutlined,
  BranchesOutlined,
  BookOutlined,
  CloudSyncOutlined,
  CodeOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  SaveOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { Alert, Button, Descriptions, Drawer, Empty, Input, Layout, Popconfirm, Progress, Segmented, Space, Table, Tag, Typography, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  analyze,
  deleteRepository,
  getFileContent,
  getFileTree,
  getFunctionCallchain,
  getFunctionDetail,
  getFunctions,
  getInterfaceCallchain,
  getMRImpact,
  getRoutes,
  getTask,
  listRepositories,
  listRepositoryRefs,
  saveRepository,
  syncRepository,
} from './api/client';
import { CallchainPanel } from './components/CallchainPanel';
import { CodeBrowser } from './components/CodeBrowser';
import { DocsPage } from './components/DocsPage';
import { ImpactPanel } from './components/ImpactPanel';
import { ObjectRail } from './components/ObjectRail';
import { chainToCallTree } from './graph/callchainGraph';
import { sourceFromSelection } from './repositorySource';
import type {
  CallTreeNode,
  AnalyzeMode,
  FileContentResponse,
  FileTreeNode,
  FunctionDetail,
  GoFunction,
  ImpactedInterface,
  InterfaceCallchainResponse,
  ManagedRepository,
  MRImpactResponse,
  RepositoryRef,
  Route,
  SourceType,
  TaskStatusResponse,
} from './types';

const defaultLocalPath = '/Users/boyi.zhang/Work/BizProjects/TCM/TCM-BE';
type AppTab = 'callchain' | 'impact' | 'code' | 'docs';
type DetailTab = 'routes' | 'functions' | 'raw';

const workspaceTabs: Array<{ key: AppTab; label: string; icon: ReactNode }> = [
  { key: 'callchain', label: 'Call Chain', icon: <ApiOutlined /> },
  { key: 'impact', label: 'MR Impact', icon: <BranchesOutlined /> },
  { key: 'code', label: 'Code', icon: <CodeOutlined /> },
  { key: 'docs', label: 'Docs', icon: <BookOutlined /> },
];

const detailTabs: Array<{ key: DetailTab; label: string }> = [
  { key: 'routes', label: 'Routes' },
  { key: 'functions', label: 'Functions' },
  { key: 'raw', label: 'Raw Graph' },
];

function App() {
  const [sourceType, setSourceType] = useState<SourceType>('local');
  const [appTab, setAppTab] = useState<AppTab>('callchain');
  const [analyzeMode, setAnalyzeMode] = useState<AnalyzeMode>('fast');
  const [localPath, setLocalPath] = useState(defaultLocalPath);
  const [gitURL, setGitURL] = useState('');
  const [gitRef, setGitRef] = useState('');
  const [repositories, setRepositories] = useState<ManagedRepository[]>([]);
  const [repositoryRefs, setRepositoryRefs] = useState<RepositoryRef[]>([]);
  const [selectedRepositoryID, setSelectedRepositoryID] = useState('');
  const [managedRef, setManagedRef] = useState('');
  const [repositoryDrawerOpen, setRepositoryDrawerOpen] = useState(false);
  const [repoNameInput, setRepoNameInput] = useState('');
  const [repoURLInput, setRepoURLInput] = useState('');
  const [repoDefaultRefInput, setRepoDefaultRefInput] = useState('');
  const [task, setTask] = useState<TaskStatusResponse | null>(null);
  const [routes, setRoutes] = useState<Route[]>([]);
  const [functions, setFunctions] = useState<GoFunction[]>([]);
  const [fileTree, setFileTree] = useState<FileTreeNode | null>(null);
  const [fileContent, setFileContent] = useState<FileContentResponse | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [functionInput, setFunctionInput] = useState('');
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [callchain, setCallchain] = useState<InterfaceCallchainResponse | { function: string; tree: CallTreeNode } | null>(null);
  const [impact, setImpact] = useState<MRImpactResponse | null>(null);
  const [selectedImpactedInterface, setSelectedImpactedInterface] = useState<ImpactedInterface | null>(null);
  const [impactBase, setImpactBase] = useState('master');
  const [impactHead, setImpactHead] = useState('HEAD');
  const [functionDetail, setFunctionDetail] = useState<FunctionDetail | null>(null);
  const [objectFilter, setObjectFilter] = useState('');
  const [functionFilter, setFunctionFilter] = useState('');
  const [detailTab, setDetailTab] = useState<DetailTab>('routes');
  const [functionDrawerOpen, setFunctionDrawerOpen] = useState(false);
  const [callchainDrawerOpen, setCallchainDrawerOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [rawPayload, setRawPayload] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [impactLoading, setImpactLoading] = useState(false);
  const [repositoryLoading, setRepositoryLoading] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedRepository = useMemo(
    () => repositories.find((repo) => repo.id === selectedRepositoryID) ?? null,
    [repositories, selectedRepositoryID],
  );
  const source = sourceFromSelection(sourceType, localPath, gitURL, gitRef, selectedRepository, managedRef);
  const changedFunctionIDs = useMemo(() => impact?.changed_functions.map((fn) => fn.id) ?? [], [impact]);
  const repositoryRefOptions = useMemo(
    () =>
      repositoryRefs.map((ref) => ({
        value: ref.name,
        label: `${ref.name}${ref.type === 'tag' ? ' (tag)' : ''}`,
      })),
    [repositoryRefs],
  );

  useEffect(() => {
    void loadManagedRepositories();
  }, []);

  useEffect(() => {
    if (sourceType !== 'managed' || !selectedRepositoryID) {
      return;
    }
    void loadRepositoryRefsFor(selectedRepositoryID);
  }, [sourceType, selectedRepositoryID]);

  useEffect(() => {
    if (!selectedRepository || managedRef) {
      return;
    }
    setManagedRef(selectedRepository.default_ref ?? '');
  }, [managedRef, selectedRepository]);

  const filteredFunctions = useMemo(() => {
    const keyword = functionFilter.trim().toLowerCase();
    if (!keyword) {
      return functions;
    }
    return functions.filter((fn) => `${fn.id} ${fn.file} ${fn.package}`.toLowerCase().includes(keyword));
  }, [functionFilter, functions]);

  const functionColumns: ColumnsType<GoFunction> = [
    { title: 'Function', dataIndex: 'id', ellipsis: true, render: (value: string) => <Typography.Text code>{shortFunction(value)}</Typography.Text> },
    { title: 'Package', dataIndex: 'package', width: 180, ellipsis: true },
    { title: 'File', width: 260, render: (_, fn) => `${fn.file}:${fn.start_line}-${fn.end_line}` },
  ];

  const edgeColumns: ColumnsType<{ key: string; caller: string; callee: string; source: string; confidence: string; file: string; line: number }> = [
    { title: 'Caller', dataIndex: 'caller', ellipsis: true, render: (value: string) => <Typography.Text code>{shortFunction(value)}</Typography.Text> },
    { title: 'Callee', dataIndex: 'callee', ellipsis: true, render: (value: string) => <Typography.Text code>{shortFunction(value)}</Typography.Text> },
    { title: 'Source', dataIndex: 'source', width: 180 },
    { title: 'Confidence', dataIndex: 'confidence', width: 120, render: (value: string) => <Tag>{value}</Tag> },
  ];

  const repositoryColumns: ColumnsType<ManagedRepository> = [
    { title: 'Name', dataIndex: 'name', width: 160, ellipsis: true },
    { title: 'Git URL', dataIndex: 'url', ellipsis: true, render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
    { title: 'Default', dataIndex: 'default_ref', width: 110, render: (value?: string) => value || '-' },
    { title: 'Sync', width: 180, render: (_, repo) => repo.last_sync_error ? <Tag color="red">failed</Tag> : repo.last_sync_at ? shortTime(repo.last_sync_at) : '-' },
    {
      title: 'Actions',
      width: 220,
      render: (_, repo) => (
        <Space size={6}>
          <Button size="small" onClick={() => useManagedRepository(repo)}>
            Use
          </Button>
          <Button size="small" icon={<CloudSyncOutlined />} loading={syncLoading && selectedRepositoryID === repo.id} onClick={() => { void syncManagedRepository(repo.id); }} />
          <Popconfirm title="Delete repository" okText="Delete" cancelText="Cancel" onConfirm={() => { void removeManagedRepository(repo.id); }}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  async function loadManagedRepositories() {
    try {
      const repos = await listRepositories();
      setRepositories(repos);
      if (!selectedRepositoryID && repos.length > 0) {
        setSelectedRepositoryID(repos[0].id);
        setManagedRef(repos[0].default_ref ?? '');
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function loadRepositoryRefsFor(repoID: string) {
    try {
      const refs = await listRepositoryRefs(repoID);
      setRepositoryRefs(refs);
    } catch (err) {
      setRepositoryRefs([]);
      setError(errorMessage(err));
    }
  }

  async function saveManagedRepository() {
    setRepositoryLoading(true);
    setError('');
    try {
      const repo = await saveRepository({
        name: repoNameInput,
        url: repoURLInput,
        default_ref: repoDefaultRefInput,
      });
      setRepositories((items) => upsertRepository(items, repo));
      setSelectedRepositoryID(repo.id);
      setManagedRef(repo.default_ref ?? '');
      setSourceType('managed');
      setRepoNameInput('');
      setRepoURLInput('');
      setRepoDefaultRefInput('');
      void loadRepositoryRefsFor(repo.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRepositoryLoading(false);
    }
  }

  async function removeManagedRepository(repoID: string) {
    setError('');
    try {
      await deleteRepository(repoID);
      setRepositories((items) => items.filter((repo) => repo.id !== repoID));
      if (selectedRepositoryID === repoID) {
        setSelectedRepositoryID('');
        setManagedRef('');
        setRepositoryRefs([]);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function useManagedRepository(repo: ManagedRepository) {
    setSourceType('managed');
    setSelectedRepositoryID(repo.id);
    setManagedRef(repo.default_ref ?? '');
    setRepositoryDrawerOpen(false);
  }

  function selectManagedRepository(repoID: string) {
    const repo = repositories.find((item) => item.id === repoID);
    setSelectedRepositoryID(repoID);
    setManagedRef(repo?.default_ref ?? '');
  }

  async function syncManagedRepository(repoID = selectedRepositoryID): Promise<boolean> {
    if (!repoID) {
      setError('请选择已配置 Git 仓库');
      return false;
    }
    setSyncLoading(true);
    setError('');
    try {
      const resp = await syncRepository(repoID);
      setRepositories((items) => upsertRepository(items, resp.repository));
      setRepositoryRefs(resp.refs);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setSyncLoading(false);
    }
  }

  async function syncAndAnalyze() {
    if (!selectedRepositoryID) {
      setError('请选择已配置 Git 仓库');
      return;
    }
    const synced = await syncManagedRepository(selectedRepositoryID);
    if (synced) {
      await startAnalyze(true);
    }
  }

  async function startAnalyze(force = false) {
    if (sourceType === 'managed' && !selectedRepository) {
      setError('请选择已配置 Git 仓库');
      return;
    }
    setLoading(true);
    setError('');
    setRoutes([]);
    setFunctions([]);
    setFileTree(null);
    setFileContent(null);
    setSelectedFilePath('');
    setSelectedRoute(null);
    setCallchain(null);
    setImpact(null);
    setSelectedImpactedInterface(null);
    setFunctionDetail(null);
    setCallchainDrawerOpen(false);
    try {
      const started = await analyze(source, force, analyzeMode);
      const finalTask = await pollTask(started.task_id);
      setTask(finalTask);
      const [nextRoutes, nextFunctions, nextFileTree] = await Promise.all([
        getRoutes(started.task_id),
        getFunctions(started.task_id),
        getFileTree(started.task_id),
      ]);
      setRoutes(nextRoutes);
      setFunctions(nextFunctions);
      setFileTree(nextFileTree);
      if (nextRoutes.length > 0) {
        await selectRoute(started.task_id, nextRoutes[0]);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function pollTask(taskID: string): Promise<TaskStatusResponse> {
    for (;;) {
      const nextTask = await getTask(taskID);
      setTask(nextTask);
      if (nextTask.status === 'done') {
        return nextTask;
      }
      if (nextTask.status === 'failed') {
        throw new Error(nextTask.error ?? 'analysis failed');
      }
      await new Promise((resolve) => window.setTimeout(resolve, 700));
    }
  }

  async function selectRoute(taskID: string, route: Route) {
    setSelectedRoute(route);
    setSelectedImpactedInterface(null);
    const [nextCallchain, detail] = await Promise.all([
      getInterfaceCallchain(taskID, route.method, route.path),
      getFunctionDetail(taskID, route.handler).catch(() => null),
    ]);
    const content = detail ? await getFileContent(taskID, detail.function.file).catch(() => null) : null;
    setCallchain(nextCallchain);
    setFunctionDetail(detail);
    if (content) {
      setFileContent(content);
      setSelectedFilePath(content.path);
    }
    setFunctionInput(route.handler);
    setRawPayload(nextCallchain);
  }

  async function searchFunction() {
    if (!task?.task_id || !functionInput.trim()) {
      return;
    }
    try {
      const nextCallchain = await getFunctionCallchain(task.task_id, functionInput.trim());
      const detail = await getFunctionDetail(task.task_id, functionInput.trim());
      const content = await getFileContent(task.task_id, detail.function.file).catch(() => null);
      setSelectedRoute(null);
      setSelectedImpactedInterface(null);
      setCallchain(nextCallchain);
      setFunctionDetail(detail);
      if (content) {
        setFileContent(content);
        setSelectedFilePath(content.path);
      }
      setFunctionDrawerOpen(true);
      setRawPayload({ callchain: nextCallchain, detail });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function openFunctionDetail(functionID: string) {
    if (!task?.task_id) {
      return;
    }
    try {
      const detail = await getFunctionDetail(task.task_id, functionID);
      setFunctionDetail(detail);
      setFunctionInput(functionID);
      const content = await getFileContent(task.task_id, detail.function.file).catch(() => null);
      if (content) {
        setFileContent(content);
        setSelectedFilePath(content.path);
      }
      setFunctionDrawerOpen(true);
      setRawPayload(detail);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function runImpact() {
    setImpactLoading(true);
    setError('');
    try {
      const nextImpact = await getMRImpact(source, impactBase, impactHead, analyzeMode);
      setImpact(nextImpact);
      const firstImpact = nextImpact.impacted_interfaces?.[0];
      if (firstImpact) {
        selectImpactedInterface(firstImpact, false);
      } else {
        setSelectedImpactedInterface(null);
      }
      setRawPayload(nextImpact);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setImpactLoading(false);
    }
  }

  function selectImpactedInterface(row: ImpactedInterface, openDrawer = true) {
    setSelectedImpactedInterface(row);
    setSelectedRoute(null);
    setCallchain({ function: row.changed_function, tree: chainToCallTree(row.chain) });
    setFunctionInput(row.changed_function);
    setRawPayload(row);
    setCallchainDrawerOpen(openDrawer);
  }

  async function openCodeFile(path: string) {
    if (!task?.task_id) {
      return;
    }
    try {
      const content = await getFileContent(task.task_id, path);
      setSelectedFilePath(content.path);
      setFileContent(content);
      setRawPayload(content);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function selectCodeFunction(node: FileTreeNode) {
    if (!task?.task_id || !node.function_id || !node.path) {
      return;
    }
    try {
      const [nextCallchain, detail, content] = await Promise.all([
        getFunctionCallchain(task.task_id, node.function_id),
        getFunctionDetail(task.task_id, node.function_id),
        getFileContent(task.task_id, node.path),
      ]);
      setAppTab('code');
      setSelectedRoute(null);
      setSelectedImpactedInterface(null);
      setFunctionInput(node.function_id);
      setFunctionDetail(detail);
      setCallchain(nextCallchain);
      setSelectedFilePath(content.path);
      setFileContent(content);
      setRawPayload({ callchain: nextCallchain, detail });
      setCallchainDrawerOpen(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Layout className="app-shell">
      <header className="topbar">
        <div className="brand">
          <CodeOutlined />
          <span>Go Callchain Service</span>
        </div>
      </header>

      <section className="sourcebar" aria-label="Repository source">
        <Segmented
          value={sourceType}
          onChange={(value) => setSourceType(value as SourceType)}
          options={[
            { label: 'Local', value: 'local', icon: <DatabaseOutlined /> },
            { label: 'Git', value: 'git', icon: <BranchesOutlined /> },
            { label: 'Saved', value: 'managed', icon: <FolderOpenOutlined /> },
          ]}
        />
        {sourceType === 'local' ? (
          <Input value={localPath} onChange={(event) => setLocalPath(event.target.value)} />
        ) : sourceType === 'git' ? (
          <Space.Compact className="full-width">
            <Input value={gitURL} onChange={(event) => setGitURL(event.target.value)} placeholder="Git URL" />
            <Input className="ref-input" value={gitRef} onChange={(event) => setGitRef(event.target.value)} placeholder="HEAD" />
          </Space.Compact>
        ) : (
          <Space.Compact className="full-width">
            <Select
              className="repo-select"
              value={selectedRepositoryID || undefined}
              placeholder="Select repository"
              showSearch
              optionFilterProp="label"
              onChange={selectManagedRepository}
              options={repositories.map((repo) => ({ value: repo.id, label: repo.name }))}
            />
            <Input
              className="ref-input"
              list="repository-ref-options"
              value={managedRef}
              onChange={(event) => setManagedRef(event.target.value)}
              placeholder={selectedRepository?.default_ref || 'branch / tag / commit'}
            />
            <Button icon={<CloudSyncOutlined />} loading={syncLoading} disabled={!selectedRepositoryID} onClick={() => { void syncManagedRepository(); }} />
            <datalist id="repository-ref-options">
              {repositoryRefOptions.map((option) => (
                <option value={option.value} label={option.label} key={option.value} />
              ))}
            </datalist>
          </Space.Compact>
        )}
        <Button icon={<FolderOpenOutlined />} onClick={() => setRepositoryDrawerOpen(true)}>
          Repos
        </Button>
        <Segmented
          value={analyzeMode}
          onChange={(value) => setAnalyzeMode(value as AnalyzeMode)}
          options={[
            { label: 'Fast', value: 'fast' },
            { label: 'Accurate', value: 'accurate' },
          ]}
        />
        <Button type="primary" icon={<PlayCircleOutlined />} loading={loading} onClick={() => { void startAnalyze(); }}>
          Analyze
        </Button>
        <Button icon={<CloudSyncOutlined />} loading={syncLoading || loading} disabled={sourceType !== 'managed' || !selectedRepositoryID} onClick={() => { void syncAndAnalyze(); }}>
          更新分析
        </Button>
        <Button icon={<EyeOutlined />} onClick={() => setRawOpen(true)} disabled={!rawPayload}>
          JSON
        </Button>
        <div className="task-strip">
          <Tag color={task?.status === 'done' ? 'green' : task?.status === 'failed' ? 'red' : task ? 'blue' : 'default'}>
            {task?.status ?? 'idle'}
          </Tag>
          <Progress percent={task?.progress ?? 0} size="small" showInfo={false} />
          <span>
            {task ? `${task.functions ?? 0} functions · ${task.edges ?? 0} edges · ${task.routes ?? 0} routes` : 'No analysis yet'}
          </span>
        </div>
        {error && <Alert className="source-error" type="error" message={error} showIcon />}
      </section>

      <nav className="workspace-tabs" aria-label="Workspace">
        {workspaceTabs.map((tab) => (
          <button
            className={appTab === tab.key ? 'workspace-tab active' : 'workspace-tab'}
            key={tab.key}
            onClick={() => setAppTab(tab.key)}
            type="button"
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      <main className={`main-grid main-grid-${appTab}`}>
        {appTab === 'callchain' && (
          <ObjectRail
            routes={routes}
            filter={objectFilter}
            selectedRoute={selectedRoute}
            onFilterChange={setObjectFilter}
            onSelectRoute={(route) => {
              setDetailTab('routes');
              if (task?.task_id) {
                void selectRoute(task.task_id, route).catch((err) => setError(errorMessage(err)));
              } else {
                setSelectedRoute(route);
              }
            }}
          />
        )}

        {appTab === 'impact' && (
          <aside className="object-rail impact-control-rail">
            <div className="section-head">
              <div className="pane-title">
                <BranchesOutlined />
                <span>MR Impact</span>
              </div>
            </div>
            <div className="rail-body">
              <Space direction="vertical" size={12} className="full-width">
                <div>
                  <Typography.Text strong>Base</Typography.Text>
                  <Input value={impactBase} onChange={(event) => setImpactBase(event.target.value)} placeholder="master / main" />
                </div>
                <div>
                  <Typography.Text strong>Head</Typography.Text>
                  <Input value={impactHead} onChange={(event) => setImpactHead(event.target.value)} placeholder="feature / HEAD" />
                </div>
                <Button type="primary" block loading={impactLoading} onClick={runImpact}>
                  Analyze Impact
                </Button>
                <div className="impact-mini-metrics">
                  <div>
                    <span>Changed</span>
                    <strong>{impact?.changed_functions.length ?? 0}</strong>
                  </div>
                  <div>
                    <span>Impacted</span>
                    <strong>{impact?.impacted_interfaces.length ?? 0}</strong>
                  </div>
                </div>
              </Space>
            </div>
          </aside>
        )}

        {appTab === 'callchain' && (
          <CallchainPanel
            callchain={callchain}
            selectedRoute={selectedRoute}
            selectedFunction={functionInput}
            functions={functions}
            functionDetail={functionDetail}
            impactedInterface={selectedImpactedInterface}
            changedFunctionIDs={changedFunctionIDs}
            onSelectFunction={(functionID) => {
              void openFunctionDetail(functionID);
            }}
          />
        )}

        {appTab === 'impact' && (
          <section className="impact-workspace">
            <div className="section-head">
              <div className="pane-title">
                <BranchesOutlined />
                <span>Impact Results</span>
              </div>
              <Space size={12}>
                <Typography.Text type="secondary">
                  {impact ? `${impact.changed_functions.length} changed · ${impact.impacted_interfaces.length} impacted` : 'Run MR Impact to inspect affected interfaces'}
                </Typography.Text>
                <Button size="small" onClick={() => setCallchainDrawerOpen(true)} disabled={!callchain}>
                  Call Chain
                </Button>
              </Space>
            </div>
            <div className="detail-body">
              <ImpactPanel impact={impact} selected={selectedImpactedInterface} onSelect={(row) => selectImpactedInterface(row)} />
            </div>
          </section>
        )}

        {appTab === 'code' && (
          <section className="code-workspace">
            <div className="section-head">
              <div className="pane-title">
                <CodeOutlined />
                <span>Code Browser</span>
              </div>
              <Space size={12}>
                <Typography.Text type="secondary">{selectedFilePath || 'Select a file or function'}</Typography.Text>
                <Button size="small" onClick={() => setCallchainDrawerOpen(true)} disabled={!callchain}>
                  Call Chain
                </Button>
              </Space>
            </div>
            <div className="detail-body code-workspace-body">
              <CodeBrowser
                tree={fileTree}
                content={fileContent}
                selectedFilePath={selectedFilePath}
                selectedFunctionID={functionInput}
                functionDetail={functionDetail}
                onSelectFile={(path) => {
                  void openCodeFile(path);
                }}
                onSelectFunction={(node) => {
                  void selectCodeFunction(node);
                }}
              />
            </div>
          </section>
        )}

        {appTab === 'docs' && <DocsPage />}

        {appTab === 'callchain' && (
          <section className="routes-pane analysis-pane">
            <div className="main-tabs">
              {detailTabs.map((tab) => (
                <button
                  className={detailTab === tab.key ? 'tab active' : 'tab'}
                  key={tab.key}
                  onClick={() => setDetailTab(tab.key)}
                  type="button"
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="metric-grid">
              <div className="metric">
                <div className="metric-label">Routes</div>
                <div className="metric-value">{task?.routes ?? routes.length}</div>
              </div>
              <div className="metric">
                <div className="metric-label">Functions</div>
                <div className="metric-value">{task?.functions ?? functions.length}</div>
              </div>
              <div className="metric">
                <div className="metric-label">Edges</div>
                <div className="metric-value">{task?.edges ?? 0}</div>
              </div>
              <div className="metric">
                <div className="metric-label">Commit</div>
                <div className="metric-value metric-commit">{shortCommit(task?.commit)}</div>
              </div>
            </div>

            {detailTab === 'routes' && (
              <>
                <div className="split-title">
                  <div className="pane-title">
                    <ApiOutlined />
                    <span>Route Detail</span>
                  </div>
                </div>
                {!selectedRoute ? (
                  <Empty className="route-empty" description="Select a route from the left list" />
                ) : (
                  <Descriptions size="small" column={1} bordered>
                    <Descriptions.Item label="Method">
                      <Tag color={methodColor(selectedRoute.method)}>{selectedRoute.method}</Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="Path">
                      <Typography.Text className="wrap-text">{selectedRoute.path}</Typography.Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="Handler">
                      <Typography.Text className="wrap-text" code>
                        {selectedRoute.handler}
                      </Typography.Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="File">
                      <Typography.Text className="wrap-text">{`${selectedRoute.file}:${selectedRoute.line}`}</Typography.Text>
                    </Descriptions.Item>
                  </Descriptions>
                )}
              </>
            )}

            {detailTab === 'functions' && (
              <>
                <div className="split-title">
                  <div className="pane-title">
                    <CodeOutlined />
                    <span>Functions</span>
                  </div>
                  <Input value={functionFilter} onChange={(event) => setFunctionFilter(event.target.value)} className="filter-input" placeholder="Filter function / file" />
                </div>
                <div className="tool-row single">
                  <div>
                    <Typography.Text strong>Function</Typography.Text>
                    <Space.Compact className="full-width">
                      <Input list="function-options" value={functionInput} onChange={(event) => setFunctionInput(event.target.value)} />
                      <Button icon={<SearchOutlined />} onClick={searchFunction} disabled={!task}>
                        Search
                      </Button>
                    </Space.Compact>
                    <datalist id="function-options">
                      {functions.slice(0, 2000).map((fn) => (
                        <option value={fn.id} key={fn.id} />
                      ))}
                    </datalist>
                  </div>
                </div>
                <Table<GoFunction>
                  rowKey={(fn) => fn.id}
                  size="small"
                  columns={functionColumns}
                  dataSource={filteredFunctions}
                  pagination={{ pageSize: 12, size: 'small' }}
                  scroll={{ y: 360 }}
                  onRow={(fn) => ({
                    onClick: () => {
                      setFunctionInput(fn.id);
                      void openFunctionDetail(fn.id);
                    },
                  })}
                  rowClassName={(fn) => (functionInput === fn.id ? 'selected-row' : '')}
                />
              </>
            )}

            {detailTab === 'raw' && (
              <pre className="json-view main-json">
                {JSON.stringify({ task, selectedRoute, callchain, impact, functionDetail, fileContent }, null, 2)}
              </pre>
            )}
          </section>
        )}

      </main>

      <Drawer title="Git Repositories" width={900} open={repositoryDrawerOpen} onClose={() => setRepositoryDrawerOpen(false)}>
        <Space direction="vertical" size={16} className="full-width">
          <div className="repo-form">
            <Input value={repoNameInput} onChange={(event) => setRepoNameInput(event.target.value)} placeholder="Name" />
            <Input value={repoURLInput} onChange={(event) => setRepoURLInput(event.target.value)} placeholder="Git URL" />
            <Input value={repoDefaultRefInput} onChange={(event) => setRepoDefaultRefInput(event.target.value)} placeholder="Default branch" />
            <Button type="primary" icon={<SaveOutlined />} loading={repositoryLoading} onClick={() => { void saveManagedRepository(); }}>
              Save
            </Button>
          </div>
          <Table<ManagedRepository>
            rowKey={(repo) => repo.id}
            size="small"
            columns={repositoryColumns}
            dataSource={repositories}
            pagination={false}
            rowClassName={(repo) => (repo.id === selectedRepositoryID ? 'selected-row' : '')}
          />
        </Space>
      </Drawer>

      <Drawer
        className="callchain-drawer"
        title="Call Chain"
        width="calc(100vw - 64px)"
        open={callchainDrawerOpen}
        onClose={() => setCallchainDrawerOpen(false)}
        destroyOnClose
      >
        <CallchainPanel
          callchain={callchain}
          selectedRoute={selectedRoute}
          selectedFunction={functionInput}
          functions={functions}
          functionDetail={functionDetail}
          impactedInterface={selectedImpactedInterface}
          changedFunctionIDs={changedFunctionIDs}
          onSelectFunction={(functionID) => {
            void openFunctionDetail(functionID);
          }}
        />
      </Drawer>

      <Drawer title="Function Detail" width={760} open={functionDrawerOpen} onClose={() => setFunctionDrawerOpen(false)}>
        {functionDetail && (
          <Space direction="vertical" size={14} className="full-width">
            <Descriptions size="small" column={1}>
              <Descriptions.Item label="ID">{functionDetail.function.id}</Descriptions.Item>
              <Descriptions.Item label="File">{`${functionDetail.function.file}:${functionDetail.function.start_line}-${functionDetail.function.end_line}`}</Descriptions.Item>
              <Descriptions.Item label="Package">{functionDetail.function.package}</Descriptions.Item>
            </Descriptions>
            <Typography.Text strong>Incoming</Typography.Text>
            <Table size="small" rowKey={(edge) => `in-${edge.caller}-${edge.line}`} columns={edgeColumns} dataSource={withEdgeKeys(functionDetail.incoming_edges ?? [])} pagination={false} />
            <Typography.Text strong>Outgoing</Typography.Text>
            <Table size="small" rowKey={(edge) => `out-${edge.callee}-${edge.line}`} columns={edgeColumns} dataSource={withEdgeKeys(functionDetail.outgoing_edges ?? [])} pagination={false} />
          </Space>
        )}
      </Drawer>

      <Drawer title="Raw JSON" width={720} open={rawOpen} onClose={() => setRawOpen(false)}>
        <pre className="json-view">{JSON.stringify(rawPayload, null, 2)}</pre>
      </Drawer>
    </Layout>
  );
}

function shortCommit(value?: string): string {
  if (!value) {
    return '-';
  }
  return value.slice(0, 8);
}

function shortTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function upsertRepository(items: ManagedRepository[], next: ManagedRepository): ManagedRepository[] {
  const merged = items.some((repo) => repo.id === next.id)
    ? items.map((repo) => (repo.id === next.id ? next : repo))
    : [...items, next];
  return [...merged].sort((left, right) => left.name.localeCompare(right.name) || left.url.localeCompare(right.url));
}

function withEdgeKeys(edges: FunctionDetail['incoming_edges']) {
  return edges.map((edge, index) => ({ ...edge, key: `${edge.caller}-${edge.callee}-${edge.line}-${index}` }));
}

function shortFunction(value: string): string {
  const parts = value.split('/');
  return parts[parts.length - 1] ?? value;
}

function methodColor(method: string): string {
  switch (method) {
    case 'GET':
      return 'blue';
    case 'POST':
      return 'green';
    case 'PUT':
      return 'gold';
    case 'PATCH':
      return 'purple';
    case 'DELETE':
      return 'red';
    default:
      return 'default';
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default App;
