package analyzer

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"go/types"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/tools/go/callgraph/cha"
	"golang.org/x/tools/go/packages"
	"golang.org/x/tools/go/ssa"
	"golang.org/x/tools/go/ssa/ssautil"
	"gopkg.in/yaml.v3"

	"go-callchain-service/internal/model"
)

const (
	sourceDirectCall       = "direct_call"
	sourcePackageSelector  = "package_selector"
	sourceReceiverMethod   = "receiver_method"
	sourceGinRouteHandler  = "gin_route_handler"
	sourceSwaggerRouter    = "swagger_router_comment"
	sourceXProtoRoutes     = "xproto_route_metadata"
	sourceOpenAPISpec      = "openapi_spec"
	sourceConstructorVar   = "constructor_variable"
	sourcePackageVar       = "package_variable"
	sourceStructField      = "struct_field_constructor_inference"
	sourceSSACallGraph     = "ssa_callgraph"
	confidenceExact        = "exact"
	confidenceInferred     = "inferred"
	confidenceUncertain    = "uncertain"
	defaultMaxFiles        = 10000
	defaultMaxFileSizeByte = 2 * 1024 * 1024
)

type Options struct {
	Mode string
}

type Analyzer struct {
	maxFiles    int
	maxFileSize int64
	mode        string
}

func New(options ...Options) *Analyzer {
	mode := model.AnalyzeModeFast
	if len(options) > 0 && options[0].Mode != "" {
		mode = options[0].Mode
	}
	return &Analyzer{
		maxFiles:    defaultMaxFiles,
		maxFileSize: defaultMaxFileSizeByte,
		mode:        normalizeMode(mode),
	}
}

func (a *Analyzer) Analyze(ctx context.Context, repoPath string) (*model.AnalysisResult, error) {
	absPath, err := filepath.Abs(repoPath)
	if err != nil {
		return nil, err
	}
	modulePath, err := readModulePath(filepath.Join(absPath, "go.mod"))
	if err != nil {
		return nil, err
	}

	state := &analysisState{
		repoPath:           absPath,
		modulePath:         modulePath,
		fset:               token.NewFileSet(),
		functionsByID:      map[string]model.Function{},
		functionsByName:    map[string]*functionInfo{},
		types:              map[string]typeInfo{},
		stringConsts:       map[string]string{},
		packageVars:        map[string]typeRef{},
		constructors:       map[string]*constructorInfo{},
		fieldBindings:      map[string]map[string]typeRef{},
		seenEdges:          map[string]bool{},
		seenRoutes:         map[string]bool{},
		processedRouteCtxs: map[string]bool{},
	}

	if err := state.parseFiles(ctx, a.maxFiles, a.maxFileSize); err != nil {
		return nil, err
	}
	state.collectDeclarations()
	state.resolveConstructorBindings()
	state.collectRoutes()
	state.collectCommentRoutes()
	state.collectRouteArtifacts()
	state.pruneShadowedRoutes()
	state.collectEdges()

	result := &model.AnalysisResult{
		Workspace: absPath,
		Module:    modulePath,
		Mode:      a.mode,
		Functions: state.functions,
		Edges:     state.edges,
		Routes:    state.routes,
	}
	if a.mode == model.AnalyzeModeAccurate {
		if err := state.enrichWithSSACallGraph(ctx, result); err != nil {
			return nil, err
		}
	}
	sort.Slice(result.Functions, func(i, j int) bool { return result.Functions[i].ID < result.Functions[j].ID })
	sort.Slice(result.Edges, func(i, j int) bool {
		if result.Edges[i].Caller == result.Edges[j].Caller {
			return result.Edges[i].Callee < result.Edges[j].Callee
		}
		return result.Edges[i].Caller < result.Edges[j].Caller
	})
	sort.Slice(result.Routes, func(i, j int) bool {
		if result.Routes[i].Path == result.Routes[j].Path {
			return result.Routes[i].Method < result.Routes[j].Method
		}
		return result.Routes[i].Path < result.Routes[j].Path
	})
	return result, nil
}

type analysisState struct {
	repoPath           string
	modulePath         string
	fset               *token.FileSet
	files              []*goFile
	functions          []model.Function
	functionsByID      map[string]model.Function
	functionsByName    map[string]*functionInfo
	types              map[string]typeInfo
	stringConsts       map[string]string
	packageVars        map[string]typeRef
	constructors       map[string]*constructorInfo
	fieldBindings      map[string]map[string]typeRef
	routes             []model.Route
	edges              []model.Edge
	seenEdges          map[string]bool
	seenRoutes         map[string]bool
	processedRouteCtxs map[string]bool
}

type goFile struct {
	absPath    string
	relPath    string
	importPath string
	astFile    *ast.File
	imports    map[string]string
	consts     map[string]string
}

type functionInfo struct {
	id           string
	name         string
	importPath   string
	file         *goFile
	decl         *ast.FuncDecl
	params       []string
	receiverName string
	receiverType typeRef
}

type typeInfo struct {
	ref      typeRef
	fields   map[string]typeRef
	embedded []typeRef
}

type typeRef struct {
	importPath string
	name       string
}

type constructorInfo struct {
	functionID string
	actual     typeRef
	declared   typeRef
	fieldCalls map[string]callRef
}

type callRef struct {
	importPath string
	name       string
}

type routeContext struct {
	funcID        string
	paramPrefixes map[string]string
}

type detectedRoute struct {
	route  model.Route
	source string
}

type routeDetector interface {
	detectRoutes(*analysisState) []detectedRoute
}

func (s *analysisState) parseFiles(ctx context.Context, maxFiles int, maxFileSize int64) error {
	count := 0
	return filepath.WalkDir(s.repoPath, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if entry.IsDir() {
			name := entry.Name()
			if name == ".git" || name == "vendor" || name == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			return nil
		}
		if count >= maxFiles {
			return fmt.Errorf("go file count exceeds limit %d", maxFiles)
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Size() > maxFileSize {
			return nil
		}
		parsed, err := parser.ParseFile(s.fset, path, nil, parser.ParseComments)
		if err != nil {
			return err
		}
		relPath, err := filepath.Rel(s.repoPath, path)
		if err != nil {
			return err
		}
		importPath := s.modulePath
		dir := filepath.Dir(relPath)
		if dir != "." {
			importPath += "/" + filepath.ToSlash(dir)
		}
		s.files = append(s.files, &goFile{
			absPath:    path,
			relPath:    filepath.ToSlash(relPath),
			importPath: importPath,
			astFile:    parsed,
			imports:    importsByName(parsed),
			consts:     map[string]string{},
		})
		count++
		return nil
	})
}

func (s *analysisState) collectDeclarations() {
	for _, file := range s.files {
		for _, decl := range file.astFile.Decls {
			if typed, ok := decl.(*ast.GenDecl); ok {
				s.collectConsts(file, typed)
			}
		}
	}
	for _, file := range s.files {
		for _, decl := range file.astFile.Decls {
			switch typed := decl.(type) {
			case *ast.GenDecl:
				s.collectTypes(file, typed)
			case *ast.FuncDecl:
				s.collectFunction(file, typed)
			}
		}
	}
	for _, file := range s.files {
		for _, decl := range file.astFile.Decls {
			if typed, ok := decl.(*ast.GenDecl); ok {
				s.collectVars(file, typed)
			}
		}
	}
}

func (s *analysisState) collectConsts(file *goFile, decl *ast.GenDecl) {
	if decl.Tok != token.CONST {
		return
	}
	for _, spec := range decl.Specs {
		valueSpec, ok := spec.(*ast.ValueSpec)
		if !ok {
			continue
		}
		for i, name := range valueSpec.Names {
			if i >= len(valueSpec.Values) {
				continue
			}
			value, ok := s.stringValue(file, valueSpec.Values[i])
			if !ok {
				continue
			}
			file.consts[name.Name] = value
			s.stringConsts[file.importPath+"."+name.Name] = value
		}
	}
}

func (s *analysisState) collectTypes(file *goFile, decl *ast.GenDecl) {
	if decl.Tok != token.TYPE {
		return
	}
	for _, spec := range decl.Specs {
		typeSpec, ok := spec.(*ast.TypeSpec)
		if !ok {
			continue
		}
		structType, ok := typeSpec.Type.(*ast.StructType)
		if !ok {
			continue
		}
		info := typeInfo{
			ref:    typeRef{importPath: file.importPath, name: typeSpec.Name.Name},
			fields: map[string]typeRef{},
		}
		for _, field := range structType.Fields.List {
			ref := s.resolveTypeExpr(file, field.Type)
			if !ref.valid() {
				continue
			}
			if len(field.Names) == 0 {
				info.embedded = append(info.embedded, ref)
				continue
			}
			for _, name := range field.Names {
				info.fields[name.Name] = ref
			}
		}
		s.types[info.ref.key()] = info
	}
}

func (s *analysisState) collectVars(file *goFile, decl *ast.GenDecl) {
	if decl.Tok != token.VAR {
		return
	}
	for _, spec := range decl.Specs {
		valueSpec, ok := spec.(*ast.ValueSpec)
		if !ok {
			continue
		}
		for i, name := range valueSpec.Names {
			ref := s.valueSpecType(file, valueSpec, i)
			if ref.valid() {
				s.packageVars[file.importPath+"."+name.Name] = ref
			}
		}
	}
}

func (s *analysisState) collectFunction(file *goFile, decl *ast.FuncDecl) {
	receiverName, receiverType := receiver(decl, file.importPath)
	id := functionID(file.importPath, receiverType.name, decl.Name.Name)
	fn := model.Function{
		ID:        id,
		Name:      decl.Name.Name,
		Package:   file.importPath,
		Receiver:  receiverType.name,
		File:      file.relPath,
		StartLine: s.fset.Position(decl.Pos()).Line,
		EndLine:   s.fset.Position(decl.End()).Line,
	}
	info := &functionInfo{
		id:           id,
		name:         decl.Name.Name,
		importPath:   file.importPath,
		file:         file,
		decl:         decl,
		params:       paramNames(decl),
		receiverName: receiverName,
		receiverType: receiverType,
	}
	s.functions = append(s.functions, fn)
	s.functionsByID[id] = fn
	if receiverType.valid() {
		s.functionsByName[file.importPath+".("+receiverType.name+")."+decl.Name.Name] = info
	} else {
		s.functionsByName[file.importPath+"."+decl.Name.Name] = info
	}
	if constructor := s.constructorFromFunction(file, decl, id); constructor != nil {
		s.constructors[file.importPath+"."+decl.Name.Name] = constructor
	}
}

func (s *analysisState) constructorFromFunction(file *goFile, decl *ast.FuncDecl, id string) *constructorInfo {
	if decl.Recv != nil || decl.Body == nil {
		return nil
	}
	constructor := &constructorInfo{
		functionID: id,
		declared:   firstResultType(file, decl.Type.Results, s),
		fieldCalls: map[string]callRef{},
	}
	ast.Inspect(decl.Body, func(node ast.Node) bool {
		ret, ok := node.(*ast.ReturnStmt)
		if !ok || len(ret.Results) == 0 {
			return true
		}
		ref, fields := s.compositeReturn(file, ret.Results[0])
		if ref.valid() {
			constructor.actual = ref
			for field, call := range fields {
				constructor.fieldCalls[field] = call
			}
			return false
		}
		return true
	})
	if !constructor.actual.valid() {
		constructor.actual = constructor.declared
	}
	if !constructor.actual.valid() && !constructor.declared.valid() {
		return nil
	}
	return constructor
}

func (s *analysisState) compositeReturn(file *goFile, expr ast.Expr) (typeRef, map[string]callRef) {
	if unary, ok := expr.(*ast.UnaryExpr); ok && unary.Op == token.AND {
		expr = unary.X
	}
	composite, ok := expr.(*ast.CompositeLit)
	if !ok {
		return typeRef{}, nil
	}
	ref := s.resolveTypeExpr(file, composite.Type)
	fields := map[string]callRef{}
	for _, elt := range composite.Elts {
		kv, ok := elt.(*ast.KeyValueExpr)
		if !ok {
			continue
		}
		key, ok := kv.Key.(*ast.Ident)
		if !ok {
			continue
		}
		call, ok := kv.Value.(*ast.CallExpr)
		if !ok {
			continue
		}
		if callRef := s.resolveFunctionCallRef(file, call.Fun); callRef.name != "" {
			fields[key.Name] = callRef
		}
	}
	return ref, fields
}

func (s *analysisState) resolveConstructorBindings() {
	for _, constructor := range s.constructors {
		if !constructor.actual.valid() {
			continue
		}
		bindings := s.fieldBindings[constructor.actual.key()]
		if bindings == nil {
			bindings = map[string]typeRef{}
			s.fieldBindings[constructor.actual.key()] = bindings
		}
		for field, call := range constructor.fieldCalls {
			target := s.constructors[call.importPath+"."+call.name]
			if target == nil {
				continue
			}
			if target.actual.valid() {
				bindings[field] = target.actual
				continue
			}
			if target.declared.valid() {
				bindings[field] = target.declared
			}
		}
	}
}

func (s *analysisState) collectRoutes() {
	queue := make([]routeContext, 0, len(s.functionsByName))
	for _, fn := range s.functionsByName {
		queue = append(queue, routeContext{funcID: fn.id, paramPrefixes: map[string]string{}})
	}
	for len(queue) > 0 {
		ctx := queue[0]
		queue = queue[1:]
		key := routeContextKey(ctx)
		if s.processedRouteCtxs[key] {
			continue
		}
		s.processedRouteCtxs[key] = true
		fn := s.functionInfoByID(ctx.funcID)
		if fn == nil || fn.decl.Body == nil {
			continue
		}
		next := s.processRouteFunction(fn, ctx.paramPrefixes)
		queue = append(queue, next...)
	}
}

func (s *analysisState) collectCommentRoutes() {
	for _, fn := range s.functionsByName {
		if fn.decl.Doc == nil {
			continue
		}
		for _, route := range s.routesFromDoc(fn) {
			s.addRouteWithSource(route, sourceSwaggerRouter)
		}
	}
}

func (s *analysisState) collectRouteArtifacts() {
	detectors := []routeDetector{
		xprotoRouteDetector{},
		openAPIRouteDetector{},
	}
	for _, detector := range detectors {
		for _, detected := range detector.detectRoutes(s) {
			s.addDetectedRoute(detected)
		}
	}
}

func (s *analysisState) pruneShadowedRoutes() {
	if len(s.routes) < 2 {
		return
	}
	shadowed := make([]bool, len(s.routes))
	for i, route := range s.routes {
		for j, other := range s.routes {
			if i == j || route.Method != other.Method || route.Handler == "" || route.Handler != other.Handler {
				continue
			}
			if len(other.Path) > len(route.Path) && strings.HasSuffix(other.Path, route.Path) {
				shadowed[i] = true
				break
			}
		}
	}
	keptRoutes := make([]model.Route, 0, len(s.routes))
	routeCallers := map[string]bool{}
	for i, route := range s.routes {
		if shadowed[i] {
			continue
		}
		keptRoutes = append(keptRoutes, route)
		routeCallers[route.Method+" "+route.Path] = true
	}
	s.routes = keptRoutes
	filteredEdges := s.edges[:0]
	for _, edge := range s.edges {
		if isRouteEdgeSource(edge.Source) && !routeCallers[edge.Caller] {
			delete(s.seenEdges, edge.Caller+">"+edge.Callee+"@"+edge.Source)
			continue
		}
		filteredEdges = append(filteredEdges, edge)
	}
	s.edges = filteredEdges
}

func isRouteEdgeSource(source string) bool {
	switch source {
	case sourceGinRouteHandler, sourceSwaggerRouter, sourceXProtoRoutes, sourceOpenAPISpec:
		return true
	default:
		return false
	}
}

func (s *analysisState) routesFromDoc(fn *functionInfo) []model.Route {
	var routes []model.Route
	for _, line := range strings.Split(fn.decl.Doc.Text(), "\n") {
		path, method, ok := parseRouterDirective(line)
		if !ok {
			continue
		}
		pos := s.fset.Position(fn.decl.Pos())
		routes = append(routes, model.Route{
			Method:  method,
			Path:    path,
			Handler: fn.id,
			File:    fn.file.relPath,
			Line:    pos.Line,
		})
	}
	return routes
}

func parseRouterDirective(line string) (string, string, bool) {
	fields := strings.Fields(strings.TrimSpace(line))
	if len(fields) < 3 || !strings.EqualFold(fields[0], "@Router") {
		return "", "", false
	}
	method := strings.ToUpper(strings.Trim(fields[2], "[]"))
	if !isHTTPMethod(method) {
		return "", "", false
	}
	return cleanRoutePath(fields[1]), method, true
}

type xprotoRouteDetector struct{}

type xprotoRouteDocument struct {
	Routes []routeArtifact `json:"routes"`
}

type routeArtifact struct {
	Method string `json:"method" yaml:"method"`
	Path   string `json:"path" yaml:"path"`
}

func (xprotoRouteDetector) detectRoutes(s *analysisState) []detectedRoute {
	var detected []detectedRoute
	for _, path := range s.routeArtifactFiles(isXProtoRouteFile) {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var doc xprotoRouteDocument
		if err := json.Unmarshal(data, &doc); err != nil {
			continue
		}
		for _, item := range doc.Routes {
			route, ok := routeFromArtifact(s, path, item)
			if !ok {
				continue
			}
			detected = append(detected, detectedRoute{route: route, source: sourceXProtoRoutes})
		}
	}
	return detected
}

type openAPIRouteDetector struct{}

type openAPIDocument struct {
	Paths map[string]map[string]any `json:"paths" yaml:"paths"`
}

func (openAPIRouteDetector) detectRoutes(s *analysisState) []detectedRoute {
	var detected []detectedRoute
	for _, path := range s.routeArtifactFiles(isOpenAPIRouteFile) {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		var doc openAPIDocument
		if err := yaml.Unmarshal(data, &doc); err != nil {
			continue
		}
		for routePath, operations := range doc.Paths {
			for method := range operations {
				route, ok := routeFromArtifact(s, path, routeArtifact{Method: method, Path: routePath})
				if !ok {
					continue
				}
				detected = append(detected, detectedRoute{route: route, source: sourceOpenAPISpec})
			}
		}
	}
	return detected
}

func (s *analysisState) routeArtifactFiles(match func(string) bool) []string {
	var files []string
	_ = filepath.WalkDir(s.repoPath, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			if shouldSkipRouteArtifactDir(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if match(entry.Name()) {
			files = append(files, path)
		}
		return nil
	})
	sort.Strings(files)
	return files
}

func shouldSkipRouteArtifactDir(name string) bool {
	switch name {
	case ".git", "vendor", "node_modules", ".idea", ".vscode":
		return true
	default:
		return false
	}
}

func isXProtoRouteFile(name string) bool {
	return name == ".xproto_extraction_router.json"
}

func isOpenAPIRouteFile(name string) bool {
	switch strings.ToLower(name) {
	case "openapi.json", "openapi.yaml", "openapi.yml", "swagger.json", "swagger.yaml", "swagger.yml":
		return true
	default:
		return false
	}
}

func routeFromArtifact(s *analysisState, filePath string, item routeArtifact) (model.Route, bool) {
	method := strings.ToUpper(strings.TrimSpace(item.Method))
	if !isHTTPMethod(method) || strings.TrimSpace(item.Path) == "" {
		return model.Route{}, false
	}
	relPath, err := filepath.Rel(s.repoPath, filePath)
	if err != nil {
		relPath = filePath
	}
	return model.Route{
		Method: method,
		Path:   cleanRoutePath(item.Path),
		File:   filepath.ToSlash(relPath),
		Line:   1,
	}, true
}

func (s *analysisState) processRouteFunction(fn *functionInfo, inherited map[string]string) []routeContext {
	groupPrefixes := copyStringMap(inherited)
	localTypes := map[string]typeRef{}
	var next []routeContext

	ast.Inspect(fn.decl.Body, func(node ast.Node) bool {
		switch typed := node.(type) {
		case *ast.DeclStmt:
			s.readVarDecl(fn.file, typed, localTypes, groupPrefixes)
		case *ast.AssignStmt:
			s.readAssignments(fn.file, typed, localTypes, groupPrefixes)
		case *ast.CallExpr:
			if route, ok := s.routeFromCall(fn, typed, groupPrefixes, localTypes); ok {
				s.addRoute(route)
			}
			next = append(next, s.routeContextsFromCall(fn, typed, groupPrefixes, localTypes)...)
		}
		return true
	})
	return next
}

func (s *analysisState) readVarDecl(file *goFile, stmt *ast.DeclStmt, localTypes map[string]typeRef, groupPrefixes map[string]string) {
	decl, ok := stmt.Decl.(*ast.GenDecl)
	if !ok || decl.Tok != token.VAR {
		return
	}
	for _, spec := range decl.Specs {
		valueSpec, ok := spec.(*ast.ValueSpec)
		if !ok {
			continue
		}
		for i, name := range valueSpec.Names {
			if i < len(valueSpec.Values) {
				if prefix, ok := s.groupPrefixFromExpr(file, valueSpec.Values[i], groupPrefixes); ok {
					groupPrefixes[name.Name] = prefix
					continue
				}
			}
			ref := s.valueSpecType(file, valueSpec, i)
			if ref.valid() {
				localTypes[name.Name] = ref
			}
		}
	}
}

func (s *analysisState) readAssignments(file *goFile, assign *ast.AssignStmt, localTypes map[string]typeRef, groupPrefixes map[string]string) {
	for i, lhs := range assign.Lhs {
		if i >= len(assign.Rhs) {
			continue
		}
		name, ok := lhs.(*ast.Ident)
		if !ok {
			continue
		}
		if prefix, ok := s.groupPrefixFromExpr(file, assign.Rhs[i], groupPrefixes); ok {
			groupPrefixes[name.Name] = prefix
			continue
		}
		ref := s.valueExprType(file, assign.Rhs[i])
		if ref.valid() {
			localTypes[name.Name] = ref
		}
	}
}

func (s *analysisState) valueSpecType(file *goFile, spec *ast.ValueSpec, index int) typeRef {
	if spec.Type != nil {
		return s.resolveTypeExpr(file, spec.Type)
	}
	if index >= len(spec.Values) {
		return typeRef{}
	}
	return s.valueExprType(file, spec.Values[index])
}

func (s *analysisState) valueExprType(file *goFile, expr ast.Expr) typeRef {
	ref, _ := s.compositeReturn(file, expr)
	if ref.valid() {
		return ref
	}
	call, ok := expr.(*ast.CallExpr)
	if !ok {
		return typeRef{}
	}
	callRef := s.resolveFunctionCallRef(file, call.Fun)
	constructor := s.constructors[callRef.importPath+"."+callRef.name]
	if constructor == nil {
		return typeRef{}
	}
	if constructor.actual.valid() {
		return constructor.actual
	}
	return constructor.declared
}

func (s *analysisState) groupPrefixFromExpr(file *goFile, expr ast.Expr, groupPrefixes map[string]string) (string, bool) {
	call, ok := expr.(*ast.CallExpr)
	if !ok {
		return "", false
	}
	return s.groupPrefixFromCall(file, call, groupPrefixes)
}

func (s *analysisState) routeFromCall(fn *functionInfo, call *ast.CallExpr, groupPrefixes map[string]string, localTypes map[string]typeRef) (model.Route, bool) {
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || !isHTTPMethod(selector.Sel.Name) || len(call.Args) < 2 {
		return model.Route{}, false
	}
	groupIdent, ok := selector.X.(*ast.Ident)
	if !ok {
		return model.Route{}, false
	}
	prefix, hasPrefix := groupPrefixes[groupIdent.Name]
	if !hasPrefix && s.routeReceiverParamType(fn, groupIdent.Name).name == "RouterGroup" {
		return model.Route{}, false
	}
	relativePath, ok := s.stringValue(fn.file, call.Args[0])
	if !ok {
		return model.Route{}, false
	}
	handler := s.resolveRouteHandler(fn, call.Args[1:], localTypes)
	if handler == "" {
		return model.Route{}, false
	}
	pos := s.fset.Position(call.Pos())
	return model.Route{
		Method:  selector.Sel.Name,
		Path:    joinRoutePath(prefix, relativePath),
		Handler: handler,
		File:    fn.file.relPath,
		Line:    pos.Line,
	}, true
}

func (s *analysisState) routeContextsFromCall(fn *functionInfo, call *ast.CallExpr, groupPrefixes map[string]string, localTypes map[string]typeRef) []routeContext {
	called := s.routeContextFunction(fn, call.Fun, localTypes)
	if called == nil || len(call.Args) == 0 {
		return nil
	}
	prefixes := map[string]string{}
	for i, arg := range call.Args {
		if i >= len(called.params) {
			continue
		}
		argIdent, ok := arg.(*ast.Ident)
		if !ok {
			continue
		}
		prefix, ok := groupPrefixes[argIdent.Name]
		if ok {
			prefixes[called.params[i]] = prefix
		}
	}
	if len(prefixes) == 0 {
		return nil
	}
	return []routeContext{{funcID: called.id, paramPrefixes: prefixes}}
}

func (s *analysisState) routeContextFunction(fn *functionInfo, fun ast.Expr, localTypes map[string]typeRef) *functionInfo {
	switch typed := fun.(type) {
	case *ast.Ident:
		return s.functionsByName[fn.importPath+"."+typed.Name]
	case *ast.SelectorExpr:
		if ref, ok := s.resolveSelectorReceiver(fn, typed.X, localTypes); ok && ref.typ.valid() {
			return s.functionInfoByID(functionID(ref.typ.importPath, ref.typ.name, typed.Sel.Name))
		}
	}
	return nil
}

func (s *analysisState) collectEdges() {
	for _, fn := range s.functionsByName {
		if fn.decl.Body == nil {
			continue
		}
		localTypes := map[string]typeRef{}
		groupPrefixes := map[string]string{}
		ast.Inspect(fn.decl.Body, func(node ast.Node) bool {
			switch typed := node.(type) {
			case *ast.DeclStmt:
				s.readVarDecl(fn.file, typed, localTypes, groupPrefixes)
			case *ast.AssignStmt:
				s.readAssignments(fn.file, typed, localTypes, groupPrefixes)
			case *ast.CallExpr:
				callee, source, confidence := s.resolveCall(fn, typed.Fun, localTypes)
				if callee == "" || callee == fn.id {
					return true
				}
				if _, ok := s.functionsByID[callee]; !ok {
					return true
				}
				pos := s.fset.Position(typed.Pos())
				s.addEdge(model.Edge{
					Caller:     fn.id,
					Callee:     callee,
					File:       fn.file.relPath,
					Line:       pos.Line,
					Source:     source,
					Confidence: confidence,
				})
			}
			return true
		})
	}
}

func (s *analysisState) enrichWithSSACallGraph(ctx context.Context, result *model.AnalysisResult) error {
	cfg := &packages.Config{
		Context: ctx,
		Dir:     s.repoPath,
		Fset:    s.fset,
		Mode: packages.NeedName |
			packages.NeedFiles |
			packages.NeedCompiledGoFiles |
			packages.NeedImports |
			packages.NeedDeps |
			packages.NeedTypes |
			packages.NeedTypesInfo |
			packages.NeedTypesSizes |
			packages.NeedSyntax,
		Tests: false,
	}
	pkgs, err := packages.Load(cfg, "./...")
	if err != nil {
		return err
	}
	pkgs = wellTypedPackages(pkgs, s.modulePath)
	if len(pkgs) == 0 {
		return nil
	}
	program, _ := ssautil.Packages(pkgs, ssa.InstantiateGenerics)
	program.Build()
	callGraph := cha.CallGraph(program)

	functionIDs := map[string]bool{}
	for _, function := range result.Functions {
		functionIDs[function.ID] = true
	}
	seen := map[string]bool{}
	for _, edge := range result.Edges {
		seen[edge.Caller+">"+edge.Callee] = true
	}
	for callerFn, node := range callGraph.Nodes {
		caller := s.functionIDFromSSA(callerFn)
		if !functionIDs[caller] {
			continue
		}
		for _, out := range node.Out {
			callee := s.functionIDFromSSA(out.Callee.Func)
			if !functionIDs[callee] || caller == callee {
				continue
			}
			key := caller + ">" + callee
			if seen[key] {
				continue
			}
			seen[key] = true
			pos := s.fset.Position(out.Site.Pos())
			confidence := confidenceExact
			if out.Site.Common().IsInvoke() {
				confidence = confidenceUncertain
			}
			result.Edges = append(result.Edges, model.Edge{
				Caller:     caller,
				Callee:     callee,
				File:       normalizedRepoFile(s.repoPath, pos.Filename),
				Line:       pos.Line,
				Source:     sourceSSACallGraph,
				Confidence: confidence,
			})
		}
	}
	return nil
}

func wellTypedPackages(pkgs []*packages.Package, modulePath string) []*packages.Package {
	seen := map[string]bool{}
	var filtered []*packages.Package
	for _, pkg := range pkgs {
		if pkg == nil || pkg.Types == nil || pkg.IllTyped || len(pkg.Syntax) == 0 || seen[pkg.PkgPath] {
			continue
		}
		if pkg.PkgPath != modulePath && !strings.HasPrefix(pkg.PkgPath, modulePath+"/") {
			continue
		}
		seen[pkg.PkgPath] = true
		filtered = append(filtered, pkg)
	}
	return filtered
}

func (s *analysisState) functionIDFromSSA(fn *ssa.Function) string {
	if fn == nil || fn.Pkg == nil || fn.Pkg.Pkg == nil || fn.Synthetic != "" {
		return ""
	}
	receiverName := ""
	if fn.Signature != nil && fn.Signature.Recv() != nil {
		receiverName = namedTypeName(fn.Signature.Recv().Type())
	}
	return functionID(fn.Pkg.Pkg.Path(), receiverName, fn.Name())
}

func namedTypeName(typ types.Type) string {
	for {
		switch typed := typ.(type) {
		case *types.Pointer:
			typ = typed.Elem()
		case *types.Named:
			return typed.Obj().Name()
		default:
			return ""
		}
	}
}

func normalizedRepoFile(repoPath string, filename string) string {
	rel, err := filepath.Rel(repoPath, filename)
	if err != nil || strings.HasPrefix(rel, "..") {
		return filepath.ToSlash(filename)
	}
	return filepath.ToSlash(rel)
}

func (s *analysisState) resolveCall(fn *functionInfo, fun ast.Expr, localTypes map[string]typeRef) (string, string, string) {
	switch typed := fun.(type) {
	case *ast.Ident:
		id := functionID(fn.importPath, "", typed.Name)
		return id, sourceDirectCall, confidenceExact
	case *ast.SelectorExpr:
		if ref, ok := s.resolveSelectorReceiver(fn, typed.X, localTypes); ok {
			source := sourceReceiverMethod
			confidence := confidenceExact
			if ref.inferred {
				source = sourceStructField
				confidence = confidenceInferred
			} else if ref.fromConstructor {
				source = sourceConstructorVar
			} else if ref.fromPackageVar {
				source = sourcePackageVar
			}
			return functionID(ref.typ.importPath, ref.typ.name, typed.Sel.Name), source, confidence
		}
		if ident, ok := typed.X.(*ast.Ident); ok {
			if importPath, ok := fn.file.imports[ident.Name]; ok {
				return functionID(importPath, "", typed.Sel.Name), sourcePackageSelector, confidenceExact
			}
		}
	}
	return "", "", ""
}

type receiverResolution struct {
	typ             typeRef
	inferred        bool
	fromConstructor bool
	fromPackageVar  bool
}

func (s *analysisState) resolveSelectorReceiver(fn *functionInfo, expr ast.Expr, localTypes map[string]typeRef) (receiverResolution, bool) {
	switch typed := expr.(type) {
	case *ast.Ident:
		if fn.receiverName == typed.Name && fn.receiverType.valid() {
			return receiverResolution{typ: fn.receiverType}, true
		}
		ref, ok := localTypes[typed.Name]
		if ok {
			return receiverResolution{typ: ref, fromConstructor: true}, true
		}
		ref, ok = s.packageVars[fn.importPath+"."+typed.Name]
		if ok {
			return receiverResolution{typ: ref, fromPackageVar: true}, true
		}
	case *ast.SelectorExpr:
		base, ok := s.resolveSelectorReceiver(fn, typed.X, localTypes)
		if !ok {
			return receiverResolution{}, false
		}
		fieldType, ok := s.fieldTypeFor(base.typ, typed.Sel.Name)
		if !ok {
			return receiverResolution{}, false
		}
		return receiverResolution{typ: fieldType, inferred: true}, true
	}
	return receiverResolution{}, false
}

func (s *analysisState) fieldTypeFor(owner typeRef, field string) (typeRef, bool) {
	return s.fieldTypeForSeen(owner, field, map[string]bool{})
}

func (s *analysisState) fieldTypeForSeen(owner typeRef, field string, seen map[string]bool) (typeRef, bool) {
	if seen[owner.key()] {
		return typeRef{}, false
	}
	seen[owner.key()] = true
	if binding, ok := s.fieldBindings[owner.key()][field]; ok {
		return binding, true
	}
	if typeInfo, ok := s.types[owner.key()]; ok {
		if ref, ok := typeInfo.fields[field]; ok {
			return ref, true
		}
		for _, embedded := range typeInfo.embedded {
			if ref, ok := s.fieldTypeForSeen(embedded, field, seen); ok {
				return ref, true
			}
		}
	}
	return typeRef{}, false
}

func (s *analysisState) resolveHandler(fn *functionInfo, expr ast.Expr, localTypes map[string]typeRef) string {
	switch typed := expr.(type) {
	case *ast.Ident:
		return s.knownFunctionID(functionID(fn.importPath, "", typed.Name))
	case *ast.SelectorExpr:
		if ref, ok := s.resolveSelectorReceiver(fn, typed.X, localTypes); ok && ref.typ.valid() {
			return s.knownFunctionID(functionID(ref.typ.importPath, ref.typ.name, typed.Sel.Name))
		}
		ident, ok := typed.X.(*ast.Ident)
		if !ok {
			return ""
		}
		importPath, ok := fn.file.imports[ident.Name]
		if !ok {
			return ""
		}
		return s.knownFunctionID(functionID(importPath, "", typed.Sel.Name))
	}
	return ""
}

func (s *analysisState) routeReceiverParamType(fn *functionInfo, name string) typeRef {
	if fn.decl.Type.Params == nil {
		return typeRef{}
	}
	for _, field := range fn.decl.Type.Params.List {
		ref := s.resolveTypeExpr(fn.file, field.Type)
		if ref.importPath != "github.com/gin-gonic/gin" {
			continue
		}
		for _, fieldName := range field.Names {
			if fieldName.Name == name {
				return ref
			}
		}
	}
	return typeRef{}
}

func (s *analysisState) resolveRouteHandler(fn *functionInfo, args []ast.Expr, localTypes map[string]typeRef) string {
	for i := len(args) - 1; i >= 0; i-- {
		handler := s.resolveHandler(fn, args[i], localTypes)
		if handler != "" {
			return handler
		}
	}
	return ""
}

func (s *analysisState) knownFunctionID(id string) string {
	if _, ok := s.functionsByID[id]; ok {
		return id
	}
	return ""
}

func (s *analysisState) addRoute(route model.Route) {
	s.addRouteWithSource(route, sourceGinRouteHandler)
}

func (s *analysisState) addDetectedRoute(detected detectedRoute) {
	if detected.route.Handler == "" && s.hasRouteMethodPath(detected.route.Method, detected.route.Path) {
		return
	}
	s.addRouteWithSource(detected.route, detected.source)
}

func (s *analysisState) addRouteWithSource(route model.Route, source string) {
	key := route.Method + " " + route.Path + " " + route.Handler
	if s.seenRoutes[key] {
		return
	}
	s.seenRoutes[key] = true
	s.routes = append(s.routes, route)
	if route.Handler == "" {
		return
	}
	s.addEdge(model.Edge{
		Caller:     route.Method + " " + route.Path,
		Callee:     route.Handler,
		File:       route.File,
		Line:       route.Line,
		Source:     source,
		Confidence: confidenceExact,
	})
}

func (s *analysisState) hasRouteMethodPath(method string, path string) bool {
	for _, route := range s.routes {
		if route.Method == method && route.Path == path {
			return true
		}
	}
	return false
}

func (s *analysisState) addEdge(edge model.Edge) {
	key := edge.Caller + ">" + edge.Callee + "@" + edge.Source
	if s.seenEdges[key] {
		return
	}
	s.seenEdges[key] = true
	s.edges = append(s.edges, edge)
}

func (s *analysisState) functionInfoByID(id string) *functionInfo {
	for _, fn := range s.functionsByName {
		if fn.id == id {
			return fn
		}
	}
	return nil
}

func (s *analysisState) resolveFunctionCallRef(file *goFile, expr ast.Expr) callRef {
	switch typed := expr.(type) {
	case *ast.Ident:
		return callRef{importPath: file.importPath, name: typed.Name}
	case *ast.SelectorExpr:
		ident, ok := typed.X.(*ast.Ident)
		if !ok {
			return callRef{}
		}
		importPath, ok := file.imports[ident.Name]
		if !ok {
			return callRef{}
		}
		return callRef{importPath: importPath, name: typed.Sel.Name}
	}
	return callRef{}
}

func (s *analysisState) resolveTypeExpr(file *goFile, expr ast.Expr) typeRef {
	switch typed := expr.(type) {
	case *ast.Ident:
		return typeRef{importPath: file.importPath, name: typed.Name}
	case *ast.StarExpr:
		return s.resolveTypeExpr(file, typed.X)
	case *ast.SelectorExpr:
		ident, ok := typed.X.(*ast.Ident)
		if !ok {
			return typeRef{}
		}
		importPath, ok := file.imports[ident.Name]
		if !ok {
			return typeRef{}
		}
		return typeRef{importPath: importPath, name: typed.Sel.Name}
	}
	return typeRef{}
}

func firstResultType(file *goFile, results *ast.FieldList, state *analysisState) typeRef {
	if results == nil || len(results.List) == 0 {
		return typeRef{}
	}
	return state.resolveTypeExpr(file, results.List[0].Type)
}

func receiver(decl *ast.FuncDecl, importPath string) (string, typeRef) {
	if decl.Recv == nil || len(decl.Recv.List) == 0 {
		return "", typeRef{}
	}
	field := decl.Recv.List[0]
	name := ""
	if len(field.Names) > 0 {
		name = field.Names[0].Name
	}
	ref := receiverTypeRef(field.Type, importPath)
	return name, ref
}

func receiverTypeRef(expr ast.Expr, importPath string) typeRef {
	switch typed := expr.(type) {
	case *ast.Ident:
		return typeRef{importPath: importPath, name: typed.Name}
	case *ast.StarExpr:
		return receiverTypeRef(typed.X, importPath)
	}
	return typeRef{}
}

func paramNames(decl *ast.FuncDecl) []string {
	if decl.Type.Params == nil {
		return nil
	}
	var names []string
	for _, field := range decl.Type.Params.List {
		for _, name := range field.Names {
			names = append(names, name.Name)
		}
	}
	return names
}

func importsByName(file *ast.File) map[string]string {
	imports := map[string]string{}
	for _, spec := range file.Imports {
		path, err := strconv.Unquote(spec.Path.Value)
		if err != nil {
			continue
		}
		if spec.Name != nil {
			if spec.Name.Name == "_" || spec.Name.Name == "." {
				continue
			}
			imports[spec.Name.Name] = path
			continue
		}
		parts := strings.Split(path, "/")
		imports[parts[len(parts)-1]] = path
	}
	return imports
}

func readModulePath(goModPath string) (string, error) {
	file, err := os.Open(goModPath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "module ") {
			modulePath := strings.TrimSpace(strings.TrimPrefix(line, "module "))
			if modulePath == "" {
				return "", errors.New("empty module path")
			}
			return modulePath, nil
		}
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	return "", errors.New("go.mod module path not found")
}

func (s *analysisState) groupPrefixFromCall(file *goFile, call *ast.CallExpr, groupPrefixes map[string]string) (string, bool) {
	selector, ok := call.Fun.(*ast.SelectorExpr)
	if !ok || selector.Sel.Name != "Group" || len(call.Args) == 0 {
		return "", false
	}
	relativePath, ok := s.stringValue(file, call.Args[0])
	if !ok {
		return "", false
	}
	if ident, ok := selector.X.(*ast.Ident); ok {
		if base, ok := groupPrefixes[ident.Name]; ok {
			return joinRoutePath(base, relativePath), true
		}
	}
	return cleanRoutePath(relativePath), true
}

func (s *analysisState) stringValue(file *goFile, expr ast.Expr) (string, bool) {
	switch typed := expr.(type) {
	case *ast.BasicLit:
		if typed.Kind != token.STRING {
			return "", false
		}
		value, err := strconv.Unquote(typed.Value)
		if err != nil {
			return "", false
		}
		return value, true
	case *ast.Ident:
		if value, ok := file.consts[typed.Name]; ok {
			return value, true
		}
		value, ok := s.stringConsts[file.importPath+"."+typed.Name]
		return value, ok
	case *ast.SelectorExpr:
		ident, ok := typed.X.(*ast.Ident)
		if !ok {
			return "", false
		}
		importPath, ok := file.imports[ident.Name]
		if !ok {
			return "", false
		}
		value, ok := s.stringConsts[importPath+"."+typed.Sel.Name]
		return value, ok
	case *ast.BinaryExpr:
		if typed.Op != token.ADD {
			return "", false
		}
		left, ok := s.stringValue(file, typed.X)
		if !ok {
			return "", false
		}
		right, ok := s.stringValue(file, typed.Y)
		if !ok {
			return "", false
		}
		return left + right, true
	}
	return "", false
}

func isHTTPMethod(method string) bool {
	switch method {
	case "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS":
		return true
	default:
		return false
	}
}

func functionID(importPath string, receiver string, name string) string {
	if receiver != "" {
		return importPath + ".(" + receiver + ")." + name
	}
	return importPath + "." + name
}

func (r typeRef) valid() bool {
	return r.importPath != "" && r.name != ""
}

func (r typeRef) key() string {
	return r.importPath + "." + r.name
}

func routeContextKey(ctx routeContext) string {
	parts := make([]string, 0, len(ctx.paramPrefixes))
	for key, value := range ctx.paramPrefixes {
		parts = append(parts, key+"="+value)
	}
	sort.Strings(parts)
	return ctx.funcID + "|" + strings.Join(parts, ",")
}

func copyStringMap(input map[string]string) map[string]string {
	output := make(map[string]string, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func joinRoutePath(prefix string, path string) string {
	prefix = cleanRoutePath(prefix)
	path = cleanRoutePath(path)
	if prefix == "/" {
		return path
	}
	if path == "/" {
		return prefix
	}
	return prefix + path
}

func cleanRoutePath(path string) string {
	if path == "" {
		return "/"
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return strings.TrimRight(path, "/")
}

func normalizeMode(mode string) string {
	switch mode {
	case "", model.AnalyzeModeFast:
		return model.AnalyzeModeFast
	case model.AnalyzeModeAccurate:
		return model.AnalyzeModeAccurate
	default:
		return model.AnalyzeModeFast
	}
}
