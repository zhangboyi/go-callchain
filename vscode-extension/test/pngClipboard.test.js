const assert = require('node:assert/strict');
const test = require('node:test');

const { pngDataUrlToBuffer } = require('../dist/pngDataUrl');

test('pngDataUrlToBuffer decodes PNG data URLs', () => {
  const buffer = pngDataUrlToBuffer(`data:image/png;base64,${Buffer.from('png').toString('base64')}`);

  assert.equal(buffer.toString(), 'png');
});

test('pngDataUrlToBuffer rejects non PNG payloads', () => {
  assert.throws(() => pngDataUrlToBuffer('data:text/plain;base64,abc'), /invalid PNG payload/);
});
