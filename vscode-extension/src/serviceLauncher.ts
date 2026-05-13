import * as fs from 'fs';
import * as path from 'path';
import type { ExtensionConfig } from './config';

export interface ServiceLaunchInput {
  extensionPath: string;
  workspacePath: string;
  config: ExtensionConfig;
  platform?: NodeJS.Platform;
  arch?: string;
}

export interface ServiceLaunch {
  command: string;
  args: string[];
  cwd: string;
  shell: boolean;
}

export function resolveServiceLaunch(input: ServiceLaunchInput): ServiceLaunch {
  const platform = input.platform ?? process.platform;
  const arch = normalizeArch(input.arch ?? process.arch);
  const addr = serviceAddress(input.config.serviceUrl);
  const explicitBinary = executableFile(input.config.serviceBinary);
  if (explicitBinary) {
    return binaryLaunch(explicitBinary, addr, input.workspacePath);
  }

  const bundledBinary = executableFile(path.join(input.extensionPath, 'bin', `${platform}-${arch}`, binaryName(platform)));
  if (bundledBinary) {
    return binaryLaunch(bundledBinary, addr, input.workspacePath);
  }

  if (!input.config.serviceCommand) {
    throw new Error('goCallchain.serviceCommand is empty and bundled binary is missing');
  }
  return {
    command: input.config.serviceCommand,
    args: [],
    cwd: resolveServiceCwd(input.extensionPath, input.config, input.workspacePath),
    shell: true,
  };
}

function binaryLaunch(binary: string, addr: string, workspacePath: string): ServiceLaunch {
  ensureExecutable(binary);
  return {
    command: binary,
    args: ['-addr', addr],
    cwd: workspacePath,
    shell: false,
  };
}

function executableFile(filePath: string): string | undefined {
  if (!filePath) {
    return undefined;
  }
  const resolved = path.resolve(filePath);
  return fs.existsSync(resolved) ? resolved : undefined;
}

function ensureExecutable(filePath: string): void {
  try {
    fs.chmodSync(filePath, 0o755);
  } catch {
    // The following spawn call will return the actionable platform error.
  }
}

function serviceAddress(serviceUrl: string): string {
  const url = new URL(serviceUrl);
  return `${url.hostname}:${url.port || defaultPort(url.protocol)}`;
}

function defaultPort(protocol: string): string {
  if (protocol === 'https:') {
    return '443';
  }
  return '80';
}

function binaryName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'go-callchain-service.exe' : 'go-callchain-service';
}

function normalizeArch(arch: string): string {
  if (arch === 'x64') {
    return 'amd64';
  }
  return arch;
}

function resolveServiceCwd(extensionPath: string, config: ExtensionConfig, workspacePath: string): string {
  if (config.serviceCwd) {
    return config.serviceCwd;
  }
  const sourceRepo = path.resolve(extensionPath, '..');
  if (fs.existsSync(path.join(sourceRepo, 'cmd', 'server')) && fs.existsSync(path.join(sourceRepo, 'go.mod'))) {
    return sourceRepo;
  }
  if (fs.existsSync(path.join(workspacePath, 'cmd', 'server')) && fs.existsSync(path.join(workspacePath, 'go.mod'))) {
    return workspacePath;
  }
  return workspacePath;
}
