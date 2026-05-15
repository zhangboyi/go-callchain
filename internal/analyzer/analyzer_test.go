package analyzer_test

import (
	"context"
	"path/filepath"
	"testing"

	"go-callchain-service/internal/analyzer"
	"go-callchain-service/internal/graph"
	"go-callchain-service/internal/model"
)

func TestAnalyzerBuildsGinRouteAndCallChain(t *testing.T) {
	repoPath := filepath.Join("..", "..", "testdata", "tcmmini")

	result, err := analyzer.New().Analyze(context.Background(), repoPath)
	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}

	var routeHandler string
	for _, route := range result.Routes {
		if route.Method == "POST" && route.Path == "/tcm/api/v1/testcase_plans" {
			routeHandler = route.Handler
			break
		}
	}
	if routeHandler != "tcmmini/app/tcm/controller.(TestcasePlanController).Create" {
		t.Fatalf("route handler = %q", routeHandler)
	}

	tree := graph.BuildCallTree(result, routeHandler, 8)
	if !treeContains(tree, "tcmmini/app/tcm/view.(TestcasePlanViewImpl).Create") {
		t.Fatalf("call tree missing view create: %#v", tree)
	}
	if !treeContains(tree, "tcmmini/service.(TestcasePlanServiceImpl).Create") {
		t.Fatalf("call tree missing service create: %#v", tree)
	}
}

func TestAnalyzerAccurateModeAddsInterfaceDispatchEdges(t *testing.T) {
	repoPath := filepath.Join("..", "..", "testdata", "accuratemini")

	result, err := analyzer.New(analyzer.Options{Mode: model.AnalyzeModeAccurate}).Analyze(context.Background(), repoPath)
	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}
	if result.Mode != model.AnalyzeModeAccurate {
		t.Fatalf("result mode = %q, want %q", result.Mode, model.AnalyzeModeAccurate)
	}

	tree := graph.BuildCallTree(result, "accuratemini.Run", 8)
	if !treeContains(tree, "accuratemini.(Impl).Do") {
		t.Fatalf("accurate call tree missing interface implementation: %#v", tree)
	}
	edge := edgeByCallee(result.Edges, "accuratemini.(Impl).Do")
	if edge == nil {
		t.Fatalf("missing edge to accurate implementation")
	}
	if edge.Confidence != "uncertain" {
		t.Fatalf("edge confidence = %q, want uncertain", edge.Confidence)
	}
	assertUniqueCallerCalleePairs(t, result.Edges)
}

func TestAnalyzerBuildsReceiverRouterRoutes(t *testing.T) {
	repoPath := filepath.Join("..", "..", "testdata", "receiverroutes")

	result, err := analyzer.New().Analyze(context.Background(), repoPath)
	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}

	var routeHandler string
	for _, route := range result.Routes {
		if route.Method == "POST" && route.Path == "/api/admin/items/create" {
			routeHandler = route.Handler
			break
		}
	}
	if routeHandler != "receiverroutes/handler.(ItemHandler).Create" {
		t.Fatalf("route handler = %q", routeHandler)
	}
}

func TestAnalyzerBuildsConstSelectorEmbeddedRoutes(t *testing.T) {
	repoPath := filepath.Join("..", "..", "testdata", "constselectorroutes")

	result, err := analyzer.New().Analyze(context.Background(), repoPath)
	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}

	var routeHandler string
	for _, route := range result.Routes {
		if route.Method == "POST" && route.Path == "/ops/v1/recurring_mission/mission/list" {
			routeHandler = route.Handler
			break
		}
	}
	if routeHandler != "constselectorroutes/recurring.(Ops).ListMission" {
		t.Fatalf("route handler = %q", routeHandler)
	}
}

func TestAnalyzerBuildsPackageFunctionAndRootEngineRoutes(t *testing.T) {
	repoPath := filepath.Join("..", "..", "testdata", "packagefunctionroutes")

	result, err := analyzer.New().Analyze(context.Background(), repoPath)
	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}

	assertRouteHandler(t, result.Routes, "GET", "/ping", "packagefunctionroutes/service.Ping")
	assertRouteHandler(t, result.Routes, "GET", "/api/v1/items", "packagefunctionroutes/service.ListItems")
	assertRouteHandler(t, result.Routes, "POST", "/api/v1/items", "packagefunctionroutes/router.createItem")
}

func TestAnalyzerBuildsPackageVarReceiverCallEdges(t *testing.T) {
	repoPath := filepath.Join("..", "..", "testdata", "packagevarmethods")

	result, err := analyzer.New().Analyze(context.Background(), repoPath)
	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}

	handler := "packagevarmethods/controller.CreateProgram"
	assertRouteHandler(t, result.Routes, "POST", "/program/create", handler)

	tree := graph.BuildCallTree(result, handler, 8)
	if !treeContains(tree, "packagevarmethods/controller.(ProgramService).CreateProgram") {
		t.Fatalf("call tree missing package var receiver method: %#v", tree)
	}
	if !treeContains(tree, "packagevarmethods/controller.(CreateRequest).Validate") {
		t.Fatalf("call tree missing local var receiver method: %#v", tree)
	}

	edge := edgeByCallerCallee(result.Edges, handler, "packagevarmethods/controller.(ProgramService).CreateProgram")
	if edge == nil {
		t.Fatalf("missing package var receiver edge")
	}
	if edge.Source != "package_variable" {
		t.Fatalf("edge source = %q, want package_variable", edge.Source)
	}
}

func TestAnalyzerBuildsCallbackMethodValueEdges(t *testing.T) {
	repoPath := filepath.Join("..", "..", "testdata", "callbackservice")

	result, err := analyzer.New().Analyze(context.Background(), repoPath)
	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}

	handler := "callbackservice/controller.(CaseController).Download"
	assertRouteHandler(t, result.Routes, "POST", "/case/download", handler)

	tree := graph.BuildCallTree(result, handler, 8)
	if !treeContains(tree, "callbackservice/controller.(CaseServiceImpl).Download") {
		t.Fatalf("call tree missing callback service method: %#v", tree)
	}
	if !treeContains(tree, "callbackservice/controller.save") {
		t.Fatalf("call tree missing callback service child call: %#v", tree)
	}

	edge := edgeByCallerCallee(result.Edges, handler, "callbackservice/controller.(CaseServiceImpl).Download")
	if edge == nil {
		t.Fatalf("missing callback method value edge")
	}
	if edge.Source != "interface_method_inference" {
		t.Fatalf("edge source = %q, want interface_method_inference", edge.Source)
	}
}

func TestAnalyzerBuildsSwaggerCommentRoutes(t *testing.T) {
	repoPath := filepath.Join("..", "..", "testdata", "commentroutes")

	result, err := analyzer.New().Analyze(context.Background(), repoPath)
	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}

	var routeHandler string
	for _, route := range result.Routes {
		if route.Method == "GET" && route.Path == "/api/v1/items" {
			routeHandler = route.Handler
			break
		}
	}
	if routeHandler != "commentroutes.(Controller).ListItems" {
		t.Fatalf("route handler = %q", routeHandler)
	}
}

func TestAnalyzerBuildsXProtoMetadataRoutes(t *testing.T) {
	repoPath := filepath.Join("..", "..", "testdata", "xprotoroutes")

	result, err := analyzer.New().Analyze(context.Background(), repoPath)
	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}

	if !hasRoute(result.Routes, "GET", "/ops/v1/ping") {
		t.Fatalf("missing xproto route GET /ops/v1/ping")
	}
	if !hasRoute(result.Routes, "POST", "/ops/v1/mission/list") {
		t.Fatalf("missing xproto route POST /ops/v1/mission/list")
	}
}

func TestAnalyzerBuildsOpenAPIMetadataRoutes(t *testing.T) {
	repoPath := filepath.Join("..", "..", "testdata", "openapiroutes")

	result, err := analyzer.New().Analyze(context.Background(), repoPath)
	if err != nil {
		t.Fatalf("Analyze() error = %v", err)
	}

	if !hasRoute(result.Routes, "GET", "/api/v1/items") {
		t.Fatalf("missing OpenAPI route GET /api/v1/items")
	}
	if !hasRoute(result.Routes, "POST", "/api/v1/items") {
		t.Fatalf("missing OpenAPI route POST /api/v1/items")
	}
	if !hasRoute(result.Routes, "DELETE", "/api/v1/items/{id}") {
		t.Fatalf("missing OpenAPI route DELETE /api/v1/items/{id}")
	}
}

func treeContains(node graph.CallTreeNode, function string) bool {
	if node.Function == function {
		return true
	}
	for _, child := range node.Children {
		if treeContains(child, function) {
			return true
		}
	}
	return false
}

func edgeByCallee(edges []model.Edge, callee string) *model.Edge {
	for _, edge := range edges {
		if edge.Callee == callee {
			return &edge
		}
	}
	return nil
}

func edgeByCallerCallee(edges []model.Edge, caller string, callee string) *model.Edge {
	for _, edge := range edges {
		if edge.Caller == caller && edge.Callee == callee {
			return &edge
		}
	}
	return nil
}

func hasRoute(routes []model.Route, method string, path string) bool {
	for _, route := range routes {
		if route.Method == method && route.Path == path {
			return true
		}
	}
	return false
}

func assertRouteHandler(t *testing.T, routes []model.Route, method string, path string, handler string) {
	t.Helper()
	for _, route := range routes {
		if route.Method == method && route.Path == path {
			if route.Handler != handler {
				t.Fatalf("%s %s handler = %q, want %q", method, path, route.Handler, handler)
			}
			return
		}
	}
	t.Fatalf("missing route %s %s", method, path)
}

func assertUniqueCallerCalleePairs(t *testing.T, edges []model.Edge) {
	t.Helper()
	seen := map[string]bool{}
	for _, edge := range edges {
		key := edge.Caller + ">" + edge.Callee
		if seen[key] {
			t.Fatalf("duplicate edge pair %s", key)
		}
		seen[key] = true
	}
}
