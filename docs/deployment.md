# Go Callchain Service 部署与 VSCode 插件打包指南

## 范围

本文档覆盖：

- `go-callchain-service` HTTP API 与 Web UI 的本地部署、二进制部署和后台运行。
- `vscode-extension` 的编译、测试、VSIX 打包、安装和服务连接配置。

## 环境要求

- Go 1.25 或以上。
- Node.js 20 或以上。
- npm。
- Git。
- VSCode 1.90 或以上。
- 使用 Git URL 分析远端仓库时，运行服务的账号必须具备对应仓库的 clone 权限。

## 本地开发部署

在仓库根目录执行：

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

预期返回：

```json
{"status":"ok"}
```

访问 Web UI：

```text
http://127.0.0.1:8787
```

服务默认只监听 `127.0.0.1:8787`。需要局域网访问时可改为：

```bash
go run ./cmd/server -addr 0.0.0.0:8787
```

当前服务没有内置鉴权，非本机访问建议放在受控网络或反向代理鉴权后面。

## 二进制部署

构建发布目录：

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

发布目录必须保持以下结构：

```text
release/go-callchain-service/
├── go-callchain-service
└── web/
    └── dist/
        ├── index.html
        └── assets/
```

启动服务：

```bash
cd /Users/boyi.zhang/Work/ai/go-callchain-service/release/go-callchain-service
./go-callchain-service -addr 127.0.0.1:8787
```

`web/dist` 是按进程当前工作目录读取的静态资源目录。只复制二进制、不复制 `web/dist` 时，API 可用但 Web UI 不会注册静态页面。

## 后台运行

macOS `launchd` 示例：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.local.go-callchain-service</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/boyi.zhang/Work/ai/go-callchain-service/release/go-callchain-service/go-callchain-service</string>
    <string>-addr</string>
    <string>127.0.0.1:8787</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/boyi.zhang/Work/ai/go-callchain-service/release/go-callchain-service</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/go-callchain-service.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/go-callchain-service.err.log</string>
</dict>
</plist>
```

启停命令：

```bash
cp com.local.go-callchain-service.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.local.go-callchain-service.plist
launchctl unload ~/Library/LaunchAgents/com.local.go-callchain-service.plist
```

Linux `systemd` 示例：

```ini
[Unit]
Description=Go Callchain Service
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/go-callchain-service
ExecStart=/opt/go-callchain-service/go-callchain-service -addr 127.0.0.1:8787
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启停命令：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now go-callchain-service
sudo systemctl status go-callchain-service
```

## 数据目录

服务默认数据目录来自 Go 的用户缓存目录：

```text
macOS: ~/Library/Caches/go-callchain-service
Linux: ~/.cache/go-callchain-service
```

主要内容：

```text
repositories.json       # Web UI 中保存的 Git 仓库配置
cache/                  # 分析结果缓存
repos/                  # Git URL 仓库镜像和 worktree
local-worktrees/        # 本地分支影响分析产生的临时 worktree
```

清理缓存：

```bash
rm -rf ~/Library/Caches/go-callchain-service/cache
```

删除全部服务数据会同时删除仓库配置、Git 镜像和分析缓存：

```bash
rm -rf ~/Library/Caches/go-callchain-service
```

## API 验收

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

本地仓库分析：

```bash
curl -X POST http://127.0.0.1:8787/api/v1/analyze \
  -H 'Content-Type: application/json' \
  -d '{
    "source": {
      "type": "local",
      "path": "/Users/boyi.zhang/Work/BizProjects/TCM/TCM-BE"
    },
    "mode": "fast",
    "force": true
  }'
```

查询任务状态：

```bash
TASK_ID=source-hash-ref-commit
curl "http://127.0.0.1:8787/api/v1/analyze/${TASK_ID}"
```

本地分支影响面：

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

## VSCode 插件打包

进入插件目录：

```bash
cd /Users/boyi.zhang/Work/ai/go-callchain-service/vscode-extension
npm ci
npm test
```

打包 VSIX：

```bash
VERSION=$(node -p "require('./package.json').version")
npx @vscode/vsce package --out "go-callchain-vscode-${VERSION}.vsix"
```

`vscode:prepublish` 会自动执行：

```bash
npm run build:server
npm run compile
```

当前 VSIX 内置 macOS Apple Silicon 后端：

```text
vscode-extension/bin/darwin-arm64/go-callchain-service
```

产物路径：

```text
/Users/boyi.zhang/Work/ai/go-callchain-service/vscode-extension/go-callchain-vscode-${VERSION}.vsix
```

`.vscodeignore` 已排除源码、测试、`node_modules` 和 sourcemap。打包前必须先执行 `npm test`，确保 `dist/` 是最新编译产物。

当前 `package.json` 未配置 `repository` 字段，仓库根目录也没有 `LICENSE` 文件，`vsce` 会输出 warning；本地 VSIX 可正常生成。发布到 VSCode Marketplace 前需要补齐这两项元数据。

## VSCode 插件安装

命令行安装：

```bash
VERSION=$(node -p "require('/Users/boyi.zhang/Work/ai/go-callchain-service/vscode-extension/package.json').version")
code --install-extension "/Users/boyi.zhang/Work/ai/go-callchain-service/vscode-extension/go-callchain-vscode-${VERSION}.vsix" --force
```

VSCode 图形界面安装：

```text
Extensions -> ... -> Install from VSIX... -> 选择 go-callchain-vscode-${VERSION}.vsix
```

## VSCode 插件配置

默认配置即可使用内置后端：

```json
{
  "goCallchain.serviceUrl": "http://127.0.0.1:8787",
  "goCallchain.autoStartService": true,
  "goCallchain.defaultBase": "master",
  "goCallchain.defaultDepth": 8,
  "goCallchain.mode": "fast"
}
```

覆盖内置二进制：

```json
{
  "goCallchain.serviceUrl": "http://127.0.0.1:8787",
  "goCallchain.autoStartService": true,
  "goCallchain.serviceBinary": "/Users/boyi.zhang/Work/ai/go-callchain-service/release/go-callchain-service/go-callchain-service",
  "goCallchain.defaultBase": "master",
  "goCallchain.defaultDepth": 8,
  "goCallchain.mode": "fast"
}
```

当 `serviceBinary` 和 VSIX 内置 binary 都不可用时，插件才会 fallback 到：

```json
{
  "goCallchain.serviceCommand": "go run ./cmd/server -addr 127.0.0.1:8787",
  "goCallchain.serviceCwd": "/Users/boyi.zhang/Work/ai/go-callchain-service"
}
```

如果服务已由 `launchd`、`systemd` 或终端手动启动，插件可关闭自动拉起：

```json
{
  "goCallchain.serviceUrl": "http://127.0.0.1:8787",
  "goCallchain.autoStartService": false
}
```

## VSCode 插件验收

1. 安装 VSIX 后重启 VSCode。
2. 打开一个包含 `go.mod` 的 Go 仓库。
3. 执行 `Go Callchain: Analyze Workspace`。
4. Activity Bar 中打开 `Code Analysis`。
5. 确认 `Interface Callchain`、`MR Impact` 和 `Function Callchain` 三个视图可见。
6. 执行 `Go Callchain: Show Interface Callchain`，选择 `METHOD + PATH` 查看接口调用链。
7. 在 Go 函数上执行 `Go Callchain: Show Function Callchain`。
8. 执行 `Go Callchain: Analyze MR Impact`，选择 `base...head`，点击 impacted API 确认可进入接口调用链视角。

异常排查：

```bash
curl http://127.0.0.1:8787/health
```

如果健康检查失败，优先检查：

- VSIX 是否包含 `bin/darwin-arm64/go-callchain-service`。
- `goCallchain.serviceBinary` 是否指向可执行文件。
- fallback 模式下 `goCallchain.serviceCwd` 和 `goCallchain.serviceCommand` 是否可执行。
- `web/dist` 是否存在于服务运行目录。
- 插件 Output 面板中的 `Go Callchain` 日志。
