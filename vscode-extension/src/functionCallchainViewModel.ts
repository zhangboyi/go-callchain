import type { FunctionCallchainResponse, GoFunction } from './types';

export type FunctionCallchainRootKind = 'empty' | 'callchain';

export function functionCallchainRootKinds(
  _functions: readonly GoFunction[],
  callchain?: FunctionCallchainResponse,
): FunctionCallchainRootKind[] {
  return callchain ? ['callchain'] : ['empty'];
}
