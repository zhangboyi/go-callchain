import { impactFunctionCandidates, impactInterfaceCallchain } from './impactCallchain';
import type { CallTreeNode, FunctionCallchainResponse, ImpactedInterface, Route } from './types';

export function extractFunctionID(arg: unknown): string | undefined {
  return extractFunctionIDs(arg)[0];
}

export function extractFunctionIDs(arg: unknown): string[] {
  return Array.from(new Set(extractFunctionIDsFrom(arg, new Set())));
}

function extractFunctionIDsFrom(arg: unknown, seen: Set<object>): string[] {
  if (typeof arg === 'string') {
    return extractFunctionIDFromResourceUri(arg) ?? (arg ? [arg] : []);
  }
  const values: string[] = [];
  if (arg && typeof arg === 'object') {
    if (seen.has(arg)) {
      return values;
    }
    seen.add(arg);
  }
  const impact = extractImpactedInterface(arg);
  if (impact) {
    values.push(...impactFunctionCandidates(impact));
  }
  const route = extractRoute(arg);
  if (route) {
    values.push(route.handler);
  }
  if (arg && typeof arg === 'object' && 'functionID' in arg) {
    const value = (arg as { functionID?: unknown }).functionID;
    if (typeof value === 'string' && value) {
      values.push(value);
    }
  }
  if (arg && typeof arg === 'object' && 'functionCandidates' in arg) {
    const candidates = (arg as { functionCandidates?: unknown }).functionCandidates;
    if (Array.isArray(candidates)) {
      for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate) {
          values.push(candidate);
        }
      }
    }
  }
  const resourceFunctionIDs = extractFunctionIDFromResourcePayload(arg);
  if (resourceFunctionIDs) {
    values.push(...resourceFunctionIDs);
  }
  const node = extractCallTreeNode(arg);
  if (node) {
    values.push(node.function);
  }
  for (const nestedArg of extractNestedArguments(arg)) {
    values.push(...extractFunctionIDsFrom(nestedArg, seen));
  }
  for (const commandArg of extractCommandArguments(arg)) {
    values.push(...extractFunctionIDsFrom(commandArg, seen));
  }
  return values;
}

export function extractFunctionCallchain(arg: unknown): FunctionCallchainResponse | undefined {
  return extractFunctionCallchainFrom(arg, new Set());
}

function extractFunctionCallchainFrom(arg: unknown, seen: Set<object>): FunctionCallchainResponse | undefined {
  const impact = extractImpactedInterface(arg);
  if (impact) {
    return impactInterfaceCallchain(impact);
  }
  if (arg && typeof arg === 'object') {
    if (seen.has(arg)) {
      return undefined;
    }
    seen.add(arg);
  }
  if (arg && typeof arg === 'object' && 'callchain' in arg) {
    const value = (arg as { callchain?: unknown }).callchain;
    if (isFunctionCallchainResponse(value)) {
      return value;
    }
  }
  const node = extractCallTreeNode(arg);
  if (node) {
    return { function: node.function, tree: node };
  }
  for (const nestedArg of extractNestedArguments(arg)) {
    const callchain = extractFunctionCallchainFrom(nestedArg, seen);
    if (callchain) {
      return callchain;
    }
  }
  for (const commandArg of extractCommandArguments(arg)) {
    const callchain = extractFunctionCallchainFrom(commandArg, seen);
    if (callchain) {
      return callchain;
    }
  }
  return undefined;
}

function extractCallTreeNode(arg: unknown): CallTreeNode | undefined {
  if (!arg || typeof arg !== 'object' || !('node' in arg)) {
    return undefined;
  }
  const node = (arg as { node?: unknown }).node;
  return isCallTreeNode(node) ? node : undefined;
}

function extractImpactedInterface(arg: unknown): ImpactedInterface | undefined {
  if (isImpactedInterface(arg)) {
    return arg;
  }
  if (arg && typeof arg === 'object' && 'item' in arg) {
    const item = (arg as { item?: unknown }).item;
    return isImpactedInterface(item) ? item : undefined;
  }
  return undefined;
}

function extractRoute(arg: unknown): Route | undefined {
  if (isRoute(arg)) {
    return arg;
  }
  if (arg && typeof arg === 'object' && 'route' in arg) {
    const route = (arg as { route?: unknown }).route;
    return isRoute(route) ? route : undefined;
  }
  return undefined;
}

function extractCommandArguments(arg: unknown): unknown[] {
  if (!arg || typeof arg !== 'object' || !('command' in arg)) {
    return [];
  }
  const command = (arg as { command?: unknown }).command;
  if (!command || typeof command !== 'object' || !('arguments' in command)) {
    return [];
  }
  const args = (command as { arguments?: unknown }).arguments;
  return Array.isArray(args) ? args : [];
}

function extractNestedArguments(arg: unknown): unknown[] {
  if (!arg || typeof arg !== 'object') {
    return [];
  }
  const value = arg as {
    treeItem?: unknown;
    item?: unknown;
    element?: unknown;
    payload?: unknown;
    target?: unknown;
  };
  return [value.treeItem, value.item, value.element, value.payload, value.target].filter((item) => item !== undefined);
}

function extractFunctionIDFromResourcePayload(arg: unknown): string[] | undefined {
  const fromUri = extractFunctionIDFromResourceUri(arg);
  if (fromUri) {
    return fromUri;
  }
  if (!arg || typeof arg !== 'object' || !('resourceUri' in arg)) {
    return undefined;
  }
  return extractFunctionIDFromResourceUri((arg as { resourceUri?: unknown }).resourceUri);
}

function extractFunctionIDFromResourceUri(value: unknown): string[] | undefined {
  if (typeof value === 'string') {
    return extractFunctionIDFromResourceUriString(value);
  }
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const uri = value as { scheme?: unknown; authority?: unknown; path?: unknown; query?: unknown };
  if (uri.scheme !== 'go-callchain-function') {
    return undefined;
  }
  const encoded = firstString(uri.query, uri.authority, trimLeadingSlash(uri.path));
  return encoded ? [decodeURIComponent(encoded)] : undefined;
}

function extractFunctionIDFromResourceUriString(value: string): string[] | undefined {
  const match = value.match(/go-callchain-function:(?:\/\/|\/)?([^|\s]+)/);
  if (!match?.[1]) {
    return undefined;
  }
  const decoded = safeDecodeURIComponent(match[1]);
  return decoded ? [decoded] : undefined;
}

function safeDecodeURIComponent(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value) {
      return value;
    }
  }
  return undefined;
}

function trimLeadingSlash(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return value.replace(/^\/+/, '');
}

function isRoute(value: unknown): value is Route {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const route = value as { method?: unknown; path?: unknown; handler?: unknown; file?: unknown; line?: unknown };
  return typeof route.method === 'string'
    && typeof route.path === 'string'
    && typeof route.handler === 'string'
    && typeof route.file === 'string'
    && typeof route.line === 'number';
}

function isImpactedInterface(value: unknown): value is ImpactedInterface {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as { method?: unknown; path?: unknown; handler?: unknown; changed_function?: unknown; chain?: unknown; risk?: unknown };
  return typeof item.method === 'string'
    && typeof item.path === 'string'
    && typeof item.handler === 'string'
    && typeof item.changed_function === 'string'
    && Array.isArray(item.chain)
    && item.chain.every((candidate) => typeof candidate === 'string')
    && typeof item.risk === 'string';
}

function isFunctionCallchainResponse(value: unknown): value is FunctionCallchainResponse {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { function?: unknown; tree?: unknown };
  return typeof candidate.function === 'string' && isCallTreeNode(candidate.tree);
}

function isCallTreeNode(value: unknown): value is CallTreeNode {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const node = value as { function?: unknown; children?: unknown };
  if (typeof node.function !== 'string') {
    return false;
  }
  return node.children === undefined || (Array.isArray(node.children) && node.children.every(isCallTreeNode));
}
