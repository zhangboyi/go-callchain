import { describe, expect, it } from 'vitest';
import { filterFileTreeByFileName, fuzzyScoreFileName, searchFileTree } from './codeSearch';
import type { FileTreeNode } from './types';

const tree: FileTreeNode = {
  key: 'directory:',
  type: 'directory',
  name: 'repo',
  children: [
    {
      key: 'directory:app/tcm/view',
      type: 'directory',
      name: 'view',
      children: [
        {
          key: 'file:app/tcm/view/testcase_plan_view.go',
          type: 'file',
          name: 'testcase_plan_view.go',
          path: 'app/tcm/view/testcase_plan_view.go',
          children: [
            {
              key: 'fn:git.example.com/org/repo/app/tcm/view.BuildTestcasePlan',
              type: 'function',
              name: 'BuildTestcasePlan',
              path: 'app/tcm/view/testcase_plan_view.go',
              function_id: 'git.example.com/org/repo/app/tcm/view.BuildTestcasePlan',
              start_line: 12,
              end_line: 28,
            },
          ],
        },
      ],
    },
    {
      key: 'directory:app/tcm/controller',
      type: 'directory',
      name: 'controller',
      children: [
        {
          key: 'file:app/tcm/controller/testcase_plan_controller.go',
          type: 'file',
          name: 'testcase_plan_controller.go',
          path: 'app/tcm/controller/testcase_plan_controller.go',
        },
      ],
    },
    {
      key: 'file:README.md',
      type: 'file',
      name: 'README.md',
      path: 'README.md',
    },
  ],
};

describe('codeSearch', () => {
  it('matches file names by compact fuzzy keyword', () => {
    expect(fuzzyScoreFileName('tcpv', 'testcase_plan_view.go')).not.toBeNull();
    expect(fuzzyScoreFileName('missing', 'testcase_plan_view.go')).toBeNull();
  });

  it('returns matched files sorted by filename score', () => {
    const results = searchFileTree(tree, 'test plan view');

    expect(results.map((result) => result.node.path)).toEqual(['app/tcm/view/testcase_plan_view.go']);
  });

  it('keeps ancestor directories for searched files', () => {
    const result = filterFileTreeByFileName(tree, 'test plan view');

    expect(result).toMatchObject({
      key: 'directory:',
      children: [
        {
          key: 'directory:app/tcm/view',
          children: [
            {
              key: 'file:app/tcm/view/testcase_plan_view.go',
              children: [
                {
                  key: 'fn:git.example.com/org/repo/app/tcm/view.BuildTestcasePlan',
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it('does not match directory names', () => {
    const results = searchFileTree(tree, 'tcm');

    expect(results).toEqual([]);
    expect(filterFileTreeByFileName(tree, 'tcm')).toBeNull();
  });
});
