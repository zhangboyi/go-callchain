import * as fs from 'fs';
import * as path from 'path';

const ignoredDirectories = new Set([
  '.git',
  '.idea',
  '.vscode',
  'dist',
  'node_modules',
  'vendor',
]);

export function resolveGoWorkspacePath(
  workspaceRoot: string,
  activeFile?: string,
  explicitDirectory?: string,
): string | undefined {
  const root = path.resolve(workspaceRoot);
  if (explicitDirectory?.trim()) {
    return resolveExplicitDirectory(root, explicitDirectory);
  }
  const activeModule = activeFile ? findNearestModule(root, activeFile) : undefined;
  if (activeModule) {
    return activeModule;
  }
  if (hasGoMod(root)) {
    return root;
  }
  return findGoModules(root)[0];
}

export function resolveExplicitDirectory(workspaceRoot: string, explicitDirectory: string): string | undefined {
  const dir = path.isAbsolute(explicitDirectory)
    ? path.resolve(explicitDirectory)
    : path.resolve(workspaceRoot, explicitDirectory);
  if (hasGoMod(dir)) {
    return dir;
  }
  return findGoModules(dir)[0];
}

export function resolveSelectedGoWorkspaceCandidates(selectedDirectory: string): string[] {
  const selected = path.resolve(selectedDirectory);
  if (hasGoMod(selected)) {
    return [selected];
  }
  return findGoModules(selected);
}

export function findGoModules(workspaceRoot: string, maxDepth = 5): string[] {
  const root = path.resolve(workspaceRoot);
  const modules: string[] = [];
  walk(root, 0, maxDepth, modules);
  return modules.sort((a, b) => {
    const depthDiff = relativeDepth(root, a) - relativeDepth(root, b);
    return depthDiff || a.localeCompare(b);
  });
}

function findNearestModule(workspaceRoot: string, activeFile: string): string | undefined {
  let current = fs.statSync(activeFile).isDirectory() ? path.resolve(activeFile) : path.dirname(path.resolve(activeFile));
  const root = path.resolve(workspaceRoot);
  while (isInsideOrEqual(current, root)) {
    if (hasGoMod(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return undefined;
}

function walk(dir: string, depth: number, maxDepth: number, modules: string[]): void {
  if (depth > maxDepth || !isDirectory(dir)) {
    return;
  }
  if (hasGoMod(dir)) {
    modules.push(dir);
    return;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || ignoredDirectories.has(entry.name)) {
      continue;
    }
    walk(path.join(dir, entry.name), depth + 1, maxDepth, modules);
  }
}

function hasGoMod(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'go.mod'));
}

function isDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function isInsideOrEqual(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function relativeDepth(root: string, dir: string): number {
  const relative = path.relative(root, dir);
  return relative ? relative.split(path.sep).length : 0;
}
