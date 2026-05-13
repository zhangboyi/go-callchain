package repository_test

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"go-callchain-service/internal/model"
	"go-callchain-service/internal/repository"
)

func TestResolveLocalRejectsSensitiveRoots(t *testing.T) {
	manager := repository.NewManager(t.TempDir())
	_, err := manager.Resolve(context.Background(), model.RepoSource{Type: "local", Path: "/"})
	if err == nil {
		t.Fatalf("expected error for root path")
	}
}

func TestResolveLocalDirtyHashIncludesUntrackedGoFileContent(t *testing.T) {
	repo := t.TempDir()
	writeRepoFile(t, repo, "go.mod", "module dirtycase\n\ngo 1.25\n")
	manager := repository.NewManager(t.TempDir())

	first, err := manager.Resolve(context.Background(), model.RepoSource{Type: "local", Path: repo})
	if err != nil {
		t.Fatalf("Resolve() first error = %v", err)
	}
	writeRepoFile(t, repo, "new.go", "package dirtycase\n\nfunc value() string { return \"a\" }\n")
	second, err := manager.Resolve(context.Background(), model.RepoSource{Type: "local", Path: repo})
	if err != nil {
		t.Fatalf("Resolve() second error = %v", err)
	}
	writeRepoFile(t, repo, "new.go", "package dirtycase\n\nfunc value() string { return \"b\" }\n")
	third, err := manager.Resolve(context.Background(), model.RepoSource{Type: "local", Path: repo})
	if err != nil {
		t.Fatalf("Resolve() third error = %v", err)
	}

	if first.CacheKey == second.CacheKey || second.CacheKey == third.CacheKey {
		t.Fatalf("cache keys did not change: %s %s %s", first.CacheKey, second.CacheKey, third.CacheKey)
	}
}

func TestResolveGitDefaultRefReturnsDefaultBranch(t *testing.T) {
	repo := t.TempDir()
	writeRepoFile(t, repo, "go.mod", "module gitcase\n\ngo 1.25\n")
	writeRepoFile(t, repo, "main.go", "package gitcase\n\nfunc main() {}\n")
	runGit(t, repo, "init", "-b", "main")
	runGit(t, repo, "config", "user.email", "test@example.com")
	runGit(t, repo, "config", "user.name", "Test User")
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "base")

	manager := repository.NewManager(t.TempDir())
	workspace, err := manager.Resolve(context.Background(), model.RepoSource{Type: "git", URL: repo})
	if err != nil {
		t.Fatalf("Resolve() error = %v", err)
	}
	if workspace.Source.Ref != "main" {
		t.Fatalf("workspace.Source.Ref = %q, want main", workspace.Source.Ref)
	}
}

func TestResolveGitRepairsCachedBareRepoWithoutHeads(t *testing.T) {
	repo := t.TempDir()
	writeRepoFile(t, repo, "go.mod", "module repaircase\n\ngo 1.25\n")
	writeRepoFile(t, repo, "main.go", "package repaircase\n\nfunc main() {}\n")
	runGit(t, repo, "init", "-b", "master")
	runGit(t, repo, "config", "user.email", "test@example.com")
	runGit(t, repo, "config", "user.name", "Test User")
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "base")

	baseDir := t.TempDir()
	manager := repository.NewManager(baseDir)
	if _, err := manager.Resolve(context.Background(), model.RepoSource{Type: "git", URL: repo}); err != nil {
		t.Fatalf("Resolve() first error = %v", err)
	}

	repoDirs, err := filepath.Glob(filepath.Join(baseDir, "repos", "*", "repo.git"))
	if err != nil || len(repoDirs) != 1 {
		t.Fatalf("repo dirs = %v, err = %v", repoDirs, err)
	}
	repoDir := repoDirs[0]
	runGit(t, repoDir, "update-ref", "-d", "refs/heads/master")
	if err := os.WriteFile(filepath.Join(repoDir, "HEAD"), []byte("ref: refs/heads/.invalid\n"), 0o644); err != nil {
		t.Fatalf("write invalid HEAD: %v", err)
	}
	if err := os.RemoveAll(filepath.Join(filepath.Dir(repoDir), "worktree")); err != nil {
		t.Fatalf("remove worktree: %v", err)
	}

	workspace, err := manager.Resolve(context.Background(), model.RepoSource{Type: "git", URL: repo})
	if err != nil {
		t.Fatalf("Resolve() repaired cache error = %v", err)
	}
	if workspace.Source.Ref != "master" {
		t.Fatalf("workspace.Source.Ref = %q, want master", workspace.Source.Ref)
	}
	if _, err := os.Stat(filepath.Join(workspace.Path, "go.mod")); err != nil {
		t.Fatalf("repaired worktree missing go.mod: %v", err)
	}
}

func TestResolveLocalRefFindsRemoteBranchWithSlash(t *testing.T) {
	repo := t.TempDir()
	writeRepoFile(t, repo, "go.mod", "module slashbranch\n\ngo 1.25\n")
	writeRepoFile(t, repo, "main.go", "package slashbranch\n\nfunc main() {}\n")
	runGit(t, repo, "init", "-b", "master")
	runGit(t, repo, "config", "user.email", "test@example.com")
	runGit(t, repo, "config", "user.name", "Test User")
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "base")
	runGit(t, repo, "checkout", "-b", "team/feature")
	writeRepoFile(t, repo, "feature.go", "package slashbranch\n\nfunc Feature() {}\n")
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "feature")
	featureCommit := gitOutput(t, repo, "rev-parse", "HEAD")
	runGit(t, repo, "checkout", "master")
	runGit(t, repo, "update-ref", "refs/remotes/origin/team/feature", featureCommit)
	runGit(t, repo, "branch", "-D", "team/feature")

	manager := repository.NewManager(t.TempDir())
	workspace, err := manager.ResolveLocalRef(context.Background(), model.RepoSource{Type: "local", Path: repo}, "team/feature")
	if err != nil {
		t.Fatalf("ResolveLocalRef() error = %v", err)
	}
	if workspace.Commit != featureCommit {
		t.Fatalf("workspace.Commit = %q, want %q", workspace.Commit, featureCommit)
	}
}

func TestResolveLocalRefPreservesSelectedSubmoduleDirectory(t *testing.T) {
	repo := t.TempDir()
	app := filepath.Join(repo, "backend")
	writeRepoFile(t, app, "go.mod", "module selectedsubmodule\n\ngo 1.25\n")
	writeRepoFile(t, app, "main.go", "package selectedsubmodule\n\nfunc Value() string { return \"base\" }\n")
	runGit(t, repo, "init", "-b", "main")
	runGit(t, repo, "config", "user.email", "test@example.com")
	runGit(t, repo, "config", "user.name", "Test User")
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "base")
	runGit(t, repo, "checkout", "-b", "feature")
	writeRepoFile(t, app, "main.go", "package selectedsubmodule\n\nfunc Value() string { return \"feature\" }\n")
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "feature")
	runGit(t, repo, "checkout", "main")

	manager := repository.NewManager(t.TempDir())
	workspace, err := manager.ResolveLocalRef(context.Background(), model.RepoSource{Type: "local", Path: app}, "feature")
	if err != nil {
		t.Fatalf("ResolveLocalRef() error = %v", err)
	}
	if filepath.Base(workspace.Path) != "backend" {
		t.Fatalf("workspace.Path = %q, want selected backend subdirectory", workspace.Path)
	}
	if _, err := os.Stat(filepath.Join(workspace.Path, "go.mod")); err != nil {
		t.Fatalf("selected worktree path missing go.mod: %v", err)
	}
}

func TestSyncRepositoryUsesRemoteRefsWhenCachedWorktreeChecksOutBranch(t *testing.T) {
	repo := t.TempDir()
	writeRepoFile(t, repo, "go.mod", "module syncworktree\n\ngo 1.25\n")
	writeRepoFile(t, repo, "main.go", "package syncworktree\n\nfunc main() {}\n")
	runGit(t, repo, "init", "-b", "main")
	runGit(t, repo, "config", "user.email", "test@example.com")
	runGit(t, repo, "config", "user.name", "Test User")
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "base")
	runGit(t, repo, "checkout", "-b", "feature")
	writeRepoFile(t, repo, "feature.go", "package syncworktree\n\nfunc Feature() {}\n")
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "feature")

	baseDir := t.TempDir()
	manager := repository.NewManager(baseDir)
	saved, err := manager.SaveRepository(model.SaveRepositoryRequest{Name: "syncworktree", URL: repo, DefaultRef: "main"})
	if err != nil {
		t.Fatalf("SaveRepository() error = %v", err)
	}
	if _, err := manager.ListRepositoryRefs(context.Background(), saved.ID); err != nil {
		t.Fatalf("ListRepositoryRefs() error = %v", err)
	}
	repoDirs, err := filepath.Glob(filepath.Join(baseDir, "repos", "*", "repo.git"))
	if err != nil || len(repoDirs) != 1 {
		t.Fatalf("repo dirs = %v, err = %v", repoDirs, err)
	}
	legacyWorktree := filepath.Join(baseDir, "legacy-feature-worktree")
	runGit(t, repoDirs[0], "worktree", "add", legacyWorktree, "feature")
	writeRepoFile(t, repo, "feature.go", "package syncworktree\n\nfunc Feature() string { return \"next\" }\n")
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "update feature")

	resp, err := manager.SyncRepository(context.Background(), saved.ID)
	if err != nil {
		t.Fatalf("SyncRepository() error = %v", err)
	}
	if resp.Status != "ok" {
		t.Fatalf("sync status = %q", resp.Status)
	}
	hasFeature := false
	for _, ref := range resp.Refs {
		if ref.Type == "branch" && ref.Name == "feature" {
			hasFeature = true
			break
		}
	}
	if !hasFeature {
		t.Fatalf("feature branch missing from refs: %#v", resp.Refs)
	}
}

func writeRepoFile(t *testing.T, root string, name string, content string) {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func runGit(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v failed: %v: %s", args, err, string(output))
	}
}

func gitOutput(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v failed: %v: %s", args, err, string(output))
	}
	return strings.TrimSpace(string(output))
}
