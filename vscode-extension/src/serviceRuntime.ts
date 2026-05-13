import { ChildProcess, spawn } from 'child_process';
import * as vscode from 'vscode';
import type { ExtensionConfig } from './config';
import { resolveServiceLaunch } from './serviceLauncher';
import type { ServiceClient } from './serviceClient';

export class ServiceRuntime {
  private process?: ChildProcess;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {}

  async ensure(client: ServiceClient, config: ExtensionConfig, workspacePath: string): Promise<void> {
    if (await client.health()) {
      return;
    }
    if (!config.autoStartService) {
      throw new Error(`go-callchain-service is not reachable: ${config.serviceUrl}`);
    }
    this.start(config, workspacePath);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await client.health()) {
        return;
      }
      await delay(500);
    }
    throw new Error(`go-callchain-service did not become healthy: ${config.serviceUrl}`);
  }

  restart(config: ExtensionConfig, workspacePath: string): void {
    this.stop();
    this.start(config, workspacePath);
  }

  stop(): void {
    if (this.process && !this.process.killed) {
      this.process.kill();
    }
    this.process = undefined;
  }

  private start(config: ExtensionConfig, workspacePath: string): void {
    if (this.process && !this.process.killed) {
      return;
    }
    const launch = resolveServiceLaunch({
      extensionPath: this.context.extensionPath,
      workspacePath,
      config,
    });
    this.output.appendLine(`[service] start: ${launch.command} ${launch.args.join(' ')}`.trim());
    this.output.appendLine(`[service] cwd: ${launch.cwd}`);
    this.process = spawn(launch.command, launch.args, {
      cwd: launch.cwd,
      shell: launch.shell,
      env: process.env,
    });
    this.process.stdout?.on('data', (data) => this.output.append(data.toString()));
    this.process.stderr?.on('data', (data) => this.output.append(data.toString()));
    this.process.on('exit', (code, signal) => {
      this.output.appendLine(`[service] exited code=${code ?? ''} signal=${signal ?? ''}`);
      this.process = undefined;
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
