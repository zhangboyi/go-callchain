package gitdiff_test

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"go-callchain-service/internal/gitdiff"
	"go-callchain-service/internal/model"
)

func TestChangedFunctionsMapsDiffLinesToFunctionRanges(t *testing.T) {
	repo := t.TempDir()
	writeFile(t, repo, "go.mod", "module diffcase\n\ngo 1.25\n")
	writeFile(t, repo, "service.go", `package diffcase

func untouched() string {
	return "same"
}

func changed() string {
	return "before"
}
`)
	runGit(t, repo, "init")
	runGit(t, repo, "config", "user.email", "test@example.com")
	runGit(t, repo, "config", "user.name", "Test User")
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "base")
	baseBranch := strings.TrimSpace(runGitOutput(t, repo, "branch", "--show-current"))
	runGit(t, repo, "checkout", "-b", "feature")
	writeFile(t, repo, "service.go", `package diffcase

func untouched() string {
	return "same"
}

func changed() string {
	return "after"
}
`)
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "feature")

	changes, err := gitdiff.Diff(repo, baseBranch, "feature")
	if err != nil {
		t.Fatalf("Diff() error = %v", err)
	}
	functions := gitdiff.ChangedFunctions(changes, []model.Function{
		{ID: "diffcase.untouched", File: "service.go", StartLine: 3, EndLine: 5},
		{ID: "diffcase.changed", File: "service.go", StartLine: 7, EndLine: 9},
	})

	if len(functions) != 1 {
		t.Fatalf("changed functions = %#v", functions)
	}
	if functions[0].ID != "diffcase.changed" {
		t.Fatalf("changed function = %q", functions[0].ID)
	}
}

func TestDiffFindsRemoteBranchWithSlash(t *testing.T) {
	repo := t.TempDir()
	writeFile(t, repo, "go.mod", "module diffslash\n\ngo 1.25\n")
	writeFile(t, repo, "service.go", `package diffslash

func value() string {
	return "base"
}
`)
	runGit(t, repo, "init", "-b", "main")
	runGit(t, repo, "config", "user.email", "test@example.com")
	runGit(t, repo, "config", "user.name", "Test User")
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "base")
	runGit(t, repo, "checkout", "-b", "team/feature")
	writeFile(t, repo, "service.go", `package diffslash

func value() string {
	return "feature"
}
`)
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "feature")
	featureCommit := strings.TrimSpace(runGitOutput(t, repo, "rev-parse", "HEAD"))
	runGit(t, repo, "checkout", "main")
	runGit(t, repo, "update-ref", "refs/remotes/origin/team/feature", featureCommit)
	runGit(t, repo, "branch", "-D", "team/feature")

	changes, err := gitdiff.Diff(repo, "main", "team/feature")
	if err != nil {
		t.Fatalf("Diff() error = %v", err)
	}
	if len(changes) != 1 || changes[0].File != "service.go" {
		t.Fatalf("changes = %#v", changes)
	}
}

func TestDiffUsesPathsRelativeToSelectedSubdirectory(t *testing.T) {
	repo := t.TempDir()
	app := filepath.Join(repo, "backend")
	writeFile(t, app, "go.mod", "module subdiff\n\ngo 1.25\n")
	writeFile(t, app, "service.go", `package subdiff

func value() string {
	return "base"
}
`)
	runGit(t, repo, "init", "-b", "main")
	runGit(t, repo, "config", "user.email", "test@example.com")
	runGit(t, repo, "config", "user.name", "Test User")
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "base")
	runGit(t, repo, "checkout", "-b", "feature")
	writeFile(t, app, "service.go", `package subdiff

func value() string {
	return "feature"
}
`)
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "feature")

	changes, err := gitdiff.Diff(app, "main", "feature")
	if err != nil {
		t.Fatalf("Diff() error = %v", err)
	}
	if len(changes) != 1 {
		t.Fatalf("changes = %#v", changes)
	}
	if changes[0].File != "service.go" {
		t.Fatalf("change file = %q, want service.go", changes[0].File)
	}
}

func TestDiffFallsBackWhenRefsHaveNoMergeBase(t *testing.T) {
	repo := t.TempDir()
	writeFile(t, repo, "go.mod", "module diffnomergebase\n\ngo 1.25\n")
	writeFile(t, repo, "service.go", `package diffnomergebase

func value() string {
	return "base"
}
`)
	runGit(t, repo, "init", "-b", "main")
	runGit(t, repo, "config", "user.email", "test@example.com")
	runGit(t, repo, "config", "user.name", "Test User")
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "base")
	runGit(t, repo, "checkout", "--orphan", "feature")
	runGit(t, repo, "rm", "-rf", ".")
	writeFile(t, repo, "go.mod", "module diffnomergebase\n\ngo 1.25\n")
	writeFile(t, repo, "service.go", `package diffnomergebase

func value() string {
	return "feature"
}
`)
	runGit(t, repo, "add", ".")
	runGit(t, repo, "commit", "-m", "feature")

	changes, err := gitdiff.Diff(repo, "main", "feature")
	if err != nil {
		t.Fatalf("Diff() error = %v", err)
	}
	if len(changes) != 1 || changes[0].File != "service.go" {
		t.Fatalf("changes = %#v", changes)
	}
}

func writeFile(t *testing.T, root string, name string, content string) {
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
	_ = runGitOutput(t, dir, args...)
}

func runGitOutput(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v failed: %v: %s", args, err, string(output))
	}
	return string(output)
}
