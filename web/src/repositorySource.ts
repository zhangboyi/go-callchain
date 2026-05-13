import type { ManagedRepository, RepoSource, SourceType } from './types';

export function sourceFromSelection(
  sourceType: SourceType,
  localPath: string,
  gitURL: string,
  gitRef: string,
  managedRepository: ManagedRepository | null | undefined,
  managedRef: string,
): RepoSource {
  if (sourceType === 'local') {
    return { type: 'local', path: localPath.trim() };
  }
  if (sourceType === 'managed') {
    return {
      type: 'git',
      url: managedRepository?.url ?? '',
      ref: managedRef.trim() || managedRepository?.default_ref || '',
    };
  }
  return { type: 'git', url: gitURL.trim(), ref: gitRef.trim() };
}
