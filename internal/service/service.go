package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"go-callchain-service/internal/analyzer"
	"go-callchain-service/internal/cache"
	"go-callchain-service/internal/gitdiff"
	"go-callchain-service/internal/graph"
	"go-callchain-service/internal/model"
	"go-callchain-service/internal/repository"
)

const (
	StatusQueued  = "queued"
	StatusRunning = "running"
	StatusDone    = "done"
	StatusFailed  = "failed"
	defaultDepth  = 8
	maxDepth      = 20
	maxFileBytes  = 2 * 1024 * 1024
)

type Options struct {
	BaseDir string
}

type Manager struct {
	mu       sync.RWMutex
	tasks    map[string]*Task
	analyzer *analyzer.Analyzer
	repos    *repository.Manager
	cache    *cache.Store
}

type Task struct {
	ID         string
	Status     string
	Phase      string
	Progress   int
	Error      string
	Mode       string
	Workspace  string
	Commit     string
	CacheHit   bool
	StartedAt  time.Time
	FinishedAt time.Time
	Result     *model.AnalysisResult
}

type InterfaceCallchain struct {
	Route model.Route        `json:"route"`
	Tree  graph.CallTreeNode `json:"tree"`
}

type FunctionCallchain struct {
	Function string             `json:"function"`
	Tree     graph.CallTreeNode `json:"tree"`
}

func New(options Options) *Manager {
	baseDir := options.BaseDir
	if baseDir == "" {
		baseDir = defaultBaseDir()
	}
	return &Manager{
		tasks:    map[string]*Task{},
		analyzer: analyzer.New(),
		repos:    repository.NewManager(baseDir),
		cache:    cache.NewStore(filepath.Join(baseDir, "cache")),
	}
}

func (m *Manager) ListRepositories() ([]model.ManagedRepository, error) {
	return m.repos.ListRepositories()
}

func (m *Manager) SaveRepository(req model.SaveRepositoryRequest) (model.ManagedRepository, error) {
	return m.repos.SaveRepository(req)
}

func (m *Manager) DeleteRepository(id string) error {
	return m.repos.DeleteRepository(id)
}

func (m *Manager) ListRepositoryRefs(ctx context.Context, id string) ([]model.RepositoryRef, error) {
	return m.repos.ListRepositoryRefs(ctx, id)
}

func (m *Manager) SyncRepository(ctx context.Context, id string) (*model.RepositorySyncResponse, error) {
	return m.repos.SyncRepository(ctx, id)
}

func (m *Manager) Analyze(_ context.Context, req model.AnalyzeRequest) (*model.AnalyzeResponse, error) {
	taskID := newTaskID(req.Source)
	task := &Task{ID: taskID, Status: StatusQueued, Mode: normalizeMode(req.Mode)}
	m.mu.Lock()
	m.tasks[taskID] = task
	m.mu.Unlock()

	go m.runAnalyze(context.Background(), taskID, req)
	return &model.AnalyzeResponse{TaskID: taskID, Status: task.Status}, nil
}

func (m *Manager) TaskStatus(taskID string) (model.TaskStatusResponse, error) {
	task, err := m.task(taskID)
	if err != nil {
		return model.TaskStatusResponse{}, err
	}
	resp := model.TaskStatusResponse{
		TaskID:    task.ID,
		Status:    task.Status,
		Phase:     task.Phase,
		Progress:  task.Progress,
		Workspace: task.Workspace,
		Commit:    task.Commit,
		Error:     task.Error,
		CacheHit:  task.CacheHit,
		Mode:      task.Mode,
	}
	if !task.StartedAt.IsZero() {
		resp.StartedAt = task.StartedAt.Format(time.RFC3339)
	}
	if !task.FinishedAt.IsZero() {
		resp.FinishedAt = task.FinishedAt.Format(time.RFC3339)
	}
	if task.Result != nil {
		resp.Functions = len(task.Result.Functions)
		resp.Edges = len(task.Result.Edges)
		resp.Routes = len(task.Result.Routes)
	}
	return resp, nil
}

func (m *Manager) Routes(taskID string) ([]model.Route, error) {
	task, err := m.doneTask(taskID)
	if err != nil {
		return nil, err
	}
	return task.Result.Routes, nil
}

func (m *Manager) InterfaceCallchain(req model.InterfaceCallchainRequest) (*InterfaceCallchain, error) {
	task, err := m.doneTask(req.TaskID)
	if err != nil {
		return nil, err
	}
	method := strings.ToUpper(req.Method)
	for _, route := range task.Result.Routes {
		if route.Method == method && route.Path == req.Path {
			tree := graph.BuildCallTree(task.Result, route.Handler, capDepth(req.Depth))
			return &InterfaceCallchain{Route: route, Tree: tree}, nil
		}
	}
	return nil, fmt.Errorf("route not found: %s %s", method, req.Path)
}

func (m *Manager) FunctionCallchain(req model.FunctionCallchainRequest) (*FunctionCallchain, error) {
	task, err := m.doneTask(req.TaskID)
	if err != nil {
		return nil, err
	}
	if _, ok := functionByID(task.Result.Functions, req.Function); !ok {
		return nil, fmt.Errorf("function not found: %s", req.Function)
	}
	tree := graph.BuildCallTree(task.Result, req.Function, capDepth(req.Depth))
	return &FunctionCallchain{Function: req.Function, Tree: tree}, nil
}

func (m *Manager) Functions(taskID string) ([]model.Function, error) {
	task, err := m.doneTask(taskID)
	if err != nil {
		return nil, err
	}
	return task.Result.Functions, nil
}

func (m *Manager) FunctionDetail(taskID string, id string) (*model.FunctionDetail, error) {
	task, err := m.doneTask(taskID)
	if err != nil {
		return nil, err
	}
	function, ok := functionByID(task.Result.Functions, id)
	if !ok {
		return nil, fmt.Errorf("function not found: %s", id)
	}
	detail := &model.FunctionDetail{
		Function:      function,
		IncomingEdges: []model.Edge{},
		OutgoingEdges: []model.Edge{},
	}
	for _, edge := range task.Result.Edges {
		if edge.Callee == id {
			detail.IncomingEdges = append(detail.IncomingEdges, edge)
		}
		if edge.Caller == id {
			detail.OutgoingEdges = append(detail.OutgoingEdges, edge)
		}
	}
	return detail, nil
}

func (m *Manager) FileTree(taskID string) (model.FileTreeNode, error) {
	task, err := m.doneTask(taskID)
	if err != nil {
		return model.FileTreeNode{}, err
	}
	return buildFileTree(task.Workspace, task.Result.Functions)
}

func (m *Manager) FileContent(taskID string, relPath string) (*model.FileContentResponse, error) {
	task, err := m.doneTask(taskID)
	if err != nil {
		return nil, err
	}
	absPath, cleanPath, err := safeWorkspaceFile(task.Workspace, relPath)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return nil, err
	}
	if info.Size() > maxFileBytes {
		return nil, fmt.Errorf("file is too large: %s", cleanPath)
	}
	data, err := os.ReadFile(absPath)
	if err != nil {
		return nil, err
	}
	return &model.FileContentResponse{Path: cleanPath, Content: string(data)}, nil
}

func (m *Manager) MRImpact(ctx context.Context, req model.MRImpactRequest) (*model.MRImpactResponse, error) {
	if req.Base == "" || req.Head == "" {
		return nil, errors.New("base and head are required")
	}
	source := req.Source
	if source.Type == "git" {
		source.Ref = req.Head
	}
	var workspace *repository.Workspace
	var err error
	if source.Type == "local" || (source.Type == "" && source.Path != "") {
		workspace, err = m.repos.ResolveLocalRef(ctx, source, req.Head)
	} else {
		workspace, err = m.repos.Resolve(ctx, source)
	}
	if err != nil {
		return nil, err
	}
	mode := normalizeMode(req.Mode)
	result, err := analyzer.New(analyzer.Options{Mode: mode}).Analyze(ctx, workspace.Path)
	if err != nil {
		return nil, err
	}
	changes, err := gitdiff.Diff(workspace.Path, req.Base, req.Head)
	if err != nil {
		return nil, err
	}
	changedFunctions := gitdiff.ChangedFunctions(changes, result.Functions)
	targets := make([]string, 0, len(changedFunctions))
	response := &model.MRImpactResponse{
		ChangedFunctions:   []model.ChangedFunction{},
		ImpactedInterfaces: []model.ImpactedInterface{},
	}
	for _, function := range changedFunctions {
		targets = append(targets, function.ID)
		response.ChangedFunctions = append(response.ChangedFunctions, model.ChangedFunction{
			ID:        function.ID,
			File:      function.File,
			StartLine: function.StartLine,
			EndLine:   function.EndLine,
		})
	}
	paths := graph.FindPathsToRoutes(result, targets, capDepth(req.Depth))
	impactIndex := map[string]int{}
	for _, path := range paths {
		if len(path.Nodes) == 0 {
			continue
		}
		chain := make([]string, 0, len(path.Nodes))
		for _, node := range path.Nodes {
			chain = append(chain, node.Function)
		}
		changedFunction := path.Nodes[len(path.Nodes)-1].Function
		risk := "indirect"
		if len(path.Nodes) == 1 || path.Route.Handler == changedFunction {
			risk = "direct"
		}
		impact := model.ImpactedInterface{
			Method:          path.Route.Method,
			Path:            path.Route.Path,
			Handler:         path.Route.Handler,
			ChangedFunction: changedFunction,
			Chain:           chain,
			Risk:            risk,
		}
		response.ImpactedInterfaces = appendUniqueImpact(response.ImpactedInterfaces, impactIndex, impact)
	}
	return response, nil
}

func appendUniqueImpact(items []model.ImpactedInterface, index map[string]int, next model.ImpactedInterface) []model.ImpactedInterface {
	key := impactIdentity(next)
	if existingIndex, ok := index[key]; ok {
		if shouldReplaceImpact(items[existingIndex], next) {
			items[existingIndex] = next
		}
		return items
	}
	index[key] = len(items)
	return append(items, next)
}

func impactIdentity(item model.ImpactedInterface) string {
	return item.Method + "\x00" + item.Path + "\x00" + item.Handler + "\x00" + item.ChangedFunction
}

func shouldReplaceImpact(existing model.ImpactedInterface, next model.ImpactedInterface) bool {
	if impactRiskRank(next.Risk) < impactRiskRank(existing.Risk) {
		return true
	}
	if impactRiskRank(next.Risk) > impactRiskRank(existing.Risk) {
		return false
	}
	if len(next.Chain) == 0 {
		return false
	}
	return len(existing.Chain) == 0 || len(next.Chain) < len(existing.Chain)
}

func impactRiskRank(risk string) int {
	if risk == "direct" {
		return 0
	}
	return 1
}

func (m *Manager) runAnalyze(ctx context.Context, taskID string, req model.AnalyzeRequest) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()
	mode := normalizeMode(req.Mode)
	m.updateTask(taskID, func(task *Task) {
		task.Status = StatusRunning
		task.Phase = "resolving_source"
		task.Progress = 10
		task.Mode = mode
		task.StartedAt = time.Now()
	})

	workspace, err := m.repos.Resolve(ctx, req.Source)
	if err != nil {
		m.failTask(taskID, err)
		return
	}
	m.updateTask(taskID, func(task *Task) {
		task.Workspace = workspace.Path
		task.Commit = workspace.Commit
		task.Phase = "checking_cache"
		task.Progress = 25
	})
	cacheKey := cacheKeyForMode(workspace.CacheKey, mode)

	if !req.Force {
		if result, ok, err := m.cache.Load(cacheKey); err != nil {
			m.failTask(taskID, err)
			return
		} else if ok {
			result.CacheKey = cacheKey
			result.Source = workspace.Source
			result.Workspace = workspace.Path
			result.Commit = workspace.Commit
			result.Mode = mode
			m.updateTask(taskID, func(task *Task) {
				task.CacheHit = true
			})
			m.completeTask(taskID, result)
			return
		}
	}

	m.updateTask(taskID, func(task *Task) {
		task.Phase = "analyzing"
		task.Progress = 50
	})
	result, err := analyzer.New(analyzer.Options{Mode: mode}).Analyze(ctx, workspace.Path)
	if err != nil {
		m.failTask(taskID, err)
		return
	}
	result.Source = workspace.Source
	result.Workspace = workspace.Path
	result.Commit = workspace.Commit
	result.CacheKey = cacheKey
	result.Mode = mode
	if err := m.cache.Save(cacheKey, result); err != nil {
		m.failTask(taskID, err)
		return
	}
	m.completeTask(taskID, result)
}

func (m *Manager) task(taskID string) (*Task, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()
	task := m.tasks[taskID]
	if task == nil {
		return nil, fmt.Errorf("task not found: %s", taskID)
	}
	copyTask := *task
	return &copyTask, nil
}

func (m *Manager) doneTask(taskID string) (*Task, error) {
	task, err := m.task(taskID)
	if err != nil {
		return nil, err
	}
	switch task.Status {
	case StatusDone:
		return task, nil
	case StatusFailed:
		return nil, errors.New(task.Error)
	default:
		return nil, fmt.Errorf("task is %s", task.Status)
	}
}

func (m *Manager) updateTask(taskID string, update func(*Task)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if task := m.tasks[taskID]; task != nil {
		update(task)
	}
}

func (m *Manager) failTask(taskID string, err error) {
	m.updateTask(taskID, func(task *Task) {
		task.Status = StatusFailed
		task.Phase = "failed"
		task.Error = err.Error()
		task.FinishedAt = time.Now()
	})
}

func (m *Manager) completeTask(taskID string, result *model.AnalysisResult) {
	m.updateTask(taskID, func(task *Task) {
		task.Status = StatusDone
		task.Phase = "done"
		task.Progress = 100
		task.Result = result
		task.Workspace = result.Workspace
		task.Commit = result.Commit
		task.Mode = result.Mode
		task.FinishedAt = time.Now()
	})
}

func defaultBaseDir() string {
	dir, err := os.UserCacheDir()
	if err != nil || dir == "" {
		return filepath.Join(os.TempDir(), "go-callchain-service")
	}
	return filepath.Join(dir, "go-callchain-service")
}

func buildFileTree(workspace string, functions []model.Function) (model.FileTreeNode, error) {
	rootName := filepath.Base(workspace)
	if rootName == "." || rootName == string(filepath.Separator) {
		rootName = "workspace"
	}
	root := &model.FileTreeNode{Key: "/", Type: "directory", Name: rootName}
	functionsByFile := map[string][]model.Function{}
	for _, fn := range functions {
		functionsByFile[fn.File] = append(functionsByFile[fn.File], fn)
	}
	for file := range functionsByFile {
		sort.Slice(functionsByFile[file], func(i, j int) bool {
			if functionsByFile[file][i].StartLine == functionsByFile[file][j].StartLine {
				return functionsByFile[file][i].ID < functionsByFile[file][j].ID
			}
			return functionsByFile[file][i].StartLine < functionsByFile[file][j].StartLine
		})
	}

	seenFiles := map[string]bool{}
	err := filepath.WalkDir(workspace, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if shouldSkipCodeDir(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(entry.Name(), ".go") {
			return nil
		}
		rel, err := filepath.Rel(workspace, path)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		seenFiles[rel] = true
		insertFileNode(root, rel, functionsByFile[rel])
		return nil
	})
	if err != nil {
		return model.FileTreeNode{}, err
	}
	for file, fileFunctions := range functionsByFile {
		if !seenFiles[file] {
			insertFileNode(root, file, fileFunctions)
		}
	}
	sortFileTree(root)
	return *root, nil
}

func insertFileNode(root *model.FileTreeNode, relPath string, functions []model.Function) {
	parts := strings.Split(relPath, "/")
	current := root
	currentPath := ""
	for i, part := range parts {
		if part == "" {
			continue
		}
		if currentPath == "" {
			currentPath = part
		} else {
			currentPath += "/" + part
		}
		nodeType := "directory"
		if i == len(parts)-1 {
			nodeType = "file"
		}
		current = childNode(current, nodeType, part, currentPath)
	}
	current.Children = current.Children[:0]
	for _, fn := range functions {
		current.Children = append(current.Children, model.FileTreeNode{
			Key:        "fn:" + fn.ID,
			Type:       "function",
			Name:       displayFunctionName(fn),
			Path:       fn.File,
			FunctionID: fn.ID,
			StartLine:  fn.StartLine,
			EndLine:    fn.EndLine,
		})
	}
}

func childNode(parent *model.FileTreeNode, nodeType string, name string, path string) *model.FileTreeNode {
	key := nodeType + ":" + path
	for i := range parent.Children {
		if parent.Children[i].Key == key {
			return &parent.Children[i]
		}
	}
	parent.Children = append(parent.Children, model.FileTreeNode{
		Key:  key,
		Type: nodeType,
		Name: name,
		Path: path,
	})
	return &parent.Children[len(parent.Children)-1]
}

func sortFileTree(node *model.FileTreeNode) {
	sort.Slice(node.Children, func(i, j int) bool {
		left := node.Children[i]
		right := node.Children[j]
		if left.Type != right.Type {
			return fileTreeTypeRank(left.Type) < fileTreeTypeRank(right.Type)
		}
		if left.StartLine != right.StartLine {
			return left.StartLine < right.StartLine
		}
		return left.Name < right.Name
	})
	for i := range node.Children {
		sortFileTree(&node.Children[i])
	}
}

func fileTreeTypeRank(nodeType string) int {
	switch nodeType {
	case "directory":
		return 0
	case "file":
		return 1
	default:
		return 2
	}
}

func displayFunctionName(fn model.Function) string {
	if fn.Receiver != "" {
		return "(" + fn.Receiver + ")." + fn.Name
	}
	return fn.Name
}

func shouldSkipCodeDir(name string) bool {
	switch name {
	case ".git", "vendor", "node_modules":
		return true
	default:
		return false
	}
}

func safeWorkspaceFile(workspace string, relPath string) (string, string, error) {
	relPath = strings.TrimSpace(relPath)
	if relPath == "" {
		return "", "", errors.New("path is required")
	}
	clean := filepath.Clean(filepath.FromSlash(relPath))
	if clean == "." || clean == ".." || filepath.IsAbs(clean) || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", "", fmt.Errorf("invalid path: %s", relPath)
	}
	absWorkspace, err := filepath.Abs(workspace)
	if err != nil {
		return "", "", err
	}
	absPath := filepath.Join(absWorkspace, clean)
	relCheck, err := filepath.Rel(absWorkspace, absPath)
	if err != nil || relCheck == ".." || strings.HasPrefix(relCheck, ".."+string(filepath.Separator)) {
		return "", "", fmt.Errorf("invalid path: %s", relPath)
	}
	info, err := os.Lstat(absPath)
	if err != nil {
		return "", "", err
	}
	if info.IsDir() {
		return "", "", fmt.Errorf("path is a directory: %s", relPath)
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return "", "", fmt.Errorf("symlink files are not supported: %s", relPath)
	}
	return absPath, filepath.ToSlash(relCheck), nil
}

func newTaskID(source model.RepoSource) string {
	raw := fmt.Sprintf("%s|%s|%s|%s|%d", source.Type, source.Path, source.URL, source.Ref, time.Now().UnixNano())
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:16])
}

func functionByID(functions []model.Function, id string) (model.Function, bool) {
	for _, function := range functions {
		if function.ID == id {
			return function, true
		}
	}
	return model.Function{}, false
}

func capDepth(depth int) int {
	if depth <= 0 {
		return defaultDepth
	}
	if depth > maxDepth {
		return maxDepth
	}
	return depth
}

func normalizeMode(mode string) string {
	switch mode {
	case "", model.AnalyzeModeFast:
		return model.AnalyzeModeFast
	case model.AnalyzeModeAccurate:
		return model.AnalyzeModeAccurate
	default:
		return model.AnalyzeModeFast
	}
}

func cacheKeyForMode(cacheKey string, mode string) string {
	return hashString(cacheKey + "|" + normalizeMode(mode))
}

func hashString(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
