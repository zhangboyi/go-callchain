package cache_test

import (
	"os"
	"path/filepath"
	"testing"

	"go-callchain-service/internal/cache"
	"go-callchain-service/internal/model"
)

func TestStoreWritesSplitFilesAndLoadsResult(t *testing.T) {
	store := cache.NewStore(t.TempDir())
	result := &model.AnalysisResult{
		Module:    "example",
		Workspace: "/tmp/example",
		Commit:    "abc123",
		CacheKey:  "cache-key",
		Functions: []model.Function{{ID: "example.fn", File: "main.go", StartLine: 1, EndLine: 3}},
		Edges:     []model.Edge{{Caller: "example.fn", Callee: "example.next"}},
		Routes:    []model.Route{{Method: "GET", Path: "/ping", Handler: "example.fn"}},
	}

	if err := store.Save("cache-key", result); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	for _, name := range []string{"metadata.json", "functions.json", "edges.json", "routes.json", "line_index.json"} {
		if _, err := os.Stat(filepath.Join(store.Dir(), "cache-key", name)); err != nil {
			t.Fatalf("missing %s: %v", name, err)
		}
	}

	loaded, ok, err := store.Load("cache-key")
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if !ok {
		t.Fatalf("Load() ok = false")
	}
	if loaded.Module != result.Module || len(loaded.Functions) != 1 || len(loaded.Edges) != 1 || len(loaded.Routes) != 1 {
		t.Fatalf("loaded result = %#v", loaded)
	}
}
