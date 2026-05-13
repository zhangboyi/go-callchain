export function pngDataUrlToBuffer(dataUrl: string): Buffer {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error('invalid PNG payload');
  }
  return Buffer.from(match[1], 'base64');
}
