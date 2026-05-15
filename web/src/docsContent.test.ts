import { describe, expect, it } from 'vitest';
import { docsSections, vscodeExtensionDownloadURL } from './docsContent';

describe('docsContent', () => {
  it('documents web and vscode capabilities with the extension download link', () => {
    expect(vscodeExtensionDownloadURL).toBe('https://git.garena.com/boyi.zhang/go-callchain/-/jobs/63068869/artifacts/file/vscode-extension/go-callchain-vscode-0.1.36.vsix');
    expect(docsSections.map((section) => section.title)).toEqual(['Web 功能', 'VSCode 插件功能']);
    expect(docsSections[0].items.map((item) => item.title)).toContain('接口与函数调用链');
    expect(docsSections[1].items.map((item) => item.title)).toContain('VSCode 侧边栏');
  });
});
