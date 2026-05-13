import { execFile } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { pngDataUrlToBuffer } from './pngDataUrl';

export async function copyPngToClipboard(dataUrl: string): Promise<void> {
  const buffer = pngDataUrlToBuffer(dataUrl);
  if (process.platform !== 'darwin') {
    throw new Error('copy PNG is currently supported on macOS only');
  }
  const file = vscode.Uri.file(path.join(os.tmpdir(), `go-callchain-graph-${Date.now()}.png`));
  await vscode.workspace.fs.writeFile(file, buffer);
  await runOsascript([
    '-e',
    `set the clipboard to (read (POSIX file "${escapeAppleScript(file.fsPath)}") as «class PNGf»)`,
  ]);
}

function runOsascript(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('osascript', args, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).trim()));
        return;
      }
      resolve();
    });
  });
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
