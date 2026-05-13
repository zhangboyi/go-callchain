package gitdiff

import (
	"bytes"
	"fmt"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"go-callchain-service/internal/model"
)

type FileChange struct {
	File  string `json:"file"`
	Lines []int  `json:"lines"`
}

var hunkPattern = regexp.MustCompile(`@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@`)

func Diff(repoPath string, base string, head string) ([]FileChange, error) {
	baseCommit, err := resolveRef(repoPath, base)
	if err != nil {
		return nil, err
	}
	headCommit, err := resolveRef(repoPath, head)
	if err != nil {
		return nil, err
	}
	output, err := diffOutput(repoPath, baseCommit+"..."+headCommit)
	if err != nil && isNoMergeBaseError(err) {
		output, err = diffOutput(repoPath, baseCommit+".."+headCommit)
	}
	if err != nil {
		return nil, err
	}
	return Parse(output), nil
}

func diffOutput(repoPath string, rangeSpec string) ([]byte, error) {
	return gitOutput(repoPath, "diff", "--relative", "--unified=0", "--no-color", "--no-ext-diff", rangeSpec)
}

func isNoMergeBaseError(err error) bool {
	return err != nil && strings.Contains(err.Error(), "no merge base")
}

func resolveRef(repoPath string, ref string) (string, error) {
	for _, candidate := range refCandidates(ref) {
		output, err := gitOutput(repoPath, "rev-parse", "--verify", candidate+"^{commit}")
		if err == nil {
			return strings.TrimSpace(string(output)), nil
		}
	}
	return "", fmt.Errorf("git ref %q not found", ref)
}

func refCandidates(ref string) []string {
	candidates := []string{ref}
	if !strings.HasPrefix(ref, "origin/") {
		candidates = append(candidates, "origin/"+ref)
	}
	return candidates
}

func Parse(diff []byte) []FileChange {
	changesByFile := map[string]map[int]bool{}
	currentFile := ""
	scanner := bytes.Split(diff, []byte("\n"))
	for _, rawLine := range scanner {
		line := string(rawLine)
		if strings.HasPrefix(line, "+++ b/") {
			currentFile = filepath.ToSlash(strings.TrimPrefix(line, "+++ b/"))
			if currentFile == "/dev/null" {
				currentFile = ""
			}
			continue
		}
		if currentFile == "" || !strings.HasPrefix(line, "@@ ") {
			continue
		}
		matches := hunkPattern.FindStringSubmatch(line)
		if len(matches) == 0 {
			continue
		}
		start, err := strconv.Atoi(matches[1])
		if err != nil {
			continue
		}
		count := 1
		if matches[2] != "" {
			if parsedCount, err := strconv.Atoi(matches[2]); err == nil {
				count = parsedCount
			}
		}
		if count == 0 {
			count = 1
		}
		lines := changesByFile[currentFile]
		if lines == nil {
			lines = map[int]bool{}
			changesByFile[currentFile] = lines
		}
		for i := 0; i < count; i++ {
			lines[start+i] = true
		}
	}

	changes := make([]FileChange, 0, len(changesByFile))
	for file, linesByNumber := range changesByFile {
		lines := make([]int, 0, len(linesByNumber))
		for line := range linesByNumber {
			lines = append(lines, line)
		}
		sort.Ints(lines)
		changes = append(changes, FileChange{File: file, Lines: lines})
	}
	sort.Slice(changes, func(i, j int) bool { return changes[i].File < changes[j].File })
	return changes
}

func ChangedFunctions(changes []FileChange, functions []model.Function) []model.Function {
	functionsByFile := map[string][]model.Function{}
	for _, function := range functions {
		functionsByFile[function.File] = append(functionsByFile[function.File], function)
	}
	seen := map[string]bool{}
	var changed []model.Function
	for _, change := range changes {
		for _, line := range change.Lines {
			for _, function := range functionsByFile[change.File] {
				if line < function.StartLine || line > function.EndLine || seen[function.ID] {
					continue
				}
				seen[function.ID] = true
				changed = append(changed, function)
			}
		}
	}
	sort.Slice(changed, func(i, j int) bool { return changed[i].ID < changed[j].ID })
	return changed
}

func gitOutput(dir string, args ...string) ([]byte, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("git %s failed: %w: %s", strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return output, nil
}
