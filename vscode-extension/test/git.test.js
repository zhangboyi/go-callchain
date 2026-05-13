const assert = require('node:assert/strict');
const test = require('node:test');

const { parseBranchRefs } = require('../dist/git');

test('git branch refs include local and remote branches without origin head alias', () => {
  const branches = parseBranchRefs(`
refs/heads/master
refs/heads/feature/local
refs/remotes/origin/HEAD
refs/remotes/origin/master
refs/remotes/origin/feature/remote
refs/remotes/origin/master
`);

  assert.deepEqual(branches, [
    'feature/local',
    'master',
    'origin/feature/remote',
    'origin/master',
  ]);
});
