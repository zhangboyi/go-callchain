import type { FileTreeNode } from './types';

export interface FileSearchResult {
  node: FileTreeNode;
  score: number;
}

export function searchFileTree(tree: FileTreeNode | null, keyword: string, limit = 40): FileSearchResult[] {
  const query = keyword.trim();
  if (!tree || !query) {
    return [];
  }

  const results: FileSearchResult[] = [];
  walkFiles(tree, (node) => {
    const score = fuzzyScoreFileName(query, node.name);
    if (score !== null) {
      results.push({ node, score });
    }
  });

  return results
    .sort((left, right) => {
      if (left.score !== right.score) {
        return left.score - right.score;
      }
      if (left.node.name.length !== right.node.name.length) {
        return left.node.name.length - right.node.name.length;
      }
      return (left.node.path ?? left.node.name).localeCompare(right.node.path ?? right.node.name);
    })
    .slice(0, limit);
}

export function filterFileTreeByFileName(tree: FileTreeNode | null, keyword: string, limit = 40): FileTreeNode | null {
  const matchedKeys = new Set(searchFileTree(tree, keyword, limit).map((result) => result.node.key));
  if (!tree || matchedKeys.size === 0) {
    return null;
  }
  return cloneMatchedTree(tree, matchedKeys);
}

export function fuzzyScoreFileName(keyword: string, fileName: string): number | null {
  const rawQuery = keyword.trim().toLowerCase();
  if (!rawQuery) {
    return null;
  }

  const lowerFileName = fileName.toLowerCase();
  const directIndex = lowerFileName.indexOf(rawQuery);
  if (directIndex >= 0) {
    return directIndex * 2 + lengthPenalty(lowerFileName, rawQuery);
  }

  const compactQuery = compact(rawQuery);
  const compactFileName = compact(lowerFileName);
  if (!compactQuery || !compactFileName) {
    return null;
  }

  const compactIndex = compactFileName.indexOf(compactQuery);
  if (compactIndex >= 0) {
    return 10 + compactIndex * 3 + lengthPenalty(compactFileName, compactQuery);
  }

  return orderedCharacterScore(compactQuery, compactFileName);
}

function cloneMatchedTree(node: FileTreeNode, matchedKeys: Set<string>): FileTreeNode | null {
  if (node.type === 'file') {
    return matchedKeys.has(node.key) ? { ...node } : null;
  }

  const children = (node.children ?? []).map((child) => cloneMatchedTree(child, matchedKeys)).filter((child): child is FileTreeNode => child !== null);
  if (children.length === 0) {
    return null;
  }
  return { ...node, children };
}

function walkFiles(node: FileTreeNode, visit: (node: FileTreeNode) => void) {
  if (node.type === 'file') {
    visit(node);
    return;
  }

  for (const child of node.children ?? []) {
    walkFiles(child, visit);
  }
}

function compact(value: string): string {
  return value.replace(/[\s._\-/\\]+/g, '');
}

function orderedCharacterScore(query: string, candidate: string): number | null {
  let candidateIndex = 0;
  let startIndex = -1;
  let previousIndex = -1;
  let gapPenalty = 0;

  for (const char of query) {
    const foundIndex = candidate.indexOf(char, candidateIndex);
    if (foundIndex < 0) {
      return null;
    }
    if (startIndex < 0) {
      startIndex = foundIndex;
    }
    if (previousIndex >= 0) {
      gapPenalty += foundIndex - previousIndex - 1;
    }
    previousIndex = foundIndex;
    candidateIndex = foundIndex + 1;
  }

  return 40 + startIndex * 2 + gapPenalty * 4 + lengthPenalty(candidate, query);
}

function lengthPenalty(candidate: string, query: string): number {
  return Math.max(0, candidate.length - query.length) * 0.2;
}
