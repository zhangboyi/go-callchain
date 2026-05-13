import type { ChangedFunction } from './types';

export function changedFunctionIDSet(functions: readonly ChangedFunction[] | undefined): Set<string> {
  return new Set((functions ?? []).map((fn) => fn.id).filter(Boolean));
}
