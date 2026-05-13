import * as vscode from 'vscode';
import type { AnalyzeMode } from './types';

export interface ExtensionConfig {
  serviceUrl: string;
  autoStartService: boolean;
  serviceBinary: string;
  serviceCommand: string;
  serviceCwd: string;
  repositoryPath: string;
  defaultBase: string;
  defaultDepth: number;
  mode: AnalyzeMode;
}

export function getConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('goCallchain');
  return {
    serviceUrl: normalizeServiceUrl(config.get<string>('serviceUrl', 'http://127.0.0.1:8787')),
    autoStartService: config.get<boolean>('autoStartService', true),
    serviceBinary: config.get<string>('serviceBinary', '').trim(),
    serviceCommand: config.get<string>('serviceCommand', 'go run ./cmd/server -addr 127.0.0.1:8787').trim(),
    serviceCwd: config.get<string>('serviceCwd', '').trim(),
    repositoryPath: config.get<string>('repositoryPath', '').trim(),
    defaultBase: config.get<string>('defaultBase', 'master').trim() || 'master',
    defaultDepth: clampDepth(config.get<number>('defaultDepth', 8)),
    mode: config.get<AnalyzeMode>('mode', 'fast'),
  };
}

function normalizeServiceUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

function clampDepth(depth: number | undefined): number {
  if (!depth || Number.isNaN(depth)) {
    return 8;
  }
  return Math.max(1, Math.min(20, depth));
}
