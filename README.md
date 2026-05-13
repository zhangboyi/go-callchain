# Go Callchain Service

Go 调用链分析服务，用于查询接口调用链、基于 MR 分析影响接口和影响逻辑。

仓库来源支持：

```text
1. 本地 Go 仓库路径
2. Git URL + ref
```

## 文档

- [实现方案](docs/implementation-plan.md)
- [部署与 VSCode 插件打包指南](docs/deployment.md)
- [Superpowers 执行计划](docs/superpowers/plans/2026-05-11-go-callchain-service-mvp.md)

## 启动

后端：

```bash
go run ./cmd/server -addr 127.0.0.1:8787
```

前端：

```bash
npm --prefix web install
npm --prefix web run dev -- --port 5173
```

访问：

```text
http://127.0.0.1:8787
```

## VSCode 插件

源码目录：

```text
vscode-extension
```

本地开发：

```bash
cd vscode-extension
npm install
npm run compile
```

在 VSCode 中打开 `vscode-extension`，按 `F5` 启动 Extension Development Host。

插件能力：

```text
分析工作区
选择分析目录
查看接口调用链
分析 MR Impact
查看函数调用链
查看 Graph
重启服务
```

插件在 Activity Bar 中显示为 `Code Analysis`，包含 `Interface Callchain`、`MR Impact`、`Function Callchain` 三个视图。`Interface Callchain` 是主入口：分析完成后选择 `METHOD + PATH`，展示接口到业务逻辑的调用链并支持 Graph 和源码跳转。`MR Impact` 展示 `base...head` 影响面，点击 impacted API 会进入接口调用链视角。`Function Callchain` 保留为高级入口，入口函数通过顶部 `查看调用链` 的可搜索列表选择，不在树里展开全量函数。Graph 支持卡片拖动、画布拖动、节点子树展开/折叠、`Graph Actions` 菜单、全屏查看、PNG 复制、PNG 导出、hover 完整提示和源码跳转。函数行 CodeLens 只保留 `Show Callchain`。

VSIX 内置后端二进制：

```text
vscode-extension/bin/darwin-arm64/go-callchain-service
```

安装插件后默认自动启动内置后端，不需要手动启动 `go-callchain-service`，也不需要配置 `goCallchain.serviceCwd`。

如果同一个 VSCode 父目录里同时放了前端仓库和后端仓库，可以执行：

```text
Go Callchain: Select Analysis Directory
```

也可以固定配置：

```json
{
  "goCallchain.repositoryPath": "TCM-BE"
}
```

默认连接：

```text
http://127.0.0.1:8787
```

只有需要覆盖后端二进制时，才配置：

```json
{
  "goCallchain.serviceBinary": "/path/to/go-callchain-service"
}
```

打包、安装和发布配置见：

```text
docs/deployment.md
```

## 命令行验收

快速 AST 模式：

```bash
go run ./cmd/server -analyze /Users/boyi.zhang/Work/BizProjects/TCM/TCM-BE -method POST -path /tcm/api/v1/testcase_plans
```

SSA/PTA 增强模式：

```bash
go run ./cmd/server -analyze /Users/boyi.zhang/Work/BizProjects/TCM/TCM-BE -mode accurate -method POST -path /tcm/api/v1/testcase_plans
```

Git URL：

```bash
go run ./cmd/server -git-url git@github.com:org/repo.git -ref feature/foo -mode accurate -method POST -path /api/path
```

Git 仓库管理：

```bash
curl -X POST http://127.0.0.1:8787/api/v1/repositories \
  -H 'Content-Type: application/json' \
  -d '{"name":"TCM BE","url":"git@github.com:org/repo.git","default_ref":"master"}'

curl http://127.0.0.1:8787/api/v1/repositories
REPO_ID=repo_id_from_list
curl "http://127.0.0.1:8787/api/v1/repositories/${REPO_ID}/refs"
curl -X POST "http://127.0.0.1:8787/api/v1/repositories/${REPO_ID}/sync"
```

MR 影响面：

```bash
go run ./cmd/server -impact -analyze /path/to/repo -base main -head feature/foo -mode accurate
```

## API 示例

- [examples/tcm-be.http](examples/tcm-be.http)

## 第一阶段验收目标

```text
输入仓库：
/Users/boyi.zhang/Work/BizProjects/TCM/TCM-BE

服务识别：
POST /tcm/api/v1/testcase_plans

调用链输出：
TestcasePlanController.Create
-> TestcasePlanViewImpl.Create
-> TestcasePlanServiceImpl.Create
```
