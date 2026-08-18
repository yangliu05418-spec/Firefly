export const inspectMp4Prefix = (buffer: Buffer) => {
  const atoms: string[] = [];
  let offset = 0;
  while (offset + 8 <= buffer.length && atoms.length < 64) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    if (!/^[\x20-\x7e]{4}$/.test(type)) break;
    atoms.push(type);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > buffer.length) break;
      const extended = buffer.readBigUInt64BE(offset + 8);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(extended); headerSize = 16;
    }
    if (size === 0) break;
    if (size < headerSize) break;
    if (offset + size > buffer.length) break;
    offset += size;
  }
  const moov = atoms.indexOf("moov");
  const mdat = atoms.indexOf("mdat");
  return { atoms, progressive: moov >= 0 && (mdat < 0 || moov < mdat) };
};
