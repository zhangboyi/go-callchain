# Go Callchain VSCode Extension

本插件内置 `go-callchain-service` 后端二进制，在 VSCode 内查看 Go 函数调用链和本地分支 `base...head` 影响面。

打开前后端共用父目录时，插件会自动选择包含 `go.mod` 的后端子目录；如果当前编辑器打开的是 Go 文件，会优先选择该文件最近的 Go module。

也可以通过命令指定分析目录：

```text
Go Callchain: Select Analysis Directory
Go Callchain: Clear Analysis Directory
```

或写入 VSCode Settings：

```json
{
  "goCallchain.repositoryPath": "TCM-BE"
}
```

## 本地开发

```bash
cd vscode-extension
npm install
npm run compile
```

按 `F5` 启动 Extension Development Host。

## 打包

```bash
cd /Users/boyi.zhang/Work/ai/go-callchain-service/vscode-extension
npm ci
npm test
VERSION=$(node -p "require('./package.json').version")
npx @vscode/vsce package --out "go-callchain-vscode-${VERSION}.vsix"
```

安装：

```bash
VERSION=$(node -p "require('/Users/boyi.zhang/Work/ai/go-callchain-service/vscode-extension/package.json').version")
code --install-extension "/Users/boyi.zhang/Work/ai/go-callchain-service/vscode-extension/go-callchain-vscode-${VERSION}.vsix" --force
```

完整部署、打包和配置说明见：

```text
../docs/deployment.md
```

## 使用

```text
分析工作区
选择分析目录
查看接口调用链
分析 MR Impact
查看函数调用链
查看 Graph
重启服务
```

默认连接：

```text
http://127.0.0.1:8787
```

默认启动插件内置后端：

```text
bin/darwin-arm64/go-callchain-service -addr 127.0.0.1:8787
```

通常不需要配置 `goCallchain.serviceCwd`，也不需要手动启动服务。

只有需要覆盖后端二进制时，才配置：

```json
{
  "goCallchain.serviceBinary": "/path/to/go-callchain-service"
}
```

插件在 Activity Bar 中显示为 `Code Analysis`，包含 `Interface Callchain`、`MR Impact`、`Function Callchain` 三个视图。`Interface Callchain` 是主入口：分析完成后选择 `METHOD + PATH`，展示接口到业务逻辑的调用链并支持 Graph 和源码跳转。`MR Impact` 展示 `base...head` 影响面，点击 impacted API 会进入接口调用链视角。`Function Callchain` 保留为高级入口，入口函数通过顶部 `查看调用链` 的可搜索列表选择，不在树里展开全量函数。

Graph 支持拖动卡片、拖动画布、节点子树展开/折叠，以及 `Graph Actions` 菜单内的 Reset layout、Toggle fullscreen、Copy PNG、Export PNG。卡片 hover 会显示完整函数、文件行号和调用边信息；点击会优先复用左侧已有代码窗口打开源码，并跳转到对应行。函数行 CodeLens 只保留 `Show Callchain`。
