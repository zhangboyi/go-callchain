# Go Callchain Service Full Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the non-MVP PRD scope: function callchain, MR impact analysis, reverse graph, function details, production UI panels, backend static hosting, resource limits, cache layout, and Git source hardening.

**Architecture:** Keep AST as the default fast engine and add reverse graph and diff-to-function mapping around the existing `AnalysisResult`. Repository resolution owns local/Git workspace safety, gitdiff owns changed line extraction, graph owns forward/reverse path search, service owns async tasks and query APIs, and the React UI consumes these APIs without re-triggering analysis.

**Tech Stack:** Go 1.25, Gin, go/ast, git CLI, embedded static assets, Vite, React, TypeScript, Ant Design.

---

### Task 1: Function Callchain API

**Files:**
- Modify: `internal/model/model.go`
- Modify: `internal/service/service.go`
- Modify: `internal/api/router.go`
- Modify: `internal/api/router_test.go`
- Modify: `web/src/types.ts`
- Modify: `web/src/api/client.ts`

- [ ] Add `FunctionCallchainRequest`.
- [ ] Add service method `FunctionCallchain`.
- [ ] Add `POST /api/v1/callchain/function`.
- [ ] Add API test using `tcmmini` function `tcmmini/app/tcm/view.(TestcasePlanViewImpl).Create`.
- [ ] Verify: `go test ./internal/api -run TestFunctionCallchainAPI -count=1`.

### Task 2: Reverse Graph And Path Search

**Files:**
- Modify: `internal/graph/graph.go`
- Create: `internal/graph/graph_test.go`

- [ ] Add reverse adjacency builder.
- [ ] Add `FindPathsToRoots(result, targets, routeHandlers, depth)`.
- [ ] Preserve edge metadata on returned path.
- [ ] Verify route -> changed function path search with fixture graph.
- [ ] Verify: `go test ./internal/graph -count=1`.

### Task 3: Git Diff And Changed Function Mapping

**Files:**
- Create: `internal/gitdiff/gitdiff.go`
- Create: `internal/gitdiff/gitdiff_test.go`
- Modify: `internal/model/model.go`

- [ ] Add changed file/line models.
- [ ] Parse `git diff --unified=0 base...head` hunk headers.
- [ ] Map changed lines to `Function.StartLine/EndLine`.
- [ ] Add temp git repo fixture in test.
- [ ] Verify: `go test ./internal/gitdiff -count=1`.

### Task 4: MR Impact Backend

**Files:**
- Modify: `internal/model/model.go`
- Modify: `internal/service/service.go`
- Modify: `internal/api/router.go`
- Modify: `internal/api/router_test.go`
- Modify: `cmd/server/main.go`

- [ ] Add `MRImpactRequest`, `ChangedFunction`, `ImpactedInterface`.
- [ ] Add `POST /api/v1/impact/mr`.
- [ ] Implement local source and git source base/head handling.
- [ ] Output route, chain, changed function, risk.
- [ ] Add CLI one-shot impact command.
- [ ] Verify: `go test ./internal/api -run TestMRImpactAPI -count=1`.

### Task 5: Functions And Details API

**Files:**
- Modify: `internal/model/model.go`
- Modify: `internal/service/service.go`
- Modify: `internal/api/router.go`
- Modify: `internal/api/router_test.go`

- [ ] Add `GET /api/v1/functions?task_id=...`.
- [ ] Add `GET /api/v1/functions/detail?task_id=...&id=...`.
- [ ] Return function metadata, outgoing edges, incoming edges.
- [ ] Verify: `go test ./internal/api -run TestFunctionDetailAPI -count=1`.

### Task 6: Resource Limits And Source Safety

**Files:**
- Create: `internal/config/config.go`
- Modify: `internal/analyzer/analyzer.go`
- Modify: `internal/repository/repository.go`
- Modify: `internal/service/service.go`
- Create: `internal/repository/repository_test.go`

- [ ] Reject sensitive roots: `/`, `/Users`, `/System`, `/Applications`.
- [ ] Enforce max repo size 2GB before analysis.
- [ ] Set analyze timeout 5min in service.
- [ ] Cap callchain depth to 8 by default and max 20.
- [ ] Set max Go files to 10000.
- [ ] Verify: `go test ./internal/repository ./internal/service ./internal/analyzer -count=1`.

### Task 7: Cache And Git Workspace Hardening

**Files:**
- Modify: `internal/cache/cache.go`
- Modify: `internal/repository/repository.go`
- Modify: `internal/cache/cache_test.go`
- Modify: `internal/repository/repository_test.go`

- [ ] Split cache into `functions.json`, `edges.json`, `routes.json`, `line_index.json`, `metadata.json`.
- [ ] Include untracked Go file contents in local dirty hash.
- [ ] Normalize Git URL in cache key.
- [ ] Use `repos/<source-hash>/repo.git` plus `worktree/<ref-or-commit>`.
- [ ] Verify local and git source tests.

### Task 8: Backend Static Hosting

**Files:**
- Modify: `cmd/server/main.go`
- Create: `internal/api/static.go`
- Modify: `internal/api/router.go`
- Modify: `internal/api/router_test.go`

- [ ] Embed `web/dist`.
- [ ] Serve `/` and SPA fallback from backend.
- [ ] Keep `/api/*` and `/health` unchanged.
- [ ] Verify: `go test ./internal/api -run TestStaticHosting -count=1`.

### Task 9: Frontend Full UI

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/types.ts`
- Modify: `web/src/api/client.ts`
- Modify: `web/src/styles.css`

- [ ] Add ImpactPanel with base/head/depth input.
- [ ] Add impacted interfaces table.
- [ ] Add function callchain input.
- [ ] Add FunctionDrawer with metadata, incoming edges, outgoing edges, raw JSON.
- [ ] Add route filtering.
- [ ] Verify: `npm --prefix web run build`.

### Task 10: Final Verification

**Files:**
- Modify: `README.md`
- Create: `examples/tcm-be.http`

- [ ] Run `go test ./...`.
- [ ] Run `npm --prefix web run build`.
- [ ] Run TCM-BE interface callchain validation.
- [ ] Run local MR impact validation against a temp branch fixture.
- [ ] Start backend and verify `http://127.0.0.1:8787` serves UI.
- [ ] Scan placeholders: `rg -n "TO""DO|TB""D|待""分析|省""略|<\\.\\.\\.>" README.md docs internal web/src examples`.
