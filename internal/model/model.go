package model

const (
	AnalyzeModeFast     = "fast"
	AnalyzeModeAccurate = "accurate"
)

type RepoSource struct {
	Type string `json:"type"`
	Path string `json:"path,omitempty"`
	URL  string `json:"url,omitempty"`
	Ref  string `json:"ref,omitempty"`
}

type ManagedRepository struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	URL           string `json:"url"`
	DefaultRef    string `json:"default_ref,omitempty"`
	LastSyncAt    string `json:"last_sync_at,omitempty"`
	LastSyncError string `json:"last_sync_error,omitempty"`
}

type SaveRepositoryRequest struct {
	ID         string `json:"id,omitempty"`
	Name       string `json:"name"`
	URL        string `json:"url"`
	DefaultRef string `json:"default_ref,omitempty"`
}

type RepositoryListResponse struct {
	Repositories []ManagedRepository `json:"repositories"`
}

type RepositoryRef struct {
	Name   string `json:"name"`
	Type   string `json:"type"`
	Commit string `json:"commit,omitempty"`
}

type RepositoryRefsResponse struct {
	Refs []RepositoryRef `json:"refs"`
}

type RepositorySyncResponse struct {
	Status     string            `json:"status"`
	Repository ManagedRepository `json:"repository"`
	Refs       []RepositoryRef   `json:"refs"`
}

type Function struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Package   string `json:"package"`
	Receiver  string `json:"receiver,omitempty"`
	File      string `json:"file"`
	StartLine int    `json:"start_line"`
	EndLine   int    `json:"end_line"`
}

type Edge struct {
	Caller     string `json:"caller"`
	Callee     string `json:"callee"`
	File       string `json:"file"`
	Line       int    `json:"line"`
	Source     string `json:"source"`
	Confidence string `json:"confidence"`
}

type Route struct {
	Method  string `json:"method"`
	Path    string `json:"path"`
	Handler string `json:"handler"`
	File    string `json:"file"`
	Line    int    `json:"line"`
}

type AnalysisResult struct {
	Source    RepoSource `json:"source,omitempty"`
	Workspace string     `json:"workspace,omitempty"`
	Module    string     `json:"module"`
	Commit    string     `json:"commit,omitempty"`
	CacheKey  string     `json:"cache_key,omitempty"`
	Mode      string     `json:"mode"`
	Functions []Function `json:"functions"`
	Edges     []Edge     `json:"edges"`
	Routes    []Route    `json:"routes"`
}

type AnalyzeRequest struct {
	Source RepoSource `json:"source"`
	Force  bool       `json:"force"`
	Mode   string     `json:"mode,omitempty"`
}

type AnalyzeResponse struct {
	TaskID string `json:"task_id"`
	Status string `json:"status"`
}

type TaskStatusResponse struct {
	TaskID     string `json:"task_id"`
	Status     string `json:"status"`
	Phase      string `json:"phase,omitempty"`
	Progress   int    `json:"progress,omitempty"`
	Workspace  string `json:"workspace,omitempty"`
	Commit     string `json:"commit,omitempty"`
	Functions  int    `json:"functions,omitempty"`
	Edges      int    `json:"edges,omitempty"`
	Routes     int    `json:"routes,omitempty"`
	Error      string `json:"error,omitempty"`
	CacheHit   bool   `json:"cache_hit,omitempty"`
	Mode       string `json:"mode,omitempty"`
	StartedAt  string `json:"started_at,omitempty"`
	FinishedAt string `json:"finished_at,omitempty"`
}

type InterfaceCallchainRequest struct {
	TaskID string `json:"task_id"`
	Method string `json:"method"`
	Path   string `json:"path"`
	Depth  int    `json:"depth"`
}

type FunctionCallchainRequest struct {
	TaskID   string `json:"task_id"`
	Function string `json:"function"`
	Depth    int    `json:"depth"`
}

type FunctionDetail struct {
	Function      Function `json:"function"`
	IncomingEdges []Edge   `json:"incoming_edges"`
	OutgoingEdges []Edge   `json:"outgoing_edges"`
}

type FileTreeNode struct {
	Key        string         `json:"key"`
	Type       string         `json:"type"`
	Name       string         `json:"name"`
	Path       string         `json:"path,omitempty"`
	FunctionID string         `json:"function_id,omitempty"`
	StartLine  int            `json:"start_line,omitempty"`
	EndLine    int            `json:"end_line,omitempty"`
	Children   []FileTreeNode `json:"children,omitempty"`
}

type FileContentResponse struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

type MRImpactRequest struct {
	Source RepoSource `json:"source"`
	Base   string     `json:"base"`
	Head   string     `json:"head"`
	Depth  int        `json:"depth"`
	Mode   string     `json:"mode,omitempty"`
}

type ChangedFunction struct {
	ID        string `json:"id"`
	File      string `json:"file"`
	StartLine int    `json:"start_line"`
	EndLine   int    `json:"end_line"`
}

type ImpactedInterface struct {
	Method          string   `json:"method"`
	Path            string   `json:"path"`
	Handler         string   `json:"handler"`
	ChangedFunction string   `json:"changed_function"`
	Chain           []string `json:"chain"`
	Risk            string   `json:"risk"`
}

type MRImpactResponse struct {
	TaskID             string              `json:"task_id,omitempty"`
	ChangedFunctions   []ChangedFunction   `json:"changed_functions"`
	ImpactedInterfaces []ImpactedInterface `json:"impacted_interfaces"`
}
