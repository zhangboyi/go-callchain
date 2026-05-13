package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"strings"

	"go-callchain-service/internal/analyzer"
	"go-callchain-service/internal/api"
	"go-callchain-service/internal/graph"
	"go-callchain-service/internal/model"
	"go-callchain-service/internal/repository"
	"go-callchain-service/internal/service"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8787", "server listen address")
	analyzePath := flag.String("analyze", "", "local Go repository path to analyze once")
	gitURL := flag.String("git-url", "", "Git URL to analyze once")
	ref := flag.String("ref", "", "Git ref for one-shot Git analysis")
	impact := flag.Bool("impact", false, "run one-shot MR impact analysis")
	base := flag.String("base", "", "base ref for MR impact")
	head := flag.String("head", "", "head ref for MR impact")
	mode := flag.String("mode", model.AnalyzeModeFast, "analysis mode: fast or accurate")
	method := flag.String("method", "POST", "interface method for one-shot analysis")
	routePath := flag.String("path", "", "interface path for one-shot analysis")
	flag.Parse()

	if *impact {
		if err := runImpact(*analyzePath, *gitURL, *base, *head, *mode); err != nil {
			log.Fatal(err)
		}
		return
	}

	if *analyzePath != "" || *gitURL != "" {
		if err := runOneShot(*analyzePath, *gitURL, *ref, *mode, *method, *routePath); err != nil {
			log.Fatal(err)
		}
		return
	}

	router := api.NewRouter(service.New(service.Options{}))
	server := &http.Server{Addr: *addr, Handler: router}
	log.Printf("go-callchain-service listening on http://%s", *addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func runOneShot(repoPath string, gitURL string, ref string, mode string, method string, routePath string) error {
	workspace, err := resolveOneShotWorkspace(repoPath, gitURL, ref)
	if err != nil {
		return err
	}
	result, err := analyzer.New(analyzer.Options{Mode: mode}).Analyze(context.Background(), workspace.Path)
	if err != nil {
		return err
	}
	method = strings.ToUpper(method)
	for _, route := range result.Routes {
		if route.Method == method && route.Path == routePath {
			fmt.Printf("%s %s\n", route.Method, route.Path)
			printTree(graph.BuildCallTree(result, route.Handler, 8), "")
			return nil
		}
	}
	return fmt.Errorf("route not found: %s %s", method, routePath)
}

func runImpact(repoPath string, gitURL string, base string, head string, mode string) error {
	if base == "" || head == "" {
		return fmt.Errorf("base and head are required")
	}
	source, err := oneShotSource(repoPath, gitURL, head)
	if err != nil {
		return err
	}
	resp, err := service.New(service.Options{}).MRImpact(context.Background(), model.MRImpactRequest{
		Source: source,
		Base:   base,
		Head:   head,
		Depth:  8,
		Mode:   mode,
	})
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(log.Writer())
	encoder.SetIndent("", "  ")
	return encoder.Encode(resp)
}

func resolveOneShotWorkspace(repoPath string, gitURL string, ref string) (*repository.Workspace, error) {
	source, err := oneShotSource(repoPath, gitURL, ref)
	if err != nil {
		return nil, err
	}
	return repository.NewManager("").Resolve(context.Background(), source)
}

func oneShotSource(repoPath string, gitURL string, ref string) (model.RepoSource, error) {
	switch {
	case gitURL != "":
		return model.RepoSource{Type: "git", URL: gitURL, Ref: ref}, nil
	case repoPath != "":
		return model.RepoSource{Type: "local", Path: repoPath}, nil
	default:
		return model.RepoSource{}, fmt.Errorf("local path or git-url is required")
	}
}

func printTree(node graph.CallTreeNode, indent string) {
	fmt.Printf("%s%s\n", indent, shortFunction(node.Function))
	for _, child := range node.Children {
		printTree(child, indent+"  ")
	}
}

func shortFunction(function string) string {
	parts := strings.Split(function, "/")
	if len(parts) == 0 {
		return function
	}
	last := parts[len(parts)-1]
	if strings.Contains(last, ".(") {
		return last
	}
	if strings.HasPrefix(function, "POST ") || strings.HasPrefix(function, "GET ") {
		return function
	}
	return function
}
