import { execFile } from 'child_process';

export async function listBranches(repoPath: string): Promise<string[]> {
  const output = await git(repoPath, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes']);
  return parseBranchRefs(output);
}

export function parseBranchRefs(output: string): string[] {
  const branches = output
    .split(/\r?\n/)
    .map((line) => parseBranchRef(line.trim()))
    .filter((branch): branch is BranchRef => Boolean(branch));
  const seen = new Set<string>();
  return branches
    .sort(compareBranches)
    .filter((branch) => {
      if (seen.has(branch.name)) {
        return false;
      }
      seen.add(branch.name);
      return true;
    })
    .map((branch) => branch.name);
}

export async function currentBranch(repoPath: string): Promise<string> {
  const output = await git(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  return output.trim();
}

export async function git(repoPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repoPath, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).trim()));
        return;
      }
      resolve(stdout);
    });
  });
}

interface BranchRef {
  name: string;
  kind: 'local' | 'remote';
}

function parseBranchRef(ref: string): BranchRef | undefined {
  if (!ref) {
    return undefined;
  }
  if (ref.startsWith('refs/heads/')) {
    const name = ref.slice('refs/heads/'.length);
    return name ? { name, kind: 'local' } : undefined;
  }
  if (ref.startsWith('refs/remotes/')) {
    const name = ref.slice('refs/remotes/'.length);
    return branchRef(name, 'remote');
  }
  if (ref.startsWith('remotes/')) {
    return branchRef(ref.slice('remotes/'.length), 'remote');
  }
  return branchRef(ref, ref.startsWith('origin/') ? 'remote' : 'local');
}

function branchRef(name: string, kind: BranchRef['kind']): BranchRef | undefined {
  if (!name || name.endsWith('/HEAD')) {
    return undefined;
  }
  return { name, kind };
}

function compareBranches(a: BranchRef, b: BranchRef): number {
  const left = branchSortKey(a);
  const right = branchSortKey(b);
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function branchSortKey(branch: BranchRef): string {
  return `${branch.kind === 'local' ? 0 : 1}:${branch.name}`;
}
