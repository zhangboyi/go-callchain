const assert = require('node:assert/strict');
const test = require('node:test');

const { sourceOpenIntent } = require('../dist/editorOpenOptions');

test('source jump opens beside when no source editor exists', () => {
  assert.deepEqual(sourceOpenIntent([]), {
    viewColumn: 'beside',
    preview: false,
    preserveFocus: false,
  });
});

test('source jump reuses the leftmost visible source editor group', () => {
  assert.deepEqual(sourceOpenIntent([
    { viewColumn: 3, document: { uri: { scheme: 'file' } } },
    { viewColumn: 1, document: { uri: { scheme: 'file' } } },
    { viewColumn: 2, document: { uri: { scheme: 'output' } } },
  ]), {
    viewColumn: 1,
    preview: false,
    preserveFocus: false,
  });
});
