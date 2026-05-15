package api_test

import (
	"bytes"
	"encoding/json"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go-callchain-service/internal/api"
	"go-callchain-service/internal/model"
	"go-callchain-service/internal/service"
)

func TestAnalyzeRoutesAndCallchainAPI(t *testing.T) {
	manager := service.New(service.Options{BaseDir: t.TempDir()})
	router := api.NewRouter(manager)
	repoPath := filepath.Join("..", "..", "testdata", "tcmmini")

	taskID := postAnalyze(t, router, repoPath)
	waitForDone(t, router, taskID)

	routesReq := httptest.NewRequest(http.MethodGet, "/api/v1/routes?task_id="+taskID, nil)
	routesRec := httptest.NewRecorder()
	router.ServeHTTP(routesRec, routesReq)
	if routesRec.Code != http.StatusOK {
		t.Fatalf("routes status = %d, body = %s", routesRec.Code, routesRec.Body.String())
	}
	var routesResp struct {
		Routes []model.Route `json:"routes"`
	}
	if err := json.Unmarshal(routesRec.Body.Bytes(), &routesResp); err != nil {
		t.Fatalf("decode routes response: %v", err)
	}
	if len(routesResp.Routes) != 1 || routesResp.Routes[0].Path != "/tcm/api/v1/testcase_plans" {
		t.Fatalf("routes = %#v", routesResp.Routes)
	}

	body := bytes.NewBufferString(`{"task_id":"` + taskID + `","method":"POST","path":"/tcm/api/v1/testcase_plans","depth":8}`)
	callReq := httptest.NewRequest(http.MethodPost, "/api/v1/callchain/interface", body)
	callReq.Header.Set("Content-Type", "application/json")
	callRec := httptest.NewRecorder()
	router.ServeHTTP(callRec, callReq)
	if callRec.Code != http.StatusOK {
		t.Fatalf("callchain status = %d, body = %s", callRec.Code, callRec.Body.String())
	}
	if !bytes.Contains(callRec.Body.Bytes(), []byte("tcmmini/app/tcm/view.(TestcasePlanViewImpl).Create")) {
		t.Fatalf("callchain missing view: %s", callRec.Body.String())
	}
	if !bytes.Contains(callRec.Body.Bytes(), []byte("tcmmini/service.(TestcasePlanServiceImpl).Create")) {
		t.Fatalf("callchain missing service: %s", callRec.Body.String())
	}
}

func TestRoutesReturnEmptyArrayWhenRepoHasNoRoutes(t *testing.T) {
	repoPath := t.TempDir()
	if err := os.WriteFile(filepath.Join(repoPath, "go.mod"), []byte("module noroutes\n\ngo 1.25\n"), 0o644); err != nil {
		t.Fatalf("write go.mod: %v", err)
	}
	if err := os.WriteFile(filepath.Join(repoPath, "main.go"), []byte("package noroutes\n\nfunc Work() {}\n"), 0o644); err != nil {
		t.Fatalf("write main.go: %v", err)
	}

	manager := service.New(service.Options{BaseDir: t.TempDir()})
	router := api.NewRouter(manager)
	taskID := postAnalyze(t, router, repoPath)
	waitForDone(t, router, taskID)

	routesReq := httptest.NewRequest(http.MethodGet, "/api/v1/routes?task_id="+taskID, nil)
	routesRec := httptest.NewRecorder()
	router.ServeHTTP(routesRec, routesReq)
	if routesRec.Code != http.StatusOK {
		t.Fatalf("routes status = %d, body = %s", routesRec.Code, routesRec.Body.String())
	}
	if !bytes.Contains(routesRec.Body.Bytes(), []byte(`"routes":[]`)) {
		t.Fatalf("routes should be empty array: %s", routesRec.Body.String())
	}
}

func TestFunctionCallchainAPI(t *testing.T) {
	manager := service.New(service.Options{BaseDir: t.TempDir()})
	router := api.NewRouter(manager)
	repoPath := filepath.Join("..", "..", "testdata", "tcmmini")

	taskID := postAnalyze(t, router, repoPath)
	waitForDone(t, router, taskID)

	body := bytes.NewBufferString(`{"task_id":"` + taskID + `","function":"tcmmini/app/tcm/view.(TestcasePlanViewImpl).Create","depth":8}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/callchain/function", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("function callchain status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("tcmmini/service.(TestcasePlanServiceImpl).Create")) {
		t.Fatalf("function callchain missing service: %s", rec.Body.String())
	}
}

func TestFunctionDetailAPI(t *testing.T) {
	manager := service.New(service.Options{BaseDir: t.TempDir()})
	router := api.NewRouter(manager)
	repoPath := filepath.Join("..", "..", "testdata", "tcmmini")

	taskID := postAnalyze(t, router, repoPath)
	waitForDone(t, router, taskID)

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/functions?task_id="+taskID, nil)
	listRec := httptest.NewRecorder()
	router.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("functions status = %d, body = %s", listRec.Code, listRec.Body.String())
	}
	if !bytes.Contains(listRec.Body.Bytes(), []byte("tcmmini/app/tcm/view.(TestcasePlanViewImpl).Create")) {
		t.Fatalf("functions missing view create: %s", listRec.Body.String())
	}

	detailReq := httptest.NewRequest(http.MethodGet, "/api/v1/functions/detail?task_id="+taskID+"&id=tcmmini/app/tcm/view.(TestcasePlanViewImpl).Create", nil)
	detailRec := httptest.NewRecorder()
	router.ServeHTTP(detailRec, detailReq)
	if detailRec.Code != http.StatusOK {
		t.Fatalf("function detail status = %d, body = %s", detailRec.Code, detailRec.Body.String())
	}
	if !bytes.Contains(detailRec.Body.Bytes(), []byte("incoming_edges")) {
		t.Fatalf("function detail missing incoming edges: %s", detailRec.Body.String())
	}
	if !bytes.Contains(detailRec.Body.Bytes(), []byte("outgoing_edges")) {
		t.Fatalf("function detail missing outgoing edges: %s", detailRec.Body.String())
	}
}

func TestFileTreeAndContentAPI(t *testing.T) {
	manager := service.New(service.Options{BaseDir: t.TempDir()})
	router := api.NewRouter(manager)
	repoPath := filepath.Join("..", "..", "testdata", "tcmmini")

	taskID := postAnalyze(t, router, repoPath)
	waitForDone(t, router, taskID)

	treeReq := httptest.NewRequest(http.MethodGet, "/api/v1/files/tree?task_id="+taskID, nil)
	treeRec := httptest.NewRecorder()
	router.ServeHTTP(treeRec, treeReq)
	if treeRec.Code != http.StatusOK {
		t.Fatalf("files tree status = %d, body = %s", treeRec.Code, treeRec.Body.String())
	}
	var treeResp struct {
		Tree model.FileTreeNode `json:"tree"`
	}
	if err := json.Unmarshal(treeRec.Body.Bytes(), &treeResp); err != nil {
		t.Fatalf("decode file tree response: %v", err)
	}
	if !treeHasFunction(treeResp.Tree, "app/tcm/controller/testcase_plan_controller.go", "tcmmini/app/tcm/controller.(TestcasePlanController).Create") {
		t.Fatalf("file tree missing controller create function: %#v", treeResp.Tree)
	}

	contentReq := httptest.NewRequest(http.MethodGet, "/api/v1/files/content?task_id="+taskID+"&path=app/tcm/controller/testcase_plan_controller.go", nil)
	contentRec := httptest.NewRecorder()
	router.ServeHTTP(contentRec, contentReq)
	if contentRec.Code != http.StatusOK {
		t.Fatalf("file content status = %d, body = %s", contentRec.Code, contentRec.Body.String())
	}
	var contentResp model.FileContentResponse
	if err := json.Unmarshal(contentRec.Body.Bytes(), &contentResp); err != nil {
		t.Fatalf("decode file content response: %v", err)
	}
	if contentResp.Path != "app/tcm/controller/testcase_plan_controller.go" {
		t.Fatalf("content path = %q", contentResp.Path)
	}
	if !strings.Contains(contentResp.Content, "func (co *TestcasePlanController) Create") {
		t.Fatalf("content missing Create function: %s", contentResp.Content)
	}

	traversalReq := httptest.NewRequest(http.MethodGet, "/api/v1/files/content?task_id="+taskID+"&path=../go.mod", nil)
	traversalRec := httptest.NewRecorder()
	router.ServeHTTP(traversalRec, traversalReq)
	if traversalRec.Code != http.StatusBadRequest {
		t.Fatalf("path traversal status = %d, body = %s", traversalRec.Code, traversalRec.Body.String())
	}
}

func TestAnalyzeAccurateModeAPI(t *testing.T) {
	manager := service.New(service.Options{BaseDir: t.TempDir()})
	router := api.NewRouter(manager)
	repoPath := filepath.Join("..", "..", "testdata", "accuratemini")

	fastTaskID := postAnalyzeRequest(t, router, model.AnalyzeRequest{
		Source: model.RepoSource{Type: "local", Path: repoPath},
		Force:  false,
		Mode:   model.AnalyzeModeFast,
	})
	waitForDone(t, router, fastTaskID)
	fastBody := postFunctionCallchain(t, router, fastTaskID, "accuratemini.Run")
	if bytes.Contains(fastBody, []byte("accuratemini.(Impl).Do")) {
		t.Fatalf("fast mode unexpectedly found interface dispatch: %s", string(fastBody))
	}

	accurateTaskID := postAnalyzeRequest(t, router, model.AnalyzeRequest{
		Source: model.RepoSource{Type: "local", Path: repoPath},
		Force:  false,
		Mode:   model.AnalyzeModeAccurate,
	})
	status := waitForDone(t, router, accurateTaskID)
	if status.Mode != model.AnalyzeModeAccurate {
		t.Fatalf("task mode = %q, want %q", status.Mode, model.AnalyzeModeAccurate)
	}
	accurateBody := postFunctionCallchain(t, router, accurateTaskID, "accuratemini.Run")
	if !bytes.Contains(accurateBody, []byte("accuratemini.(Impl).Do")) {
		t.Fatalf("accurate mode missing interface dispatch: %s", string(accurateBody))
	}
}

func TestMRImpactAPI(t *testing.T) {
	repoPath := createImpactRepo(t)
	manager := service.New(service.Options{BaseDir: t.TempDir()})
	router := api.NewRouter(manager)

	payload := `{"source":{"type":"local","path":"` + repoPath + `"},"base":"main","head":"feature","depth":8}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/impact/mr", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("impact status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("tcmmini/service.(TestcasePlanServiceImpl).Create")) {
		t.Fatalf("impact missing changed function: %s", rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("/tcm/api/v1/testcase_plans")) {
		t.Fatalf("impact missing route: %s", rec.Body.String())
	}
	var impactResp model.MRImpactResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &impactResp); err != nil {
		t.Fatalf("decode impact response: %v", err)
	}
	if impactResp.TaskID == "" {
		t.Fatalf("impact task id is empty: %s", rec.Body.String())
	}
	detailReq := httptest.NewRequest(http.MethodGet, "/api/v1/functions/detail?task_id="+impactResp.TaskID+"&id="+impactResp.ChangedFunctions[0].ID, nil)
	detailRec := httptest.NewRecorder()
	router.ServeHTTP(detailRec, detailReq)
	if detailRec.Code != http.StatusOK {
		t.Fatalf("impact function detail status = %d, body = %s", detailRec.Code, detailRec.Body.String())
	}
}

func TestMRImpactLocalSourceAnalyzesHeadRef(t *testing.T) {
	repoPath := createImpactRepo(t)
	runGitCmd(t, repoPath, "checkout", "main")
	manager := service.New(service.Options{BaseDir: t.TempDir()})
	router := api.NewRouter(manager)

	payload := `{"source":{"type":"local","path":"` + repoPath + `"},"base":"main","head":"feature","depth":8}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/impact/mr", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("impact status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("tcmmini/service.(TestcasePlanServiceImpl).Create")) {
		t.Fatalf("impact missing changed function after checking out base: %s", rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("/tcm/api/v1/testcase_plans")) {
		t.Fatalf("impact missing route after checking out base: %s", rec.Body.String())
	}
}

func TestMRImpactLocalSourceUsesSelectedSubmoduleDirectory(t *testing.T) {
	repoPath, modulePath := createImpactSubmoduleRepo(t)
	runGitCmd(t, repoPath, "checkout", "main")
	manager := service.New(service.Options{BaseDir: t.TempDir()})
	router := api.NewRouter(manager)

	payload := `{"source":{"type":"local","path":"` + modulePath + `"},"base":"main","head":"feature","depth":8}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/impact/mr", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("impact status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("tcmmini/service.(TestcasePlanServiceImpl).Create")) {
		t.Fatalf("impact missing changed function from selected module: %s", rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("/tcm/api/v1/testcase_plans")) {
		t.Fatalf("impact missing route from selected module: %s", rec.Body.String())
	}
}

func TestAnalyzeGitSourceAPI(t *testing.T) {
	repoPath := createImpactRepo(t)
	manager := service.New(service.Options{BaseDir: t.TempDir()})
	router := api.NewRouter(manager)

	payload := model.AnalyzeRequest{
		Source: model.RepoSource{Type: "git", URL: repoPath, Ref: "feature"},
		Force:  true,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal analyze request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/analyze", bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("analyze status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp model.AnalyzeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode analyze response: %v", err)
	}
	waitForDone(t, router, resp.TaskID)

	routesReq := httptest.NewRequest(http.MethodGet, "/api/v1/routes?task_id="+resp.TaskID, nil)
	routesRec := httptest.NewRecorder()
	router.ServeHTTP(routesRec, routesReq)
	if routesRec.Code != http.StatusOK {
		t.Fatalf("routes status = %d, body = %s", routesRec.Code, routesRec.Body.String())
	}
	if !bytes.Contains(routesRec.Body.Bytes(), []byte("/tcm/api/v1/testcase_plans")) {
		t.Fatalf("routes missing testcase plan route: %s", routesRec.Body.String())
	}
}

func TestMRImpactGitSourceAPI(t *testing.T) {
	repoPath := createImpactRepo(t)
	manager := service.New(service.Options{BaseDir: t.TempDir()})
	router := api.NewRouter(manager)

	payload := `{"source":{"type":"git","url":"` + repoPath + `"},"base":"main","head":"feature","depth":8}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/impact/mr", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("impact status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("tcmmini/service.(TestcasePlanServiceImpl).Create")) {
		t.Fatalf("impact missing changed function: %s", rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("/tcm/api/v1/testcase_plans")) {
		t.Fatalf("impact missing route: %s", rec.Body.String())
	}
}

func TestManageGitRepositoriesAPI(t *testing.T) {
	repoPath := createImpactRepo(t)
	manager := service.New(service.Options{BaseDir: t.TempDir()})
	router := api.NewRouter(manager)

	createPayload := `{"name":"TCM BE","url":"` + repoPath + `","default_ref":"main"}`
	createReq := httptest.NewRequest(http.MethodPost, "/api/v1/repositories", strings.NewReader(createPayload))
	createReq.Header.Set("Content-Type", "application/json")
	createRec := httptest.NewRecorder()
	router.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusOK {
		t.Fatalf("create repository status = %d, body = %s", createRec.Code, createRec.Body.String())
	}
	var repo model.ManagedRepository
	if err := json.Unmarshal(createRec.Body.Bytes(), &repo); err != nil {
		t.Fatalf("decode repository response: %v", err)
	}
	if repo.ID == "" || repo.Name != "TCM BE" || repo.URL != repoPath || repo.DefaultRef != "main" {
		t.Fatalf("unexpected repository: %#v", repo)
	}

	listReq := httptest.NewRequest(http.MethodGet, "/api/v1/repositories", nil)
	listRec := httptest.NewRecorder()
	router.ServeHTTP(listRec, listReq)
	if listRec.Code != http.StatusOK {
		t.Fatalf("list repositories status = %d, body = %s", listRec.Code, listRec.Body.String())
	}
	if !bytes.Contains(listRec.Body.Bytes(), []byte(`"name":"TCM BE"`)) {
		t.Fatalf("list repositories missing saved repo: %s", listRec.Body.String())
	}

	refsReq := httptest.NewRequest(http.MethodGet, "/api/v1/repositories/"+repo.ID+"/refs", nil)
	refsRec := httptest.NewRecorder()
	router.ServeHTTP(refsRec, refsReq)
	if refsRec.Code != http.StatusOK {
		t.Fatalf("list refs status = %d, body = %s", refsRec.Code, refsRec.Body.String())
	}
	if !bytes.Contains(refsRec.Body.Bytes(), []byte(`"name":"main"`)) || !bytes.Contains(refsRec.Body.Bytes(), []byte(`"name":"feature"`)) {
		t.Fatalf("refs missing expected branches: %s", refsRec.Body.String())
	}

	syncReq := httptest.NewRequest(http.MethodPost, "/api/v1/repositories/"+repo.ID+"/sync", nil)
	syncRec := httptest.NewRecorder()
	router.ServeHTTP(syncRec, syncReq)
	if syncRec.Code != http.StatusOK {
		t.Fatalf("sync repository status = %d, body = %s", syncRec.Code, syncRec.Body.String())
	}
	if !bytes.Contains(syncRec.Body.Bytes(), []byte(`"status":"ok"`)) {
		t.Fatalf("sync repository missing ok status: %s", syncRec.Body.String())
	}

	deleteReq := httptest.NewRequest(http.MethodDelete, "/api/v1/repositories/"+repo.ID, nil)
	deleteRec := httptest.NewRecorder()
	router.ServeHTTP(deleteRec, deleteReq)
	if deleteRec.Code != http.StatusNoContent {
		t.Fatalf("delete repository status = %d, body = %s", deleteRec.Code, deleteRec.Body.String())
	}
}

func TestStaticHosting(t *testing.T) {
	staticDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(staticDir, "index.html"), []byte("<html>callchain</html>"), 0o644); err != nil {
		t.Fatalf("write index: %v", err)
	}
	manager := service.New(service.Options{BaseDir: t.TempDir()})
	router := api.NewRouterWithStatic(manager, staticDir)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("static status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if !bytes.Contains(rec.Body.Bytes(), []byte("callchain")) {
		t.Fatalf("static body = %s", rec.Body.String())
	}
}

func TestVSCodeExtensionDownload(t *testing.T) {
	vsixPath := filepath.Join(t.TempDir(), "go-callchain-vscode-0.1.99.vsix")
	if err := os.WriteFile(vsixPath, []byte("vsix-package"), 0o644); err != nil {
		t.Fatalf("write vsix: %v", err)
	}
	t.Setenv("GO_CALLCHAIN_VSIX_PATH", vsixPath)

	manager := service.New(service.Options{BaseDir: t.TempDir()})
	router := api.NewRouter(manager)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/downloads/vscode-extension", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("download status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != "vsix-package" {
		t.Fatalf("download body = %q", rec.Body.String())
	}
	if !strings.Contains(rec.Header().Get("Content-Disposition"), "go-callchain-vscode-0.1.99.vsix") {
		t.Fatalf("missing download filename header: %s", rec.Header().Get("Content-Disposition"))
	}
}

func postAnalyze(t *testing.T, router http.Handler, repoPath string) string {
	t.Helper()
	return postAnalyzeRequest(t, router, model.AnalyzeRequest{
		Source: model.RepoSource{Type: "local", Path: repoPath},
		Force:  true,
	})
}

func postAnalyzeRequest(t *testing.T, router http.Handler, payload model.AnalyzeRequest) string {
	t.Helper()
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal analyze request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v1/analyze", bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("analyze status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp model.AnalyzeResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode analyze response: %v", err)
	}
	if resp.TaskID == "" {
		t.Fatalf("empty task id")
	}
	return resp.TaskID
}

func waitForDone(t *testing.T, router http.Handler, taskID string) model.TaskStatusResponse {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/analyze/"+taskID, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("task status code = %d, body = %s", rec.Code, rec.Body.String())
		}
		var resp model.TaskStatusResponse
		if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
			t.Fatalf("decode task response: %v", err)
		}
		if resp.Status == "done" {
			return resp
		}
		if resp.Status == "failed" {
			t.Fatalf("task failed: %s", resp.Error)
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("task %s not done before deadline", taskID)
	return model.TaskStatusResponse{}
}

func postFunctionCallchain(t *testing.T, router http.Handler, taskID string, functionID string) []byte {
	t.Helper()
	body := bytes.NewBufferString(`{"task_id":"` + taskID + `","function":"` + functionID + `","depth":8}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/callchain/function", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("function callchain status = %d, body = %s", rec.Code, rec.Body.String())
	}
	return rec.Body.Bytes()
}

func treeHasFunction(node model.FileTreeNode, filePath string, functionID string) bool {
	if node.Type == "function" && node.Path == filePath && node.FunctionID == functionID {
		return true
	}
	for _, child := range node.Children {
		if treeHasFunction(child, filePath, functionID) {
			return true
		}
	}
	return false
}

func createImpactRepo(t *testing.T) string {
	t.Helper()
	src := filepath.Join("..", "..", "testdata", "tcmmini")
	dst := t.TempDir()
	if err := copyTree(src, dst); err != nil {
		t.Fatalf("copy fixture: %v", err)
	}
	runGitCmd(t, dst, "init", "-b", "main")
	runGitCmd(t, dst, "config", "user.email", "test@example.com")
	runGitCmd(t, dst, "config", "user.name", "Test User")
	runGitCmd(t, dst, "add", ".")
	runGitCmd(t, dst, "commit", "-m", "base")
	runGitCmd(t, dst, "checkout", "-b", "feature")

	serviceFile := filepath.Join(dst, "service", "testcase_plan_service.go")
	data, err := os.ReadFile(serviceFile)
	if err != nil {
		t.Fatalf("read service file: %v", err)
	}
	next := strings.Replace(string(data), "return nil", "return context.Canceled", 1)
	if err := os.WriteFile(serviceFile, []byte(next), 0o644); err != nil {
		t.Fatalf("write service file: %v", err)
	}
	runGitCmd(t, dst, "add", ".")
	runGitCmd(t, dst, "commit", "-m", "feature")
	return dst
}

func createImpactSubmoduleRepo(t *testing.T) (string, string) {
	t.Helper()
	src := filepath.Join("..", "..", "testdata", "tcmmini")
	dst := t.TempDir()
	modulePath := filepath.Join(dst, "backend")
	if err := copyTree(src, modulePath); err != nil {
		t.Fatalf("copy fixture: %v", err)
	}
	runGitCmd(t, dst, "init", "-b", "main")
	runGitCmd(t, dst, "config", "user.email", "test@example.com")
	runGitCmd(t, dst, "config", "user.name", "Test User")
	runGitCmd(t, dst, "add", ".")
	runGitCmd(t, dst, "commit", "-m", "base")
	runGitCmd(t, dst, "checkout", "-b", "feature")

	serviceFile := filepath.Join(modulePath, "service", "testcase_plan_service.go")
	data, err := os.ReadFile(serviceFile)
	if err != nil {
		t.Fatalf("read service file: %v", err)
	}
	next := strings.Replace(string(data), "return nil", "return context.Canceled", 1)
	if err := os.WriteFile(serviceFile, []byte(next), 0o644); err != nil {
		t.Fatalf("write service file: %v", err)
	}
	runGitCmd(t, dst, "add", ".")
	runGitCmd(t, dst, "commit", "-m", "feature")
	return dst, modulePath
}

func copyTree(src string, dst string) error {
	return filepath.WalkDir(src, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}

func runGitCmd(t *testing.T, dir string, args ...string) {
	t.Helper()
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v failed: %v: %s", args, err, string(output))
	}
}
