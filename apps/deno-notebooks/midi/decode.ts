export const MAGIC = 0x4d494452; // "MIDR"
export const VERSION = 1;

export const KIND_CC = 1;
export const KIND_PB = 2;
export const KIND_CH_PRESS = 3;
export const KIND_POLY_PRESS = 4;
export const KIND_PROG = 5;
export const KIND_NOTE = 6;

export type PacketHeader = {
  flags: number;
  dispatchTsUs: number;
  droppedRaw: number;
  droppedNote: number;
  recordCount: number;
};

export type Record = {
  tsUs: number;
  kind: number;
  channel: number;
  a: number;
  b: number;
  v16: number;
  extra: number;
};

export function decodePacket(bytes: Uint8Array): {
  header: PacketHeader;
  records: Record[];
} {
  if (bytes.length < 32) {
    throw new Error("Packet too small");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error("Bad magic");
  }
  const version = view.getUint16(4, true);
  if (version !== VERSION) {
    throw new Error(`Unsupported version ${version}`);
  }
  const flags = view.getUint16(6, true);
  const dispatchTsUs = Number(view.getBigUint64(8, true));
  const droppedRaw = view.getUint32(16, true);
  const droppedNote = view.getUint32(20, true);
  const recordCount = view.getUint32(24, true);
  const header: PacketHeader = {
    flags,
    dispatchTsUs,
    droppedRaw,
    droppedNote,
    recordCount,
  };

  const available = Math.floor((bytes.length - 32) / 16);
  const count = Math.min(recordCount, available);
  const records: Record[] = new Array(count);
  let offset = 32;
  for (let i = 0; i < count; i++) {
    const tsUs = Number(view.getBigUint64(offset, true));
    const kind = view.getUint8(offset + 8);
    const channel = view.getUint8(offset + 9);
    const a = view.getUint8(offset + 10);
    const b = view.getUint8(offset + 11);
    const v16 = view.getInt16(offset + 12, true);
    const extra = view.getUint16(offset + 14, true);
    records[i] = { tsUs, kind, channel, a, b, v16, extra };
    offset += 16;
  }

  return { header, records };
}
