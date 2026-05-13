export interface SourceOpenIntent {
  viewColumn: 'beside' | number;
  preview: false;
  preserveFocus: false;
}

export interface VisibleEditorLike {
  viewColumn?: number;
  document?: {
    uri?: {
      scheme?: string;
    };
  };
}

export function sourceOpenIntent(visibleEditors: readonly VisibleEditorLike[] = []): SourceOpenIntent {
  const leftSourceColumn = visibleEditors
    .filter((editor) => editor.document?.uri?.scheme === 'file')
    .map((editor) => editor.viewColumn)
    .filter((column): column is number => typeof column === 'number' && column > 0)
    .sort((a, b) => a - b)[0];
  return {
    viewColumn: leftSourceColumn ?? 'beside',
    preview: false,
    preserveFocus: false,
  };
}
