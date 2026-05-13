# Go 调用链分析服务实现方案

## 方案审查结论

该方案没有阻塞性问题，可以落地。

Superpowers 复核结论：

- 当前文档是技术方案，不是最终可执行任务计划；真正开始实现前，需要再拆成 `docs/superpowers/plans/YYYY-MM-DD-go-callchain-service.md` 形式的逐步执行计划。
- Git URL 已被定义为目标能力，不能放到很后面的阶段；应在前端前完成后端 Git source 能力，否则 UI 很快会被本地路径假设绑死。
- 查询类 API 应优先使用 `task_id`，避免每次查询接口调用链都重复触发仓库解析。
- local source 的缓存 key 不能只依赖 HEAD commit；dirty worktree 会导致缓存失真。
- AST 推断出的调用边需要标记来源和置信度，否则前端无法区分“准确识别”和“启发式推断”。

需要补齐的工程约束：

- 分析任务必须异步化，避免大仓库扫描阻塞 HTTP 请求。
- repo 来源必须抽象成统一模型，同时支持本地路径和 Git URL。
- 本地 repo 路径必须做校验，避免服务被当作任意文件扫描入口。
- Git URL 必须 clone 到服务托管的本地 workspace 后再分析，不能直接在用户目录里散落副本。
- Gin 路由识别必须覆盖 Group prefix、controller 构造变量和 selector handler。
- 前端不能一次性渲染完整大图，第一版只展示接口表、调用树和按需展开 JSON。
- 分析任务必须有资源上限：最大文件数、最大单文件大小、最大分析时长、最大调用链深度。
- 第一版先用 AST + 类型追踪验证产品闭环，SSA/PTA 作为第二阶段增强。

## 项目路径

```text
/Users/boyi.zhang/Work/ai/go-callchain-service
```

## 目标

```text
1. 支持本地路径或 Git URL 配置 Go 仓库，生成函数图、接口入口图、行号函数索引。
2. 查询某个接口的下游调用链。
3. 基于 MR diff 返回受影响接口、函数、调用路径。
4. 提供本地 Web UI，支持可视化验证分析结果。
5. 第一版优先覆盖 Gin 项目，必须支持 TCM-BE 写法。
```

## 技术选型

```text
后端语言：Go
后端框架：Gin
前端框架：Vite + React + TypeScript
UI 组件：Ant Design
调用链展示：Tree + Table
缓存：本地 JSON cache
第一阶段分析引擎：go/ast + 自定义类型追踪
第二阶段分析引擎：go/packages + go/ssa + go/callgraph
```

## 总体架构

```text
Web UI
  -> REST API
    -> Analyze Service
      -> Repository Source Manager
      -> Repo Scanner
      -> Route Analyzer
      -> Call Analyzer
      -> Impact Analyzer
      -> Cache Store
```

## 后端模块

```text
cmd/server
  服务入口，启动 Gin HTTP Server。

internal/api
  HTTP handler，请求校验，响应格式化。

internal/service
  编排分析任务、查询任务、MR impact 任务。

internal/repository
  管理仓库来源，支持 local path、git clone、git fetch、ref checkout。

internal/analyzer
  Go 代码扫描、AST 解析、函数索引、调用边生成。

internal/route
  Gin 路由识别，负责 path/method/handler 映射。

internal/graph
  正向调用图、反向调用图、调用树查询。

internal/gitdiff
  git diff 解析，定位变更文件和变更行。

internal/cache
  按 repo + commit 缓存分析结果。

web
  React 前端。
```

## 目录结构

```text
go-callchain-service/
├── cmd/
│   └── server/
│       └── main.go
├── internal/
│   ├── api/
│   ├── analyzer/
│   ├── cache/
│   ├── config/
│   ├── gitdiff/
│   ├── graph/
│   ├── model/
│   ├── repository/
│   ├── route/
│   └── service/
├── web/
│   ├── package.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── api/
│       ├── components/
│       ├── App.tsx
│       ├── main.tsx
│       └── types.ts
├── docs/
│   └── implementation-plan.md
├── examples/
│   └── tcm-be.http
├── testdata/
├── README.md
└── go.mod
```

## API 设计

### Repo Source 模型

所有分析 API 都使用统一 repo source，避免后续把本地路径和 Git URL 写成两套逻辑。

本地仓库：

```json
{
  "source": {
    "type": "local",
    "path": "/Users/boyi.zhang/Work/BizProjects/TCM/TCM-BE"
  }
}
```

Git 仓库：

```json
{
  "source": {
    "type": "git",
    "url": "git@github.com:org/repo.git",
    "ref": "master"
  }
}
```

字段说明：

```text
type: local | git
path: 本地仓库路径，仅 local 使用
url: Git remote URL，仅 git 使用
ref: branch / tag / commit，git 使用；为空时使用 remote 默认分支
```

第一版 Git URL 只支持用户本机已有 Git 凭证可访问的仓库，不在服务内保存账号密码或 token。

### Health

```http
GET /health
```

响应：

```json
{
  "status": "ok"
}
```

### 创建分析任务

```http
POST /api/v1/analyze
```

请求：

```json
{
  "source": {
    "type": "local",
    "path": "/Users/boyi.zhang/Work/BizProjects/TCM/TCM-BE"
  },
  "force": false
}
```

Git URL 请求：

```json
{
  "source": {
    "type": "git",
    "url": "git@github.com:org/repo.git",
    "ref": "feature/foo"
  },
  "force": false
}
```

响应：

```json
{
  "task_id": "source-hash-ref-commit",
  "status": "running"
}
```

### 查询分析任务

```http
GET /api/v1/analyze/:task_id
```

响应：

```json
{
  "task_id": "source-hash-ref-commit",
  "status": "done",
  "workspace": "~/.cache/go-callchain-service/repos/source-hash/worktree",
  "commit": "HEAD_SHA",
  "functions": 1498,
  "edges": 1817,
  "routes": 106
}
```

### 查询接口列表

```http
GET /api/v1/routes?task_id=source-hash-ref-commit
```

响应：

```json
{
  "routes": [
    {
      "method": "POST",
      "path": "/tcm/api/v1/testcase_plans",
      "handler": "tcm-be/app/tcm/controller.(TestcasePlanController).Create",
      "file": "app/tcm/router/testcase_plan_router.go",
      "line": 11
    }
  ]
}
```

### 查询接口调用链

```http
POST /api/v1/callchain/interface
```

请求：

```json
{
  "task_id": "source-hash-ref-commit",
  "method": "POST",
  "path": "/tcm/api/v1/testcase_plans",
  "depth": 8
}
```

说明：

```text
查询类 API 优先使用 task_id。
如果前端只传 source，后端可以自动复用或创建分析任务，但第一版 UI 使用 task_id，避免重复分析。
```

响应：

```json
{
  "route": {
    "method": "POST",
    "path": "/tcm/api/v1/testcase_plans",
    "handler": "tcm-be/app/tcm/controller.(TestcasePlanController).Create"
  },
  "tree": {
    "function": "tcm-be/app/tcm/controller.(TestcasePlanController).Create",
    "children": [
      {
        "function": "tcm-be/app/tcm/view.(TestcasePlanViewImpl).Create",
        "children": [
          {
            "function": "tcm-be/service.(TestcasePlanServiceImpl).Create",
            "children": []
          }
        ]
      }
    ]
  }
}
```

### 查询函数调用链

```http
POST /api/v1/callchain/function
```

请求：

```json
{
  "task_id": "source-hash-ref-commit",
  "function": "tcm-be/service.(TestcasePlanServiceImpl).Create",
  "depth": 8
}
```

### MR 影响面分析

```http
POST /api/v1/impact/mr
```

请求：

```json
{
  "source": {
    "type": "git",
    "url": "git@github.com:org/repo.git",
    "ref": "feature/foo"
  },
  "base": "master",
  "head": "feature/foo",
  "depth": 8
}
```

MR 影响面第一版以 `base/head` ref 为准，不依赖具体 Git 平台。

后续增强支持 MR URL：

```json
{
  "source": {
    "type": "git",
    "url": "git@github.com:org/repo.git"
  },
  "mr_url": "https://github.com/org/repo/pull/123",
  "depth": 8
}
```

MR URL 需要接入 GitHub / GitLab / 内部 Git 平台 adapter 后再实现，第一版不作为硬验收。

响应：

```json
{
  "changed_functions": [
    {
      "id": "tcm-be/service.(TestcasePlanServiceImpl).Create",
      "file": "service/testcase_plan_service.go",
      "start_line": 135,
      "end_line": 164
    }
  ],
  "impacted_interfaces": [
    {
      "method": "POST",
      "path": "/tcm/api/v1/testcase_plans",
      "chain": [
        "tcm-be/app/tcm/controller.(TestcasePlanController).Create",
        "tcm-be/app/tcm/view.(TestcasePlanViewImpl).Create",
        "tcm-be/service.(TestcasePlanServiceImpl).Create"
      ],
      "risk": "indirect"
    }
  ]
}
```

## 前端设计

### 页面布局

```text
顶部：Repo 输入区
左侧：接口列表
右侧：调用链 Tree
底部：MR 影响面分析面板
抽屉：原始 JSON / 函数详情
```

### 主要组件

```text
RepoAnalyzer
  输入本地 repo 或 Git URL，触发分析，展示任务状态。

RouteTable
  展示 method、path、handler、文件行号。

CallTree
  展示接口或函数调用链，支持展开/折叠。

ImpactPanel
  输入 base/head，展示受影响接口和链路。

FunctionDrawer
  展示函数 ID、文件、起止行、原始调用边。
```

### 前端验收

```text
打开：
http://127.0.0.1:8787

输入：
/Users/boyi.zhang/Work/BizProjects/TCM/TCM-BE

点击 Analyze 后看到：
POST /tcm/api/v1/testcase_plans

点击接口后看到：
TestcasePlanController.Create
-> TestcasePlanViewImpl.Create
-> TestcasePlanServiceImpl.Create
```

## Gin 路由识别规则

必须支持：

```go
r := gin.Default()
apiV1Group := r.Group("/tcm/api/v1", middleware.AuthToken())
initTestcasePlanRouter(apiV1Group)
```

必须支持：

```go
func initTestcasePlanRouter(group *gin.RouterGroup) {
    co := controller.NewTestcasePlanController()
    group.POST("/testcase_plans", co.Create)
}
```

识别结果：

```text
POST /tcm/api/v1/testcase_plans
-> tcm-be/app/tcm/controller.(TestcasePlanController).Create
```

## 调用识别规则

第一阶段必须支持：

```text
1. 同包函数调用
2. 跨包函数调用
3. receiver method 调用
4. 局部变量构造后的 method 调用
5. struct 字段接口调用的简单实现绑定
```

调用边必须带来源和置信度：

```json
{
  "caller": "tcm-be/app/tcm/controller.(TestcasePlanController).Create",
  "callee": "tcm-be/app/tcm/view.(TestcasePlanViewImpl).Create",
  "source": "struct_field_constructor_inference",
  "confidence": "inferred",
  "file": "app/tcm/controller/testcase_plan_controller.go",
  "line": 28
}
```

取值：

```text
source:
- direct_call
- package_selector
- receiver_method
- gin_route_handler
- constructor_variable
- struct_field_constructor_inference

confidence:
- exact
- inferred
- uncertain
```

TCM-BE 需要覆盖：

```go
co.testcasePlanView.Create(c, &req)
```

期望识别：

```text
co.testcasePlanView.Create
-> tcm-be/app/tcm/view.(TestcasePlanViewImpl).Create
```

需要基于构造函数解析：

```go
func NewTestcasePlanController() *TestcasePlanController {
    return &TestcasePlanController{
        testcasePlanView: view.NewTestcasePlanView(),
    }
}
```

继续解析：

```go
func NewTestcasePlanView() TestcasePlanView {
    return &TestcasePlanViewImpl{
        testcasePlanService: service.NewTestcasePlanService(),
    }
}
```

最终连接：

```text
TestcasePlanController.Create
-> TestcasePlanViewImpl.Create
-> TestcasePlanServiceImpl.Create
```

## 缓存设计

缓存 key：

```text
source type + source identity + ref + HEAD commit + analyzer version
```

source identity：

```text
local: absolute path hash
git: normalized remote URL hash
```

local source 的 dirty worktree 处理：

```text
1. 如果 repo 是 git 仓库，读取 HEAD commit。
2. 如果 git status --porcelain 非空，计算 git diff + untracked file list hash。
3. local cache key = absolute path hash + HEAD commit + dirty hash + analyzer version。
4. 如果不是 git 仓库，使用 go.mod mtime + go file list hash + analyzer version。
```

缓存内容：

```text
functions.json
edges.json
routes.json
line_index.json
metadata.json
```

缓存目录：

```text
~/.cache/go-callchain-service/
```

Git workspace：

```text
~/.cache/go-callchain-service/repos/<source-hash>/repo.git
~/.cache/go-callchain-service/repos/<source-hash>/worktree/<ref-or-commit>
```

处理规则：

```text
1. Git URL 第一次分析时 clone 到 repo.git。
2. 后续分析先 fetch，再 checkout 指定 ref 到 worktree。
3. 同一个 Git URL 不重复 clone。
4. 不在业务目录下生成临时仓库。
5. 分析输入统一转换成本地 workspace path。
```

## 安全约束

```text
1. local source 仅允许扫描本机存在的目录。
2. git source 仅允许访问用户显式输入的 Git URL。
3. repo 必须包含 go.mod。
4. 默认拒绝扫描 /、/Users、/System、/Applications 等过大或敏感根目录。
5. 不读取 .git/config 以外的敏感配置。
6. 不在服务内保存账号密码或 token。
7. Git 访问复用用户本机已有凭证。
8. 所有分析结果只保存在本地。
```

资源上限：

```text
1. 默认最大 Go 文件数：10000。
2. 默认最大单文件大小：2MB。
3. 默认最大仓库工作区大小：2GB。
4. 默认单次分析超时：5min。
5. 默认调用链最大深度：8。
6. Git source 默认不递归拉取 submodule。
7. Git source 默认不执行 Git LFS pull。
```

## 实施阶段

### 第一阶段：服务骨架 + TCM-BE 路由可识别

```text
1. 初始化 Go module。
2. 实现 /health。
3. 实现 Repo Source 模型。
4. 支持 local source。
5. 搬迁当前 MVP analyzer。
6. 实现异步 analyze task。
7. 实现 Gin Group prefix 识别。
8. 实现 controller 构造变量识别。
9. 实现 /routes。
10. 实现 /callchain/interface。
11. 增加 TCM-BE 风格 fixture 测试。
```

验收：

```text
POST /tcm/api/v1/testcase_plans 可被识别。
```

### 第二阶段：Git URL 仓库来源

```text
1. 实现 git source clone/fetch/checkout。
2. 实现 Git workspace 缓存。
3. Analyze API 支持 source.type=git。
4. Interface callchain API 支持 task_id 查询 git source 分析结果。
5. 前端前置数据模型支持 local/git 两种 source。
```

验收：

```text
输入 Git URL + ref 后，服务能 clone 到 ~/.cache/go-callchain-service/repos 并完成 /routes 查询。
```

### 第三阶段：前端可用

```text
1. 初始化 Vite React。
2. 实现 RepoAnalyzer。
3. 实现 RouteTable。
4. 实现 CallTree。
5. Gin 托管 web dist。
6. 本地访问 http://127.0.0.1:8787。
```

验收：

```text
页面可输入 TCM-BE repo。
页面可展示 POST /tcm/api/v1/testcase_plans。
页面可展示接口调用树。
```

### 第四阶段：MR 影响面分析

```text
1. 实现 git diff base...head。
2. 实现 changed line -> function。
3. 实现 reverse graph -> route。
4. 实现 /impact/mr。
5. 前端展示 impacted interfaces。
```

### 第五阶段：SSA/PTA 增强

```text
1. 引入 go/packages。
2. 引入 go/ssa。
3. 引入 callgraph。
4. 增加 fast/accurate 两种模式。
5. 用 AST route index + SSA callgraph 合并结果。
```

## 明确边界

第一版不承诺支持：

```text
1. 反射调用。
2. 字符串拼接路由。
3. 复杂泛型类型推断。
4. 跨服务 RPC 调用链。
5. 消息队列异步链路。
6. 前端代码到后端接口的自动映射。
```

## 最终验收命令

```bash
cd /Users/boyi.zhang/Work/ai/go-callchain-service

go test ./...

go run ./cmd/server

curl http://127.0.0.1:8787/health
```

## 实现前置计划要求

开始写代码前，必须补一份可执行计划：

```text
docs/superpowers/plans/YYYY-MM-DD-go-callchain-service.md
```

计划必须包含：

```text
1. 每个阶段具体创建/修改的文件。
2. 每个任务先写失败测试，再写实现。
3. 每个任务对应的运行命令和预期结果。
4. TCM-BE 风格 fixture 的完整验收用例。
5. local source 和 git source 的独立测试。
```

## 最终验收页面

```text
http://127.0.0.1:8787
```
