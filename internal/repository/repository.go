package repository

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"go-callchain-service/internal/model"
)

const analyzerVersion = "ast-v7-package-var-callgraph"

const maxRepoSizeBytes = 2 * 1024 * 1024 * 1024

type Workspace struct {
	Path     string
	Commit   string
	CacheKey string
	Source   model.RepoSource
}

type Manager struct {
	baseDir string
	mu      sync.Mutex
}

type repositoryCatalog struct {
	Repositories []model.ManagedRepository `json:"repositories"`
}

func NewManager(baseDir string) *Manager {
	if baseDir == "" {
		if cacheDir, err := os.UserCacheDir(); err == nil && cacheDir != "" {
			baseDir = filepath.Join(cacheDir, "go-callchain-service")
		} else {
			baseDir = filepath.Join(os.TempDir(), "go-callchain-service")
		}
	}
	return &Manager{baseDir: baseDir}
}

func (m *Manager) ListRepositories() ([]model.ManagedRepository, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	catalog, err := m.readCatalog()
	if err != nil {
		return nil, err
	}
	sortRepositories(catalog.Repositories)
	return catalog.Repositories, nil
}

func (m *Manager) SaveRepository(req model.SaveRepositoryRequest) (model.ManagedRepository, error) {
	name := strings.TrimSpace(req.Name)
	url := normalizeGitURL(req.URL)
	defaultRef := strings.TrimSpace(req.DefaultRef)
	if url == "" {
		return model.ManagedRepository{}, errors.New("repository url is required")
	}
	if name == "" {
		name = repositoryNameFromURL(url)
	}
	if defaultRef == "" {
		defaultRef = "master"
	}
	id := strings.TrimSpace(req.ID)
	if id != "" && !validRepositoryID(id) {
		return model.ManagedRepository{}, fmt.Errorf("invalid repository id: %s", id)
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	catalog, err := m.readCatalog()
	if err != nil {
		return model.ManagedRepository{}, err
	}
	if id == "" {
		id = nextRepositoryID(catalog.Repositories, url)
	}
	next := model.ManagedRepository{
		ID:         id,
		Name:       name,
		URL:        url,
		DefaultRef: defaultRef,
	}
	replaced := false
	for i, repo := range catalog.Repositories {
		if repo.ID == id {
			next.LastSyncAt = repo.LastSyncAt
			next.LastSyncError = repo.LastSyncError
			catalog.Repositories[i] = next
			replaced = true
			break
		}
	}
	if !replaced {
		catalog.Repositories = append(catalog.Repositories, next)
	}
	sortRepositories(catalog.Repositories)
	if err := m.writeCatalog(catalog); err != nil {
		return model.ManagedRepository{}, err
	}
	return next, nil
}

func (m *Manager) DeleteRepository(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("repository id is required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	catalog, err := m.readCatalog()
	if err != nil {
		return err
	}
	next := catalog.Repositories[:0]
	deleted := false
	for _, repo := range catalog.Repositories {
		if repo.ID == id {
			deleted = true
			continue
		}
		next = append(next, repo)
	}
	if !deleted {
		return fmt.Errorf("repository not found: %s", id)
	}
	catalog.Repositories = next
	return m.writeCatalog(catalog)
}

func (m *Manager) ListRepositoryRefs(ctx context.Context, id string) ([]model.RepositoryRef, error) {
	repo, err := m.repositoryByID(id)
	if err != nil {
		return nil, err
	}
	repoDir, err := m.ensureGitMirror(ctx, repo.URL, false)
	if err != nil {
		return nil, err
	}
	return listGitRefs(ctx, repoDir)
}

func (m *Manager) SyncRepository(ctx context.Context, id string) (*model.RepositorySyncResponse, error) {
	repo, err := m.repositoryByID(id)
	if err != nil {
		return nil, err
	}
	repoDir, err := m.ensureGitMirror(ctx, repo.URL, true)
	if err != nil {
		_, _ = m.updateRepositorySyncState(id, "", err.Error())
		return nil, err
	}
	refs, err := listGitRefs(ctx, repoDir)
	if err != nil {
		_, _ = m.updateRepositorySyncState(id, "", err.Error())
		return nil, err
	}
	repo, err = m.updateRepositorySyncState(id, time.Now().Format(time.RFC3339), "")
	if err != nil {
		return nil, err
	}
	return &model.RepositorySyncResponse{Status: "ok", Repository: repo, Refs: refs}, nil
}

func (m *Manager) Resolve(ctx context.Context, source model.RepoSource) (*Workspace, error) {
	if source.Type == "" && source.Path != "" {
		source.Type = "local"
	}
	switch source.Type {
	case "local":
		return m.resolveLocal(ctx, source)
	case "git":
		return m.resolveGit(ctx, source)
	default:
		return nil, fmt.Errorf("unsupported source type %q", source.Type)
	}
}

func (m *Manager) ResolveLocalRef(ctx context.Context, source model.RepoSource, ref string) (*Workspace, error) {
	if ref == "" {
		return m.Resolve(ctx, source)
	}
	workspace, err := m.resolveLocal(ctx, source)
	if err != nil {
		return nil, err
	}
	repoPath := workspace.Path
	moduleRel := ""
	if root, prefix, ok := localGitRootAndPrefix(ctx, workspace.Path); ok {
		repoPath = root
		moduleRel = prefix
	}
	commit, err := resolveCommit(ctx, repoPath, ref)
	if err != nil {
		return nil, err
	}
	sourceHash := hashString(workspace.Path)
	worktree := filepath.Join(m.baseDir, "local-worktrees", sourceHash, hashString(ref))
	_ = runGit(ctx, repoPath, "worktree", "remove", "--force", worktree)
	if err := os.RemoveAll(worktree); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(worktree), 0o755); err != nil {
		return nil, err
	}
	if err := runGit(ctx, repoPath, "worktree", "add", "--detach", "--force", worktree, commit); err != nil {
		return nil, err
	}
	selectedWorktreePath := worktree
	if moduleRel != "" {
		selectedWorktreePath = filepath.Join(worktree, moduleRel)
	}
	key := hashString("local-ref|" + workspace.Path + "|" + ref + "|" + commit + "|" + analyzerVersion)
	source.Path = selectedWorktreePath
	source.Ref = ref
	return &Workspace{Path: selectedWorktreePath, Commit: commit, CacheKey: key, Source: source}, nil
}

func (m *Manager) resolveLocal(ctx context.Context, source model.RepoSource) (*Workspace, error) {
	if source.Path == "" {
		return nil, errors.New("local source path is required")
	}
	absPath, err := filepath.Abs(source.Path)
	if err != nil {
		return nil, err
	}
	if isSensitiveRoot(absPath) {
		return nil, fmt.Errorf("refuse to scan sensitive root: %s", absPath)
	}
	info, err := os.Stat(absPath)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("local source is not a directory: %s", absPath)
	}
	if _, err := os.Stat(filepath.Join(absPath, "go.mod")); err != nil {
		return nil, fmt.Errorf("local source must contain go.mod: %w", err)
	}
	if size, err := repoSize(absPath); err != nil {
		return nil, err
	} else if size > maxRepoSizeBytes {
		return nil, fmt.Errorf("repository size exceeds limit: %d", size)
	}

	commit, dirty := localGitState(ctx, absPath)
	if commit == "" {
		commit = hashFileMetadata(absPath)
	}
	key := hashString("local|" + absPath + "|" + commit + "|" + dirty + "|" + analyzerVersion)
	source.Path = absPath
	return &Workspace{Path: absPath, Commit: commit, CacheKey: key, Source: source}, nil
}

func resolveCommit(ctx context.Context, repoPath string, ref string) (string, error) {
	for _, candidate := range refCandidates(ref) {
		commit, err := gitOutput(ctx, repoPath, "rev-parse", "--verify", candidate+"^{commit}")
		if err == nil {
			return strings.TrimSpace(commit), nil
		}
	}
	current, _ := gitOutput(ctx, repoPath, "branch", "--show-current")
	current = strings.TrimSpace(current)
	if current != "" {
		return "", fmt.Errorf("git ref %q not found in %s; current branch is %q", ref, repoPath, current)
	}
	return "", fmt.Errorf("git ref %q not found in %s", ref, repoPath)
}

func refCandidates(ref string) []string {
	candidates := []string{ref}
	if !strings.HasPrefix(ref, "origin/") {
		candidates = append(candidates, "origin/"+ref)
	}
	return candidates
}

func (m *Manager) resolveGit(ctx context.Context, source model.RepoSource) (*Workspace, error) {
	if source.URL == "" {
		return nil, errors.New("git source url is required")
	}
	requestedRef := source.Ref
	source.URL = normalizeGitURL(source.URL)
	sourceHash := hashString(source.URL)
	repoDir := filepath.Join(m.baseDir, "repos", sourceHash, "repo.git")
	if _, err := os.Stat(repoDir); errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(filepath.Dir(repoDir), 0o755); err != nil {
			return nil, err
		}
		if err := runGit(ctx, "", "clone", "--bare", source.URL, repoDir); err != nil {
			return nil, err
		}
	} else if err != nil {
		return nil, err
	} else {
		if err := fetchGitHeads(ctx, repoDir); err != nil {
			return nil, err
		}
	}
	ref := requestedRef
	if ref == "" || ref == "HEAD" {
		resolvedRef, err := defaultGitRef(ctx, repoDir)
		if err != nil {
			return nil, err
		}
		ref = resolvedRef
	}
	commit, err := resolveBareCommit(ctx, repoDir, ref)
	if err != nil {
		if fetchErr := fetchGitHeads(ctx, repoDir); fetchErr != nil {
			return nil, fetchErr
		}
		commit, err = resolveBareCommit(ctx, repoDir, ref)
		if err != nil {
			return nil, err
		}
	}
	worktree := filepath.Join(m.baseDir, "repos", sourceHash, "worktree", hashString(ref))
	_ = runGit(ctx, repoDir, "worktree", "remove", "--force", worktree)
	if err := os.RemoveAll(worktree); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(worktree), 0o755); err != nil {
		return nil, err
	}
	if err := runGit(ctx, repoDir, "worktree", "add", "--detach", "--force", worktree, commit); err != nil {
		return nil, err
	}
	key := hashString("git|" + source.URL + "|" + ref + "|" + commit + "|" + analyzerVersion)
	source.Ref = ref
	return &Workspace{Path: worktree, Commit: commit, CacheKey: key, Source: source}, nil
}

func (m *Manager) repositoryByID(id string) (model.ManagedRepository, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		return model.ManagedRepository{}, errors.New("repository id is required")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	catalog, err := m.readCatalog()
	if err != nil {
		return model.ManagedRepository{}, err
	}
	for _, repo := range catalog.Repositories {
		if repo.ID == id {
			return repo, nil
		}
	}
	return model.ManagedRepository{}, fmt.Errorf("repository not found: %s", id)
}

func (m *Manager) updateRepositorySyncState(id string, syncedAt string, syncError string) (model.ManagedRepository, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	catalog, err := m.readCatalog()
	if err != nil {
		return model.ManagedRepository{}, err
	}
	for i := range catalog.Repositories {
		if catalog.Repositories[i].ID == id {
			catalog.Repositories[i].LastSyncAt = syncedAt
			catalog.Repositories[i].LastSyncError = syncError
			if err := m.writeCatalog(catalog); err != nil {
				return model.ManagedRepository{}, err
			}
			return catalog.Repositories[i], nil
		}
	}
	return model.ManagedRepository{}, fmt.Errorf("repository not found: %s", id)
}

func (m *Manager) ensureGitMirror(ctx context.Context, url string, fetch bool) (string, error) {
	url = normalizeGitURL(url)
	if url == "" {
		return "", errors.New("repository url is required")
	}
	repoDir := filepath.Join(m.baseDir, "repos", hashString(url), "repo.git")
	if _, err := os.Stat(repoDir); errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(filepath.Dir(repoDir), 0o755); err != nil {
			return "", err
		}
		if err := runGit(ctx, "", "clone", "--bare", url, repoDir); err != nil {
			return "", err
		}
		return repoDir, nil
	} else if err != nil {
		return "", err
	}
	if fetch {
		if err := removeGitWorktrees(ctx, repoDir); err != nil {
			return "", err
		}
		if err := fetchGitHeads(ctx, repoDir); err != nil {
			return "", err
		}
	}
	return repoDir, nil
}

func removeGitWorktrees(ctx context.Context, repoDir string) error {
	output, err := gitOutput(ctx, repoDir, "worktree", "list", "--porcelain")
	if err != nil {
		return err
	}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "worktree ") {
			continue
		}
		worktree := strings.TrimSpace(strings.TrimPrefix(line, "worktree "))
		if worktree == "" || samePath(worktree, repoDir) {
			continue
		}
		info, err := os.Lstat(filepath.Join(worktree, ".git"))
		if err != nil || info.IsDir() {
			continue
		}
		_ = runGit(ctx, repoDir, "worktree", "remove", "--force", worktree)
		if err := os.RemoveAll(worktree); err != nil {
			return err
		}
	}
	return nil
}

func samePath(left string, right string) bool {
	leftAbs, leftErr := filepath.Abs(left)
	rightAbs, rightErr := filepath.Abs(right)
	if leftErr != nil || rightErr != nil {
		return left == right
	}
	if leftReal, err := filepath.EvalSymlinks(leftAbs); err == nil {
		leftAbs = leftReal
	}
	if rightReal, err := filepath.EvalSymlinks(rightAbs); err == nil {
		rightAbs = rightReal
	}
	return leftAbs == rightAbs
}

func listGitRefs(ctx context.Context, repoDir string) ([]model.RepositoryRef, error) {
	output, err := gitOutput(ctx, repoDir, "for-each-ref", "--format=%(refname:short)\t%(objectname)\t%(refname)", "refs/remotes/origin", "refs/heads", "refs/tags")
	if err != nil {
		return nil, err
	}
	refs := []model.RepositoryRef{}
	seen := map[string]bool{}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) != 3 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		commit := strings.TrimSpace(parts[1])
		fullRef := strings.TrimSpace(parts[2])
		refType := "branch"
		if strings.HasPrefix(fullRef, "refs/remotes/origin/") {
			name = strings.TrimPrefix(fullRef, "refs/remotes/origin/")
			if name == "HEAD" {
				continue
			}
		} else if strings.HasPrefix(fullRef, "refs/tags/") {
			refType = "tag"
		}
		key := refType + ":" + name
		if name == "" || seen[key] {
			continue
		}
		seen[key] = true
		refs = append(refs, model.RepositoryRef{Name: name, Type: refType, Commit: commit})
	}
	sort.Slice(refs, func(i, j int) bool {
		if refs[i].Type != refs[j].Type {
			return refs[i].Type < refs[j].Type
		}
		return refs[i].Name < refs[j].Name
	})
	return refs, nil
}

func (m *Manager) readCatalog() (repositoryCatalog, error) {
	data, err := os.ReadFile(m.catalogPath())
	if errors.Is(err, os.ErrNotExist) {
		return repositoryCatalog{Repositories: []model.ManagedRepository{}}, nil
	}
	if err != nil {
		return repositoryCatalog{}, err
	}
	var catalog repositoryCatalog
	if err := json.Unmarshal(data, &catalog); err != nil {
		return repositoryCatalog{}, err
	}
	if catalog.Repositories == nil {
		catalog.Repositories = []model.ManagedRepository{}
	}
	return catalog, nil
}

func (m *Manager) writeCatalog(catalog repositoryCatalog) error {
	if err := os.MkdirAll(m.baseDir, 0o755); err != nil {
		return err
	}
	sortRepositories(catalog.Repositories)
	data, err := json.MarshalIndent(catalog, "", "  ")
	if err != nil {
		return err
	}
	tmpPath := m.catalogPath() + ".tmp"
	if err := os.WriteFile(tmpPath, append(data, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmpPath, m.catalogPath())
}

func (m *Manager) catalogPath() string {
	return filepath.Join(m.baseDir, "repositories.json")
}

func sortRepositories(repos []model.ManagedRepository) {
	sort.Slice(repos, func(i, j int) bool {
		if repos[i].Name != repos[j].Name {
			return repos[i].Name < repos[j].Name
		}
		return repos[i].URL < repos[j].URL
	})
}

func nextRepositoryID(repos []model.ManagedRepository, url string) string {
	existing := make(map[string]struct{}, len(repos))
	for _, repo := range repos {
		existing[repo.ID] = struct{}{}
	}
	for i := 0; ; i++ {
		id := hashString(fmt.Sprintf("repo|%s|%d|%d", url, time.Now().UnixNano(), i))[:16]
		if _, ok := existing[id]; !ok {
			return id
		}
	}
}

func repositoryNameFromURL(url string) string {
	value := strings.TrimRight(strings.TrimSpace(url), "/")
	if value == "" {
		return ""
	}
	if strings.HasSuffix(value, ".git") {
		value = strings.TrimSuffix(value, ".git")
	}
	if index := strings.LastIndex(value, "/"); index >= 0 {
		value = value[index+1:]
	}
	if index := strings.LastIndex(value, ":"); index >= 0 {
		value = value[index+1:]
	}
	return strings.TrimSpace(value)
}

func validRepositoryID(id string) bool {
	for _, item := range id {
		if item >= 'a' && item <= 'z' || item >= 'A' && item <= 'Z' || item >= '0' && item <= '9' || item == '-' || item == '_' {
			continue
		}
		return false
	}
	return true
}

func defaultGitRef(ctx context.Context, repoDir string) (string, error) {
	ref, err := gitOutput(ctx, repoDir, "symbolic-ref", "--short", "HEAD")
	if err == nil {
		ref = strings.TrimSpace(ref)
		if ref != "" && bareRefExists(ctx, repoDir, ref) {
			return strings.TrimPrefix(ref, "refs/heads/"), nil
		}
	}
	remote, err := gitOutput(ctx, repoDir, "remote", "show", "origin")
	if err == nil {
		for _, line := range strings.Split(remote, "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "HEAD branch:") {
				branch := strings.TrimSpace(strings.TrimPrefix(line, "HEAD branch:"))
				if branch != "" && branch != "(unknown)" && bareRefExists(ctx, repoDir, branch) {
					return branch, nil
				}
			}
		}
	}
	for _, branch := range []string{"main", "master"} {
		if bareRefExists(ctx, repoDir, branch) {
			return branch, nil
		}
	}
	return "", fmt.Errorf("default git branch not found in %s", repoDir)
}

func fetchGitHeads(ctx context.Context, repoDir string) error {
	return runGit(ctx, repoDir, "fetch", "origin", "+refs/heads/*:refs/remotes/origin/*", "--tags", "--prune")
}

func bareRefExists(ctx context.Context, repoDir string, ref string) bool {
	_, err := resolveBareCommit(ctx, repoDir, ref)
	return err == nil
}

func resolveBareCommit(ctx context.Context, repoDir string, ref string) (string, error) {
	candidates := []string{ref}
	if strings.HasPrefix(ref, "origin/") {
		branch := strings.TrimPrefix(ref, "origin/")
		candidates = append(candidates, "refs/remotes/origin/"+branch, "refs/heads/"+branch)
	}
	if !strings.HasPrefix(ref, "refs/") {
		candidates = append(candidates, "refs/remotes/origin/"+ref, "refs/heads/"+ref, "refs/tags/"+ref)
	}
	seen := map[string]bool{}
	for _, candidate := range candidates {
		if candidate == "" || seen[candidate] {
			continue
		}
		seen[candidate] = true
		commit, err := gitOutput(ctx, repoDir, "rev-parse", "--verify", candidate+"^{commit}")
		if err == nil {
			return strings.TrimSpace(commit), nil
		}
	}
	return "", fmt.Errorf("git ref %q not found after fetch", ref)
}

func localGitState(ctx context.Context, path string) (string, string) {
	inside, err := gitOutput(ctx, path, "rev-parse", "--is-inside-work-tree")
	if err != nil || strings.TrimSpace(inside) != "true" {
		return "", ""
	}
	commit, err := gitOutput(ctx, path, "rev-parse", "HEAD")
	if err != nil {
		return "", ""
	}
	status, _ := gitOutput(ctx, path, "status", "--porcelain")
	diff, _ := gitOutput(ctx, path, "diff")
	untracked := hashUntrackedGoFiles(path, status)
	dirty := ""
	if strings.TrimSpace(status) != "" || strings.TrimSpace(diff) != "" || untracked != "" {
		dirty = hashString(status + "\n" + diff + "\n" + untracked)
	}
	return strings.TrimSpace(commit), dirty
}

func localGitRootAndPrefix(ctx context.Context, path string) (string, string, bool) {
	root, err := gitOutput(ctx, path, "rev-parse", "--show-toplevel")
	if err != nil {
		return "", "", false
	}
	root = strings.TrimSpace(root)
	if root == "" {
		return "", "", false
	}
	prefix, _ := gitOutput(ctx, path, "rev-parse", "--show-prefix")
	prefix = strings.Trim(strings.TrimSpace(filepath.FromSlash(prefix)), string(os.PathSeparator))
	return root, prefix, true
}

func hashFileMetadata(root string) string {
	var parts []string
	_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if entry.IsDir() {
			if entry.Name() == "vendor" || entry.Name() == ".git" || entry.Name() == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(entry.Name(), ".go") && entry.Name() != "go.mod" {
			return nil
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return nil
		}
		sum, err := hashFile(path)
		if err != nil {
			return nil
		}
		parts = append(parts, fmt.Sprintf("%s:%s", filepath.ToSlash(rel), sum))
		return nil
	})
	sort.Strings(parts)
	return hashString(strings.Join(parts, "\n"))
}

func isSensitiveRoot(path string) bool {
	clean := filepath.Clean(path)
	home, _ := os.UserHomeDir()
	sensitive := []string{"/", "/Users", "/System", "/Applications"}
	if home != "" {
		sensitive = append(sensitive, home)
	}
	for _, item := range sensitive {
		if clean == filepath.Clean(item) {
			return true
		}
	}
	return false
}

func repoSize(root string) (int64, error) {
	var total int64
	err := filepath.WalkDir(root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			name := entry.Name()
			if name == ".git" || name == "vendor" || name == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		total += info.Size()
		if total > maxRepoSizeBytes {
			return filepath.SkipAll
		}
		return nil
	})
	return total, err
}

func hashUntrackedGoFiles(root string, status string) string {
	var parts []string
	for _, line := range strings.Split(status, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "?? ") {
			continue
		}
		rel := strings.TrimSpace(strings.TrimPrefix(line, "?? "))
		if !strings.HasSuffix(rel, ".go") && rel != "go.mod" {
			continue
		}
		sum, err := hashFile(filepath.Join(root, rel))
		if err != nil {
			continue
		}
		parts = append(parts, filepath.ToSlash(rel)+":"+sum)
	}
	sort.Strings(parts)
	return strings.Join(parts, "\n")
}

func hashFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hasher := sha256.New()
	if _, err := io.Copy(hasher, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

func normalizeGitURL(url string) string {
	return strings.TrimRight(strings.TrimSpace(url), "/")
}

func gitOutput(ctx context.Context, dir string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	data, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func runGit(ctx context.Context, dir string, args ...string) error {
	cmd := exec.CommandContext(ctx, "git", args...)
	if dir != "" {
		cmd.Dir = dir
	}
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("git %s failed: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return nil
}

func hashString(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
