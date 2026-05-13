import { describe, expect, it } from 'vitest';
import { sourceFromSelection } from './repositorySource';
import type { ManagedRepository } from './types';

describe('sourceFromSelection', () => {
  const repo: ManagedRepository = {
    id: 'repo-1',
    name: 'TCM BE',
    url: 'git@example.com:org/tcm-be.git',
    default_ref: 'main',
  };

  it('uses managed repository url and selected ref', () => {
    expect(sourceFromSelection('managed', '/tmp/local', '', '', repo, 'feature/foo')).toEqual({
      type: 'git',
      url: repo.url,
      ref: 'feature/foo',
    });
  });

  it('falls back to managed repository default ref', () => {
    expect(sourceFromSelection('managed', '/tmp/local', '', '', repo, '')).toEqual({
      type: 'git',
      url: repo.url,
      ref: repo.default_ref,
    });
  });
});
