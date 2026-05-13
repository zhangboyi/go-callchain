import type { ChangedFunction, GoFunction } from './types';

export function findFunctionByIdentity(functions: readonly GoFunction[], functionID: string): GoFunction | undefined {
  return findByIdentity(functions, functionID, (item) => item.id);
}

export function findChangedFunctionByIdentity(
  functions: readonly ChangedFunction[],
  functionID: string,
): ChangedFunction | undefined {
  return findByIdentity(functions, functionID, (item) => item.id);
}

export function functionIdentityKey(functionID: string): string {
  const clean = functionID.replace(/\.\(\*([^)]+)\)\./g, '.($1).');
  const receiver = clean.match(/(?:^|[/.])\(([^)]+)\)\.([^.]+)$/);
  if (receiver) {
    return `${receiver[1]}.${receiver[2]}`;
  }
  const parts = clean.split(/[/.]/).filter(Boolean);
  return parts.slice(-2).join('.');
}

function findByIdentity<T>(items: readonly T[], functionID: string, idOf: (item: T) => string): T | undefined {
  const exact = items.find((item) => idOf(item) === functionID);
  if (exact) {
    return exact;
  }
  const key = functionIdentityKey(functionID);
  return items.find((item) => functionIdentityKey(idOf(item)) === key);
}
