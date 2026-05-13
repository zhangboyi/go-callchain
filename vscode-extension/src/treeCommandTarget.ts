import { extractFunctionCallchain, extractFunctionIDs } from './commandArgs';

export class TreeCommandTarget {
  private lastSelected: unknown;
  private lastOpened: unknown;

  rememberSelection(selection: readonly unknown[]): void {
    if (selection.length > 0) {
      this.lastSelected = selection[0];
    }
  }

  rememberOpenedTarget(target: unknown): void {
    if (isResolvableTreeTarget(target)) {
      this.lastOpened = target;
    }
  }

  resolve(args: readonly unknown[]): unknown {
    const explicitTarget = args.find((arg) => arg !== undefined && isResolvableTreeTarget(arg));
    if (explicitTarget !== undefined) {
      return explicitTarget;
    }
    const fallback = this.lastSelected !== undefined && isResolvableTreeTarget(this.lastSelected)
      ? this.lastSelected
      : undefined;
    const opened = this.lastOpened !== undefined && isResolvableTreeTarget(this.lastOpened)
      ? this.lastOpened
      : undefined;
    return fallback ?? opened ?? args.find((arg) => arg !== undefined) ?? this.lastSelected;
  }
}

function isResolvableTreeTarget(arg: unknown): boolean {
  if (typeof arg === 'string') {
    if (arg.includes('go-callchain-function:')) {
      return extractFunctionIDs(arg).length > 0;
    }
    return isLikelyFunctionID(arg);
  }
  return extractFunctionIDs(arg).length > 0 || Boolean(extractFunctionCallchain(arg));
}

function isLikelyFunctionID(value: string): boolean {
  if (value.startsWith('go-callchain-function:')) {
    return true;
  }
  if (value.startsWith('goCallchain.') || value.startsWith('workbench.') || value.startsWith('vscode.')) {
    return false;
  }
  return !/\s/.test(value) && /[/.]/.test(value);
}
