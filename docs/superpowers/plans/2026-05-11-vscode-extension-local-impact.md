# VSCode Extension Local Impact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VSCode extension that connects to the local Go callchain service, analyzes the current workspace, runs local `base...head` impact analysis, and shows function callchains with source navigation.

**Architecture:** The extension is a TypeScript thin client. It keeps callchain analysis in `go-callchain-service`, manages service health and optional startup, calls REST APIs, and renders results through VSCode TreeView, QuickPick, CodeLens, and editor navigation.

**Tech Stack:** VSCode Extension API, TypeScript, Node.js child process, local HTTP fetch, existing Go REST service.

---

### Task 1: Extension Scaffold

**Files:**
- Create: `vscode-extension/package.json`
- Create: `vscode-extension/tsconfig.json`
- Create: `vscode-extension/.vscodeignore`
- Create: `vscode-extension/README.md`

- [ ] Create a TypeScript VSCode extension package named `go-callchain-vscode`.
- [ ] Add commands for workspace analysis, local branch impact, function callchain, service restart, and result refresh.
- [ ] Add configuration keys for service URL, auto-start, service command, base branch, depth, and analysis mode.
- [ ] Add build scripts using `tsc`.

### Task 2: API And Git Utilities

**Files:**
- Create: `vscode-extension/src/types.ts`
- Create: `vscode-extension/src/config.ts`
- Create: `vscode-extension/src/serviceClient.ts`
- Create: `vscode-extension/src/git.ts`

- [ ] Mirror the backend response types needed by the extension.
- [ ] Read VSCode configuration with safe defaults.
- [ ] Implement local service health check, analyze polling, MR impact, function list, function callchain, and function detail clients.
- [ ] Implement branch discovery with `git branch --format=%(refname:short)` and current branch detection.

### Task 3: Runtime State And Views

**Files:**
- Create: `vscode-extension/src/state.ts`
- Create: `vscode-extension/src/treeItems.ts`
- Create: `vscode-extension/src/impactTree.ts`
- Create: `vscode-extension/src/functionTree.ts`

- [ ] Store current workspace, task, functions, impact response, selected function callchain, and status.
- [ ] Render MR changed functions and impacted interfaces in one TreeView.
- [ ] Render selected function callchain in a second TreeView.
- [ ] Attach file path, line, function id, edge source, and confidence to tree items where available.

### Task 4: Commands And Editor Integration

**Files:**
- Create: `vscode-extension/src/extension.ts`
- Create: `vscode-extension/src/codeLens.ts`

- [ ] Register all commands.
- [ ] Implement workspace analysis command.
- [ ] Implement local branch impact command with QuickPick for base and head.
- [ ] Implement function search and callchain command.
- [ ] Implement source jump command for functions and impacted interfaces.
- [ ] Add CodeLens for Go functions: `Show Callchain` and `Show Impact`.

### Task 5: Documentation And Verification

**Files:**
- Modify: `README.md`
- Modify: `vscode-extension/README.md`

- [ ] Document extension usage from source.
- [ ] Run `npm install` and `npm run compile` in `vscode-extension`.
- [ ] Run backend Go tests with `go test ./...`.
