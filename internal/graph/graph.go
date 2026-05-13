package graph

import (
	"sort"

	"go-callchain-service/internal/model"
)

type CallTreeNode struct {
	Function string         `json:"function"`
	Edge     *model.Edge    `json:"edge,omitempty"`
	Children []CallTreeNode `json:"children"`
}

func BuildCallTree(result *model.AnalysisResult, root string, depth int) CallTreeNode {
	if depth <= 0 {
		depth = 8
	}
	if depth > 20 {
		depth = 20
	}
	edgesByCaller := make(map[string][]model.Edge)
	for _, edge := range result.Edges {
		edgesByCaller[edge.Caller] = append(edgesByCaller[edge.Caller], edge)
	}
	return build(edgesByCaller, root, nil, depth, map[string]bool{})
}

func build(edgesByCaller map[string][]model.Edge, function string, via *model.Edge, depth int, visiting map[string]bool) CallTreeNode {
	node := CallTreeNode{Function: function, Edge: via}
	if depth == 0 || visiting[function] {
		return node
	}

	visiting[function] = true
	for _, edge := range edgesByCaller[function] {
		edgeCopy := edge
		childVisiting := make(map[string]bool, len(visiting))
		for key, value := range visiting {
			childVisiting[key] = value
		}
		node.Children = append(node.Children, build(edgesByCaller, edge.Callee, &edgeCopy, depth-1, childVisiting))
	}
	return node
}

type PathNode struct {
	Function string      `json:"function"`
	Edge     *model.Edge `json:"edge,omitempty"`
}

type RoutePath struct {
	Route model.Route `json:"route"`
	Nodes []PathNode  `json:"nodes"`
}

func FindPathsToRoutes(result *model.AnalysisResult, targets []string, depth int) []RoutePath {
	if depth <= 0 {
		depth = 8
	}
	if depth > 20 {
		depth = 20
	}

	reverseEdges := make(map[string][]model.Edge)
	for _, edge := range result.Edges {
		reverseEdges[edge.Callee] = append(reverseEdges[edge.Callee], edge)
	}
	routesByHandler := make(map[string][]model.Route)
	for _, route := range result.Routes {
		routesByHandler[route.Handler] = append(routesByHandler[route.Handler], route)
	}

	var paths []RoutePath
	seen := map[string]bool{}
	for _, target := range targets {
		walkReverse(target, reverseEdges, routesByHandler, []PathNode{{Function: target}}, depth, map[string]bool{}, seen, &paths)
	}
	sort.Slice(paths, func(i, j int) bool {
		left := paths[i].Route.Method + " " + paths[i].Route.Path + pathKey(paths[i].Nodes)
		right := paths[j].Route.Method + " " + paths[j].Route.Path + pathKey(paths[j].Nodes)
		return left < right
	})
	return paths
}

func walkReverse(current string, reverseEdges map[string][]model.Edge, routesByHandler map[string][]model.Route, reversePath []PathNode, depth int, visiting map[string]bool, seen map[string]bool, paths *[]RoutePath) {
	if depth < 0 || visiting[current] {
		return
	}
	if routes := routesByHandler[current]; len(routes) > 0 {
		nodes := reverseNodes(reversePath)
		for _, route := range routes {
			key := route.Method + " " + route.Path + pathKey(nodes)
			if seen[key] {
				continue
			}
			seen[key] = true
			*paths = append(*paths, RoutePath{Route: route, Nodes: nodes})
		}
	}
	visiting[current] = true
	for _, edge := range reverseEdges[current] {
		edgeCopy := edge
		nextPath := append(append([]PathNode{}, reversePath...), PathNode{Function: edge.Caller, Edge: &edgeCopy})
		nextVisiting := make(map[string]bool, len(visiting))
		for key, value := range visiting {
			nextVisiting[key] = value
		}
		walkReverse(edge.Caller, reverseEdges, routesByHandler, nextPath, depth-1, nextVisiting, seen, paths)
	}
}

func reverseNodes(nodes []PathNode) []PathNode {
	reversed := make([]PathNode, 0, len(nodes))
	for i := len(nodes) - 1; i >= 0; i-- {
		reversed = append(reversed, nodes[i])
	}
	return reversed
}

func pathKey(nodes []PathNode) string {
	key := ""
	for _, node := range nodes {
		key += ">" + node.Function
	}
	return key
}
