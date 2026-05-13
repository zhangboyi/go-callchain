package graph_test

import (
	"testing"

	"go-callchain-service/internal/graph"
	"go-callchain-service/internal/model"
)

func TestFindPathsToRootsReturnsRouteToChangedFunction(t *testing.T) {
	result := &model.AnalysisResult{
		Routes: []model.Route{
			{Method: "POST", Path: "/items", Handler: "controller.Create"},
		},
		Edges: []model.Edge{
			{Caller: "controller.Create", Callee: "view.Create", Source: "receiver_method", Confidence: "exact"},
			{Caller: "view.Create", Callee: "service.Create", Source: "struct_field_constructor_inference", Confidence: "inferred"},
			{Caller: "other.Entry", Callee: "service.Create", Source: "receiver_method", Confidence: "exact"},
		},
	}

	paths := graph.FindPathsToRoutes(result, []string{"service.Create"}, 8)
	if len(paths) != 1 {
		t.Fatalf("paths length = %d", len(paths))
	}
	if paths[0].Route.Path != "/items" {
		t.Fatalf("route path = %q", paths[0].Route.Path)
	}
	got := functionsInPath(paths[0].Nodes)
	want := []string{"controller.Create", "view.Create", "service.Create"}
	if len(got) != len(want) {
		t.Fatalf("path = %#v", got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("path[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func functionsInPath(nodes []graph.PathNode) []string {
	values := make([]string, 0, len(nodes))
	for _, node := range nodes {
		values = append(values, node.Function)
	}
	return values
}
