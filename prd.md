# Go 调用链分析服务 PRD

## 1. 背景

Go 后端项目中，接口到业务逻辑的调用链通常分散在 router、controller、view、service、dao 等多层代码中。测试、研发或代码评审人员在分析接口影响面时，需要手动查找路由、函数调用、MR diff 和受影响接口，成本高且容易遗漏。

当前已验证的 MVP 能够生成函数索引和部分静态调用边，但在 TCM-BE 这类 Gin 项目中，暂不能完整识别 `Group prefix`、controller 构造变量、结构体字段接口调用等真实工程写法。因此需要建设一个可用的本地服务，支持接口调用链查询和 MR 影响面分析。

## 2. 产品目标

```text
1. 用户可以配置本地 Go 仓库或 Git URL。
2. 用户可以基于指定仓库分析接口列表。
3. 用户可以查询某个接口的下游调用链。
4. 用户可以基于 MR 的 base/head 分析受影响接口和逻辑链路。
5. 用户可以通过 Web UI 查看接口、调用树、影响面和原始 JSON。
```

## 3. 目标用户

```text
1. 测试工程师：用于判断接口影响范围和回归测试范围。
2. 后端研发：用于理解接口实现链路和评估代码改动影响。
3. Code Review 参与者：用于辅助判断 MR 风险。
4. 测试平台建设者：用于后续对接覆盖率、用例管理和测试推荐。
```

## 4. 核心场景

### 4.1 查看接口调用链

用户输入仓库和接口：

```text
repo: /Users/boyi.zhang/Work/BizProjects/TCM/TCM-BE
method: POST
path: /tcm/api/v1/testcase_plans
```

系统返回：

```text
POST /tcm/api/v1/testcase_plans
-> TestcasePlanController.Create
-> TestcasePlanViewImpl.Create
-> TestcasePlanServiceImpl.Create
```

### 4.2 基于 MR 分析影响接口

用户输入仓库和分支：

```text
source: Git URL 或本地仓库路径
base: master
head: feature/foo
```

系统返回：

```text
1. MR 修改了哪些函数。
2. 这些函数被哪些接口调用。
3. 每个受影响接口的调用路径。
4. 影响风险等级。
```

### 4.3 使用 Git URL 分析仓库

用户输入：

```text
git url: git@github.com:org/repo.git
ref: feature/foo
```

系统处理：

```text
1. clone 或 fetch 到服务本地 workspace。
2. checkout 指定 ref。
3. 对 checkout 后的本地工作区执行分析。
```

## 5. 功能需求

### 5.1 仓库来源配置

系统必须支持两种仓库来源：

```text
1. local：本地 Go 仓库路径。
2. git：Git URL + ref。
```

local source 示例：

```json
{
  "type": "local",
  "path": "/Users/boyi.zhang/Work/BizProjects/TCM/TCM-BE"
}
```

git source 示例：

```json
{
  "type": "git",
  "url": "git@github.com:org/repo.git",
  "ref": "feature/foo"
}
```

验收标准：

```text
1. local source 必须能识别包含 go.mod 的本地仓库。
2. git source 必须能复用用户本机 Git 凭证 clone 或 fetch 仓库。
3. git source 不在服务中保存账号、密码或 token。
4. git source 的代码副本必须放在 ~/.cache/go-callchain-service/repos/。
```

### 5.2 仓库分析任务

系统必须提供异步分析任务。

用户触发分析后，系统返回 `task_id` 和任务状态。分析完成后，用户可基于 `task_id` 查询接口、函数图和调用链。

任务状态：

```text
queued
running
done
failed
```

验收标准：

```text
1. 大仓库分析不会阻塞 HTTP 请求。
2. 用户可以查询任务进度和失败原因。
3. 同一仓库同一 commit 或同一 dirty hash 可以复用缓存。
```

### 5.3 接口识别

第一版必须支持 Gin 路由识别。

必须识别：

```go
r := gin.Default()
apiV1Group := r.Group("/tcm/api/v1", middleware.AuthToken())
initTestcasePlanRouter(apiV1Group)
```

必须识别：

```go
func initTestcasePlanRouter(group *gin.RouterGroup) {
    co := controller.NewTestcasePlanController()
    group.POST("/testcase_plans", co.Create)
}
```

期望输出：

```text
POST /tcm/api/v1/testcase_plans
-> tcm-be/app/tcm/controller.(TestcasePlanController).Create
```

验收标准：

```text
1. 能识别 Gin Group prefix。
2. 能识别 GET、POST、PUT、PATCH、DELETE。
3. 能识别 controller 构造变量。
4. 能将 co.Create 映射到具体 controller method。
```

### 5.4 函数调用链分析

第一版必须支持：

```text
1. 同包函数调用。
2. 跨包函数调用。
3. receiver method 调用。
4. 局部变量构造后的 method 调用。
5. struct 字段接口调用的简单实现绑定。
```

调用边必须包含：

```text
caller
callee
file
line
source
confidence
```

`source` 枚举：

```text
direct_call
package_selector
receiver_method
gin_route_handler
constructor_variable
struct_field_constructor_inference
```

`confidence` 枚举：

```text
exact
inferred
uncertain
```

验收标准：

```text
TCM-BE 中必须能连通：
TestcasePlanController.Create
-> TestcasePlanViewImpl.Create
-> TestcasePlanServiceImpl.Create
```

### 5.5 接口调用链查询

用户基于 `task_id + method + path` 查询接口调用链。

请求示例：

```json
{
  "task_id": "source-hash-ref-commit",
  "method": "POST",
  "path": "/tcm/api/v1/testcase_plans",
  "depth": 8
}
```

验收标准：

```text
1. 返回接口入口 handler。
2. 返回调用树。
3. 支持最大深度限制。
4. 支持展示调用边置信度。
5. 查询接口调用链不重复触发仓库分析。
```

### 5.6 MR 影响面分析

用户基于仓库和 `base/head` 分析 MR 影响面。

请求示例：

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

系统必须返回：

```text
1. changed_functions
2. impacted_interfaces
3. chain
4. risk
```

验收标准：

```text
1. 能通过 git diff base...head 获取变更文件和变更行。
2. 能将变更行映射到函数。
3. 能通过反向调用图找到受影响接口。
4. 能输出接口到变更函数的调用路径。
```

### 5.7 Web UI

前端必须提供：

```text
1. Repo 输入区：支持 local path 和 Git URL。
2. Analyze 按钮：触发分析任务。
3. 任务状态展示：queued、running、done、failed。
4. RouteTable：展示接口列表。
5. CallTree：展示接口调用链。
6. ImpactPanel：输入 base/head，展示 MR 影响面。
7. FunctionDrawer：展示函数详情和原始 JSON。
```

第一版不做复杂图谱渲染，只做：

```text
Table + Tree + JSON Drawer
```

验收标准：

```text
1. 打开 http://127.0.0.1:8787 可访问页面。
2. 输入 TCM-BE 本地路径后能触发分析。
3. 页面能展示 POST /tcm/api/v1/testcase_plans。
4. 点击接口后能展示调用链。
5. 页面不因大调用图一次性渲染而卡死。
```

## 6. 非功能需求

### 6.1 性能

```text
1. 分析任务异步执行。
2. 默认单次分析超时 5min。
3. 默认调用链最大深度 8。
4. 分析结果可缓存复用。
```

### 6.2 资源限制

```text
1. 默认最大 Go 文件数：10000。
2. 默认最大单文件大小：2MB。
3. 默认最大仓库工作区大小：2GB。
4. Git source 默认不递归拉取 submodule。
5. Git source 默认不执行 Git LFS pull。
```

### 6.3 安全

```text
1. local source 仅允许扫描用户显式输入的本机目录。
2. 默认拒绝扫描 /、/Users、/System、/Applications 等根目录。
3. git source 仅访问用户显式输入的 Git URL。
4. 不在服务内保存账号密码或 token。
5. Git 访问复用用户本机已有凭证。
6. 分析结果仅保存在本地。
```

### 6.4 缓存一致性

缓存 key 必须包含：

```text
source type
source identity
ref
HEAD commit
dirty hash
analyzer version
```

dirty worktree 处理：

```text
1. 如果 repo 是 git 仓库，读取 HEAD commit。
2. 如果 git status --porcelain 非空，计算 git diff + untracked file list hash。
3. 如果不是 git 仓库，使用 go.mod mtime + go file list hash。
```

## 7. API 需求

### 7.1 Health

```http
GET /health
```

### 7.2 创建分析任务

```http
POST /api/v1/analyze
```

### 7.3 查询分析任务

```http
GET /api/v1/analyze/:task_id
```

### 7.4 查询接口列表

```http
GET /api/v1/routes?task_id=source-hash-ref-commit
```

### 7.5 查询接口调用链

```http
POST /api/v1/callchain/interface
```

### 7.6 查询函数调用链

```http
POST /api/v1/callchain/function
```

### 7.7 MR 影响面分析

```http
POST /api/v1/impact/mr
```

## 8. 阶段规划

### 8.1 第一阶段：服务骨架和 TCM-BE 路由可识别

```text
1. 初始化服务项目。
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

### 8.2 第二阶段：Git URL 仓库来源

```text
1. 实现 git source clone/fetch/checkout。
2. 实现 Git workspace 缓存。
3. Analyze API 支持 source.type=git。
4. Interface callchain API 支持 task_id 查询 git source 分析结果。
5. 前端数据模型支持 local/git 两种 source。
```

验收：

```text
输入 Git URL + ref 后，服务能 clone 到 ~/.cache/go-callchain-service/repos 并完成 /routes 查询。
```

### 8.3 第三阶段：Web UI 可用

```text
1. 初始化 Vite React。
2. 实现 RepoAnalyzer。
3. 实现 RouteTable。
4. 实现 CallTree。
5. 实现 ImpactPanel。
6. Gin 托管 web dist。
```

验收：

```text
http://127.0.0.1:8787 可打开。
页面可展示 POST /tcm/api/v1/testcase_plans。
页面可展示接口调用树。
```

### 8.4 第四阶段：MR 影响面分析

```text
1. 实现 git diff base...head。
2. 实现 changed line -> function。
3. 实现 reverse graph -> route。
4. 实现 /impact/mr。
5. 前端展示 impacted interfaces。
```

### 8.5 第五阶段：SSA/PTA 增强

```text
1. 引入 go/packages。
2. 引入 go/ssa。
3. 引入 callgraph。
4. 增加 fast/accurate 两种模式。
5. 用 AST route index + SSA callgraph 合并结果。
```

## 9. 明确不做

第一版不支持：

```text
1. 反射调用。
2. 字符串拼接路由。
3. 复杂泛型类型推断。
4. 跨服务 RPC 调用链。
5. 消息队列异步链路。
6. 前端代码到后端接口的自动映射。
7. MR URL 直接解析。
8. Git 平台账号或 token 管理。
```

## 10. 总体验收标准

```text
1. go test ./... 通过。
2. go run ./cmd/server 可启动。
3. GET /health 返回 ok。
4. Web 页面可访问。
5. TCM-BE 的 POST /tcm/api/v1/testcase_plans 可被识别。
6. 该接口调用链至少能展示到 TestcasePlanServiceImpl.Create。
7. Git URL + ref 可完成仓库准备和接口分析。
8. MR impact 可返回 changed_functions 和 impacted_interfaces。
```
