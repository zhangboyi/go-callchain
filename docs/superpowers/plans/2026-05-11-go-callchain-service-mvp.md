# Go Callchain Service MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Go call-chain analysis service that can analyze TCM-BE, list Gin routes, and return the `TestcasePlanController.Create -> TestcasePlanViewImpl.Create -> TestcasePlanServiceImpl.Create` call tree.

**Architecture:** The backend exposes REST APIs over Gin. Repository resolution normalizes local and Git sources into a workspace path, the analyzer scans Go AST into functions, routes, edges, and field-constructor bindings, and the service layer stores async task state in memory with JSON cache on disk. The frontend uses Vite, React, TypeScript, and Ant Design to trigger analysis and inspect route call trees.

**Tech Stack:** Go 1.25, Gin, go/ast, Vite, React, TypeScript, Ant Design.

---

### Task 1: Backend Analyzer Red Test

**Files:**
- Create: `go.mod`
- Create: `internal/analyzer/analyzer_test.go`
- Create: `testdata/tcmmini/go.mod`
- Create: `testdata/tcmmini/app/tcm/router/router.go`
- Create: `testdata/tcmmini/app/tcm/router/testcase_plan_router.go`
- Create: `testdata/tcmmini/app/tcm/controller/testcase_plan_controller.go`
- Create: `testdata/tcmmini/app/tcm/view/testcase_plan_view.go`
- Create: `testdata/tcmmini/service/testcase_plan_service.go`

- [ ] **Step 1: Write the failing analyzer test**

Create a test that calls `analyzer.New().Analyze(ctx, repoPath)` and asserts:
- route `POST /tcm/api/v1/testcase_plans` exists
- route handler is `tcmmini/app/tcm/controller.(TestcasePlanController).Create`
- call tree includes `TestcasePlanViewImpl.Create`
- call tree includes `TestcasePlanServiceImpl.Create`

- [ ] **Step 2: Run the analyzer test to verify red**

Run: `go test ./internal/analyzer -run TestAnalyzerBuildsGinRouteAndCallChain -count=1`
Expected: FAIL because package `internal/analyzer` is not implemented.

### Task 2: AST Analyzer Green

**Files:**
- Create: `internal/model/model.go`
- Create: `internal/analyzer/analyzer.go`
- Create: `internal/graph/graph.go`
- Modify: `internal/analyzer/analyzer_test.go`

- [ ] **Step 1: Implement model types**

Define repo source, function, edge, route, analysis result, call tree, task, and request/response structs with JSON tags used by API and frontend.

- [ ] **Step 2: Implement AST scanning**

Parse all non-vendor Go files, read module path from `go.mod`, collect imports, functions, methods, structs, constructor returns, and constructor field bindings.

- [ ] **Step 3: Implement Gin route extraction**

Resolve `r.Group("/prefix")`, `initX(groupVar)`, router function parameters, controller constructor variables, and `group.POST("/path", co.Create)` style handlers.

- [ ] **Step 4: Implement call edge extraction**

Resolve direct calls, package selector calls, receiver method calls, local constructor method calls, and receiver field constructor method calls with edge source and confidence.

- [ ] **Step 5: Run analyzer test to verify green**

Run: `go test ./internal/analyzer -run TestAnalyzerBuildsGinRouteAndCallChain -count=1`
Expected: PASS.

### Task 3: Async Service And API

**Files:**
- Create: `internal/repository/repository.go`
- Create: `internal/cache/cache.go`
- Create: `internal/service/service.go`
- Create: `internal/api/router.go`
- Create: `cmd/server/main.go`
- Create: `internal/api/router_test.go`

- [ ] **Step 1: Write API red test**

Use `httptest` to call `POST /api/v1/analyze`, poll `GET /api/v1/analyze/:task_id`, call `GET /api/v1/routes?task_id=...`, and call `POST /api/v1/callchain/interface`.

- [ ] **Step 2: Run API test to verify red**

Run: `go test ./internal/api -run TestAnalyzeRoutesAndCallchainAPI -count=1`
Expected: FAIL because API package is not implemented.

- [ ] **Step 3: Implement repository source manager**

Validate local sources with `go.mod`; clone/fetch Git sources under `~/.cache/go-callchain-service/repos/<source-hash>/` using existing user Git credentials.

- [ ] **Step 4: Implement cache store**

Persist and load `AnalysisResult` as JSON under `~/.cache/go-callchain-service/cache/<cache-key>/result.json`.

- [ ] **Step 5: Implement task service**

Create async tasks, update `queued/running/done/failed` state, store result summaries, and expose routes and interface call-chain query by `task_id`.

- [ ] **Step 6: Implement Gin API router**

Expose `GET /health`, `POST /api/v1/analyze`, `GET /api/v1/analyze/:task_id`, `GET /api/v1/routes`, and `POST /api/v1/callchain/interface`.

- [ ] **Step 7: Run API test to verify green**

Run: `go test ./internal/api -run TestAnalyzeRoutesAndCallchainAPI -count=1`
Expected: PASS.

### Task 4: Frontend MVP

**Files:**
- Create: `web/package.json`
- Create: `web/vite.config.ts`
- Create: `web/tsconfig.json`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/api/client.ts`
- Create: `web/src/types.ts`
- Create: `web/src/styles.css`

- [ ] **Step 1: Implement API client**

Create TypeScript request helpers for analyze, task polling, routes, and interface callchain.

- [ ] **Step 2: Implement UI**

Create a single-screen app with source input, Analyze button, task summary, route table, call tree, and raw JSON drawer.

- [ ] **Step 3: Build frontend**

Run: `npm --prefix web install && npm --prefix web run build`
Expected: PASS.

### Task 5: Verification

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run Go tests**

Run: `go test ./...`
Expected: PASS.

- [ ] **Step 2: Run TCM-BE real-repo validation**

Run: `go run ./cmd/server -analyze /Users/boyi.zhang/Work/BizProjects/TCM/TCM-BE -method POST -path /tcm/api/v1/testcase_plans`
Expected output includes:
- `TestcasePlanController.Create`
- `TestcasePlanViewImpl.Create`
- `TestcasePlanServiceImpl.Create`

- [ ] **Step 3: Update README**

Document backend start, frontend start, and the TCM-BE validation command.
