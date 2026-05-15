import { describe, expect, it } from 'vitest';
import { createImpactRecordID, parseURLState, serializeURLState } from './urlState';

describe('url state', () => {
  it('serializes and parses analyzed task state', () => {
    const query = serializeURLState({
      tab: 'callchain',
      sourceType: 'managed',
      mode: 'accurate',
      repositoryID: 'repo-1',
      managedRef: 'feature/demo',
      taskID: 'task-123',
    });

    expect(query).toBe('tab=callchain&source=managed&mode=accurate&repo_id=repo-1&repo_ref=feature%2Fdemo&task_id=task-123');
    expect(parseURLState(`?${query}`)).toEqual({
      tab: 'callchain',
      sourceType: 'managed',
      mode: 'accurate',
      repositoryID: 'repo-1',
      managedRef: 'feature/demo',
      taskID: 'task-123',
    });
  });

  it('serializes impact state with a record id', () => {
    const state = {
      tab: 'impact' as const,
      sourceType: 'git' as const,
      mode: 'fast' as const,
      gitURL: 'https://example.com/repo.git',
      gitRef: 'feature/demo',
      impactBase: 'master',
      impactHead: 'feature/demo',
    };
    const impactRecordID = createImpactRecordID(state);
    const query = serializeURLState({ ...state, impactRecordID });

    expect(parseURLState(query)).toEqual({ ...state, impactRecordID });
    expect(createImpactRecordID(state)).toBe(impactRecordID);
    expect(createImpactRecordID({ ...state, impactHead: 'feature/next' })).not.toBe(impactRecordID);
  });
});
