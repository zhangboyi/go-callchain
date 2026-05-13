package api

import (
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"

	"go-callchain-service/internal/model"
	"go-callchain-service/internal/service"
)

func NewRouter(manager *service.Manager) *gin.Engine {
	return NewRouterWithStatic(manager, "")
}

func NewRouterWithStatic(manager *service.Manager, staticDir string) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())

	router.GET("/health", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})
	router.GET("/api/v1/repositories", func(c *gin.Context) {
		repos, err := manager.ListRepositories()
		if err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		if repos == nil {
			repos = []model.ManagedRepository{}
		}
		c.JSON(http.StatusOK, model.RepositoryListResponse{Repositories: repos})
	})
	router.POST("/api/v1/repositories", func(c *gin.Context) {
		var req model.SaveRepositoryRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		repo, err := manager.SaveRepository(req)
		if err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		c.JSON(http.StatusOK, repo)
	})
	router.DELETE("/api/v1/repositories/:repo_id", func(c *gin.Context) {
		if err := manager.DeleteRepository(c.Param("repo_id")); err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		c.Status(http.StatusNoContent)
	})
	router.GET("/api/v1/repositories/:repo_id/refs", func(c *gin.Context) {
		refs, err := manager.ListRepositoryRefs(c.Request.Context(), c.Param("repo_id"))
		if err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		if refs == nil {
			refs = []model.RepositoryRef{}
		}
		c.JSON(http.StatusOK, model.RepositoryRefsResponse{Refs: refs})
	})
	router.POST("/api/v1/repositories/:repo_id/sync", func(c *gin.Context) {
		resp, err := manager.SyncRepository(c.Request.Context(), c.Param("repo_id"))
		if err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		c.JSON(http.StatusOK, resp)
	})
	router.POST("/api/v1/analyze", func(c *gin.Context) {
		var req model.AnalyzeRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		resp, err := manager.Analyze(c.Request.Context(), req)
		if err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		c.JSON(http.StatusAccepted, resp)
	})
	router.GET("/api/v1/analyze/:task_id", func(c *gin.Context) {
		resp, err := manager.TaskStatus(c.Param("task_id"))
		if err != nil {
			writeError(c, http.StatusNotFound, err)
			return
		}
		c.JSON(http.StatusOK, resp)
	})
	router.GET("/api/v1/routes", func(c *gin.Context) {
		taskID := c.Query("task_id")
		if taskID == "" {
			writeError(c, http.StatusBadRequest, errors.New("task_id is required"))
			return
		}
		routes, err := manager.Routes(taskID)
		if err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		if routes == nil {
			routes = []model.Route{}
		}
		c.JSON(http.StatusOK, gin.H{"routes": routes})
	})
	router.POST("/api/v1/callchain/interface", func(c *gin.Context) {
		var req model.InterfaceCallchainRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		resp, err := manager.InterfaceCallchain(req)
		if err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		c.JSON(http.StatusOK, resp)
	})
	router.POST("/api/v1/callchain/function", func(c *gin.Context) {
		var req model.FunctionCallchainRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		resp, err := manager.FunctionCallchain(req)
		if err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		c.JSON(http.StatusOK, resp)
	})
	router.GET("/api/v1/functions", func(c *gin.Context) {
		taskID := c.Query("task_id")
		if taskID == "" {
			writeError(c, http.StatusBadRequest, errors.New("task_id is required"))
			return
		}
		functions, err := manager.Functions(taskID)
		if err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		if functions == nil {
			functions = []model.Function{}
		}
		c.JSON(http.StatusOK, gin.H{"functions": functions})
	})
	router.GET("/api/v1/functions/detail", func(c *gin.Context) {
		taskID := c.Query("task_id")
		id := c.Query("id")
		if taskID == "" || id == "" {
			writeError(c, http.StatusBadRequest, errors.New("task_id and id are required"))
			return
		}
		detail, err := manager.FunctionDetail(taskID, id)
		if err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		c.JSON(http.StatusOK, detail)
	})
	router.GET("/api/v1/files/tree", func(c *gin.Context) {
		taskID := c.Query("task_id")
		if taskID == "" {
			writeError(c, http.StatusBadRequest, errors.New("task_id is required"))
			return
		}
		tree, err := manager.FileTree(taskID)
		if err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		c.JSON(http.StatusOK, gin.H{"tree": tree})
	})
	router.GET("/api/v1/files/content", func(c *gin.Context) {
		taskID := c.Query("task_id")
		path := c.Query("path")
		if taskID == "" || path == "" {
			writeError(c, http.StatusBadRequest, errors.New("task_id and path are required"))
			return
		}
		content, err := manager.FileContent(taskID, path)
		if err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		c.JSON(http.StatusOK, content)
	})
	router.POST("/api/v1/impact/mr", func(c *gin.Context) {
		var req model.MRImpactRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		resp, err := manager.MRImpact(c.Request.Context(), req)
		if err != nil {
			writeError(c, http.StatusBadRequest, err)
			return
		}
		c.JSON(http.StatusOK, resp)
	})
	router.GET("/api/v1/downloads/vscode-extension", func(c *gin.Context) {
		vsixPath, err := resolveVSCodeExtensionVSIX()
		if err != nil {
			writeError(c, http.StatusNotFound, err)
			return
		}
		c.FileAttachment(vsixPath, filepath.Base(vsixPath))
	})

	registerStatic(router, staticDir)
	return router
}

func writeError(c *gin.Context, status int, err error) {
	c.JSON(status, gin.H{"error": err.Error()})
}

func resolveVSCodeExtensionVSIX() (string, error) {
	if explicitPath := strings.TrimSpace(os.Getenv("GO_CALLCHAIN_VSIX_PATH")); explicitPath != "" {
		return regularFile(explicitPath)
	}

	patterns := []string{
		filepath.Join("vscode-extension", "go-callchain-vscode-*.vsix"),
		filepath.Join("downloads", "go-callchain-vscode-*.vsix"),
		"go-callchain-vscode-*.vsix",
	}
	var bestPath string
	var bestInfo os.FileInfo
	for _, root := range candidateDownloadRoots() {
		for _, pattern := range patterns {
			matches, err := filepath.Glob(filepath.Join(root, pattern))
			if err != nil {
				continue
			}
			for _, match := range matches {
				info, err := os.Stat(match)
				if err != nil || info.IsDir() {
					continue
				}
				if bestInfo == nil || info.ModTime().After(bestInfo.ModTime()) {
					bestPath = match
					bestInfo = info
				}
			}
		}
	}
	if bestPath == "" {
		return "", errors.New("vscode extension package not found")
	}
	return bestPath, nil
}

func regularFile(path string) (string, error) {
	resolved, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", errors.New("vscode extension package path is a directory")
	}
	return resolved, nil
}

func candidateDownloadRoots() []string {
	seen := map[string]bool{}
	roots := []string{}
	add := func(path string) {
		if path == "" {
			return
		}
		abs, err := filepath.Abs(path)
		if err != nil {
			return
		}
		clean := filepath.Clean(abs)
		if seen[clean] {
			return
		}
		seen[clean] = true
		roots = append(roots, clean)
	}

	if cwd, err := os.Getwd(); err == nil {
		add(cwd)
	}
	if executable, err := os.Executable(); err == nil {
		dir := filepath.Dir(executable)
		add(dir)
		add(filepath.Join(dir, ".."))
		add(filepath.Join(dir, "..", ".."))
		add(filepath.Join(dir, "..", "..", ".."))
	}
	return roots
}

func registerStatic(router *gin.Engine, staticDir string) {
	if staticDir == "" {
		staticDir = filepath.Join("web", "dist")
	}
	indexPath := filepath.Join(staticDir, "index.html")
	if _, err := os.Stat(indexPath); err != nil {
		return
	}
	router.Static("/assets", filepath.Join(staticDir, "assets"))
	router.NoRoute(func(c *gin.Context) {
		if strings.HasPrefix(c.Request.URL.Path, "/api/") {
			writeError(c, http.StatusNotFound, errors.New("api route not found"))
			return
		}
		c.File(indexPath)
	})
}
