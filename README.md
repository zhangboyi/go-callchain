# Go Callchain Service

Go 调用链分析服务，面向 Gin 项目识别接口入口、函数调用链和 MR 影响面。项目包含 HTTP 后端、Web 控制台和 VSCode 插件。

## 核心能力

- 分析本地 Go 仓库、临时 Git URL + ref、已保存 Git 仓库。
- 识别 Gin route、handler、函数定义、调用边、文件行号和调用边来源。
- 查询接口调用链、函数调用链、函数详情、文件树和源码内容。
- 基于 `base...head` 分析 Changed Functions 和 Impacted Interfaces。
- Web 控制台支持 Local / Git / Saved 三类来源、仓库保存、同步 refs、分支切换、调用图、源码浏览和 Raw JSON。
- VSCode 插件支持自动启动内置后端、选择分析目录、接口调用链、函数调用链、MR Impact、Graph、源码跳转和 PNG 导出。

## 技术栈

```text
Backend: Go 1.25 + Gin
Analyzer: go/ast + go/packages + go/ssa/callgraph
Frontend: Vite + React + TypeScript + Ant Design + React Flow
VSCode Extension: TypeScript + VSCode API
Cache: local JSON cache
```

## 目录结构

```text
cmd/server                 # 服务入口和 one-shot CLI
internal/api               # HTTP router
internal/analyzer          # Go AST/SSA 分析
internal/cache             # 分析结果缓存
internal/gitdiff           # base...head diff 解析
internal/graph             # 调用图和调用树
internal/model             # API 数据模型
internal/repository        # local/git/managed repo 管理
internal/service           # 分析任务和影响面编排
web                        # Web 控制台
vscode-extension           # VSCode 插件
examples                   # HTTP 示例
docs                       # 实现、部署和打包文档
testdata                   # 分析器测试仓库
```

## 环境要求

- Go 1.25 或以上
- Node.js 20 或以上
- npm
- Git
- VSCode 1.90 或以上

使用 Git URL 或受管 Git 仓库时，运行服务的账号必须具备对应仓库的 clone/fetch 权限。

## 本地启动

一键部署并后台启动 Web 服务：

```bash
cd ./go-callchain-service
./scripts/deploy-web.sh
```

脚本默认监听 `0.0.0.0:8787`，会输出 `127.0.0.1` 和本机 IP 访问地址。脚本会自动识别当前系统和 CPU 架构，例如 macOS Apple Silicon 会自动按 `darwin/arm64` 构建，Linux x86_64 会自动按 `linux/amd64` 构建。

只构建发布目录，不启动服务：

```bash
./scripts/deploy-web.sh build
```

指定监听 host/port：

```bash
./scripts/deploy-web.sh start --host 0.0.0.0 --port 8787
./scripts/deploy-web.sh start --addr 0.0.0.0:8787
```

后台服务管理：

```bash
./scripts/deploy-web.sh status
./scripts/deploy-web.sh restart
./scripts/deploy-web.sh stop
```

查看日志：

```bash
tail -f release/go-callchain-service/go-callchain-service.log
```

给其他系统构建发布包时再显式指定目标平台：

```bash
./scripts/deploy-web.sh build --target linux-amd64
./scripts/deploy-web.sh build --target linux-arm64
./scripts/deploy-web.sh build --target darwin-arm64
```

手动启动流程：

```bash
cd /Users/boyi.zhang/Work/ai/go-callchain-service
npm --prefix web ci
npm --prefix web run build
go test ./...
go run ./cmd/server -addr 127.0.0.1:8787
```

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

访问 Web 控制台：

```text
http://127.0.0.1:8787
```

服务默认只监听 `127.0.0.1:8787`。需要局域网访问时：

```bash
go run ./cmd/server -addr 0.0.0.0:8787
```

当前服务没有内置鉴权，非本机访问需要放在受控网络或反向代理鉴权后面。

## Web 开发模式

后端：

```bash
go run ./cmd/server -addr 127.0.0.1:8787
```

前端：

```bash
npm --prefix web ci
npm --prefix web run dev -- --port 5173
```

Vite 开发地址：

```text
http://127.0.0.1:5173
```

## API

### 健康检查

```http
GET /health
```

### 分析本地仓库

```bash
curl -X POST http://127.0.0.1:8787/api/v1/analyze \
  -H 'Content-Type: application/json' \
  -d '{
    "source": {
      "type": "local",
      "path": "/path/to/go/repo"
    },
    "mode": "fast",
    "force": true
  }'
```

### 分析 Git URL

```bash
curl -X POST http://127.0.0.1:8787/api/v1/analyze \
  -H 'Content-Type: application/json' \
  -d '{
    "source": {
      "type": "git",
      "url": "git@github.com:org/repo.git",
      "ref": "feature/foo"
    },
    "mode": "accurate"
  }'
```

### 查询任务状态

```bash
curl "http://127.0.0.1:8787/api/v1/analyze/${TASK_ID}"
```

### 查询接口列表

```bash
curl "http://127.0.0.1:8787/api/v1/routes?task_id=${TASK_ID}"
```

### 查询接口调用链

```bash
curl -X POST http://127.0.0.1:8787/api/v1/callchain/interface \
  -H 'Content-Type: application/json' \
  -d '{
    "task_id": "'"${TASK_ID}"'",
    "method": "POST",
    "path": "/api/path",
    "depth": 8
  }'
```

### 查询函数调用链

```bash
curl -X POST http://127.0.0.1:8787/api/v1/callchain/function \
  -H 'Content-Type: application/json' \
  -d '{
    "task_id": "'"${TASK_ID}"'",
    "function": "module/path/pkg.(Receiver).Method",
    "depth": 8
  }'
```

### 查询 MR 影响面

```bash
curl -X POST http://127.0.0.1:8787/api/v1/impact/mr \
  -H 'Content-Type: application/json' \
  -d '{
    "source": {
      "type": "local",
      "path": "/path/to/go/repo"
    },
    "base": "master",
    "head": "feature/foo",
    "depth": 8,
    "mode": "fast"
  }'
```

### 受管 Git 仓库

```bash
curl -X POST http://127.0.0.1:8787/api/v1/repositories \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "TCM BE",
    "url": "git@github.com:org/repo.git",
    "default_ref": "master"
  }'

curl http://127.0.0.1:8787/api/v1/repositories
curl "http://127.0.0.1:8787/api/v1/repositories/${REPO_ID}/refs"
curl -X POST "http://127.0.0.1:8787/api/v1/repositories/${REPO_ID}/sync"
curl -X DELETE "http://127.0.0.1:8787/api/v1/repositories/${REPO_ID}"
```

完整示例：

```text
examples/tcm-be.http
```

## One-shot CLI

接口调用链：

```bash
go run ./cmd/server \
  -analyze /path/to/go/repo \
  -mode fast \
  -method POST \
  -path /api/path
```

Git URL：

```bash
go run ./cmd/server \
  -git-url git@github.com:org/repo.git \
  -ref feature/foo \
  -mode accurate \
  -method POST \
  -path /api/path
```

MR 影响面：

```bash
go run ./cmd/server \
  -impact \
  -analyze /path/to/go/repo \
  -base master \
  -head feature/foo \
  -mode accurate
```

## 数据目录

服务默认使用 Go user cache 目录：

```text
macOS: ~/Library/Caches/go-callchain-service
Linux: ~/.cache/go-callchain-service
```

目录内容：

```text
repositories.json       # 受管 Git 仓库配置
cache/                  # 分析结果缓存
repos/                  # Git URL 仓库镜像和 worktree
local-worktrees/        # 本地分支影响分析产生的临时 worktree
```

清理分析缓存：

```bash
rm -rf ~/Library/Caches/go-callchain-service/cache
```

清理全部服务数据：

```bash
rm -rf ~/Library/Caches/go-callchain-service
```

## VSCode 插件

源码目录：

```text
vscode-extension
```

本地开发：

```bash
cd vscode-extension
npm ci
npm run compile
```

在 VSCode 中打开 `vscode-extension`，按 `F5` 启动 Extension Development Host。

打包 VSIX：

```bash
cd /Users/boyi.zhang/Work/ai/go-callchain-service/vscode-extension
npm ci
npm test
VERSION=$(node -p "require('./package.json').version")
npx @vscode/vsce package --out "go-callchain-vscode-${VERSION}.vsix"
```

安装 VSIX：

```bash
VERSION=$(node -p "require('/Users/boyi.zhang/Work/ai/go-callchain-service/vscode-extension/package.json').version")
code --install-extension "/Users/boyi.zhang/Work/ai/go-callchain-service/vscode-extension/go-callchain-vscode-${VERSION}.vsix" --force
```

插件默认配置：

```json
{
  "goCallchain.serviceUrl": "http://127.0.0.1:8787",
  "goCallchain.autoStartService": true,
  "goCallchain.defaultBase": "master",
  "goCallchain.defaultDepth": 8,
  "goCallchain.mode": "fast"
}
```

多仓库工作区可指定分析目录：

```json
{
  "goCallchain.repositoryPath": "TCM-BE"
}
```

只有需要覆盖内置后端二进制时，才配置：

```json
{
  "goCallchain.serviceBinary": "/path/to/go-callchain-service"
}
```

插件视图：

```text
Code Analysis
├── Interface Callchain
├── MR Impact
└── Function Callchain
```

插件命令：

```text
Go Callchain: Analyze Workspace
Go Callchain: Select Analysis Directory
Go Callchain: Clear Analysis Directory
Go Callchain: Show Interface Callchain
Go Callchain: Analyze MR Impact
Go Callchain: Show Function Callchain
Go Callchain: Show Callchain Graph
Go Callchain: Restart Service
```

VSIX 内置 macOS Apple Silicon 后端：

```text
vscode-extension/bin/darwin-arm64/go-callchain-service
```

## 二进制部署

推荐使用脚本生成发布目录：

```bash
cd /Users/boyi.zhang/Work/ai/go-callchain-service
./scripts/deploy-web.sh build
```

跨平台构建：

```bash
./scripts/deploy-web.sh build --target linux-amd64
./scripts/deploy-web.sh build --target linux-arm64
./scripts/deploy-web.sh build --target darwin-arm64
```

未指定 `--target` 时，脚本自动识别当前系统并构建可直接运行的二进制。指定 `--target` 时，默认输出目录会带平台后缀：

```text
release/go-callchain-service-linux-amd64
release/go-callchain-service-linux-arm64
release/go-callchain-service-darwin-arm64
```

手动构建：

```bash
cd /Users/boyi.zhang/Work/ai/go-callchain-service
rm -rf release/go-callchain-service
mkdir -p release/go-callchain-service/web

npm --prefix web ci
npm --prefix web run build
go test ./...
go build -o release/go-callchain-service/go-callchain-service ./cmd/server
cp -R web/dist release/go-callchain-service/web/dist
```

发布目录必须保持：

```text
release/go-callchain-service/
├── go-callchain-service
└── web/
    └── dist/
        ├── index.html
        └── assets/
```

启动：

```bash
cd /Users/boyi.zhang/Work/ai/go-callchain-service/release/go-callchain-service
./go-callchain-service -addr 127.0.0.1:8787
```

`web/dist` 按服务进程当前工作目录读取。只复制二进制、不复制 `web/dist` 时，API 可用但 Web UI 不会注册静态页面。

## 文档

- [实现方案](docs/implementation-plan.md)
- [部署与 VSCode 插件打包指南](docs/deployment.md)
- [TCM-BE API 示例](examples/tcm-be.http)
- [VSCode 插件说明](vscode-extension/README.md)
