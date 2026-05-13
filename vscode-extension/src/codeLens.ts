import * as vscode from 'vscode';
import { goFunctionCodeLensActions } from './codeLensActions';

export class GoFunctionCodeLensProvider implements vscode.CodeLensProvider {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changeEmitter.event;

  refresh(): void {
    this.changeEmitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.languageId !== 'go') {
      return [];
    }
    const lenses: vscode.CodeLens[] = [];
    for (let line = 0; line < document.lineCount; line += 1) {
      const text = document.lineAt(line).text;
      if (!/^func\s+(?:\([^)]+\)\s*)?[A-Za-z_]\w*\s*\(/.test(text)) {
        continue;
      }
      const range = new vscode.Range(line, 0, line, 0);
      for (const action of goFunctionCodeLensActions()) {
        lenses.push(new vscode.CodeLens(range, {
          title: action.title,
          command: action.command,
          arguments: [document.uri.fsPath, line + 1],
        }));
      }
    }
    return lenses;
  }
}
