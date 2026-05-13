import type { CallTreeNode, FunctionCallchainResponse, ImpactedInterface } from './types';

export function impactInterfaceCallchain(item: ImpactedInterface): FunctionCallchainResponse {
  const chain = normalizeImpactChain(item);
  return {
    function: chain[0] || item.handler,
    tree: chainToTree(chain, item.handler || 'empty'),
  };
}

export function impactFunctionCandidates(item: ImpactedInterface): string[] {
  return Array.from(new Set([...normalizeImpactChain(item), item.handler].filter(Boolean)));
}

export function impactPrimaryFunctionID(item: ImpactedInterface): string {
  return impactFunctionCandidates(item)[0] || item.handler;
}

export function chainToTree(chain: string[], fallbackRoot = 'empty'): CallTreeNode {
  const [root, ...rest] = chain.length > 0 ? chain : [fallbackRoot];
  const tree: CallTreeNode = { function: root, children: [] };
  let cursor = tree;
  for (const functionID of rest) {
    const child: CallTreeNode = { function: functionID, children: [] };
    cursor.children = [child];
    cursor = child;
  }
  return tree;
}

function normalizeImpactChain(item: ImpactedInterface): string[] {
  if (item.chain.length === 0) {
    return [item.handler].filter(Boolean);
  }
  return item.chain;
}
