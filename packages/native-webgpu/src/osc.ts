import type {OscArgument, OscPacket, OscValue, ReceivedOscMessage} from '../td-io.d.ts';
// OSC's wire format is small and independent of Node/Buffer. Bounds are checked
// before allocating or descending so malformed LAN traffic cannot grow state.
const limit = 65507;
const pad = (n: number) => (n + 3) & ~3;
export function utf8Encode(text: string): Uint8Array {
  // Encode Unicode scalar values, replacing unpaired UTF-16 surrogates.
  const bytes: number[] = [];
  for (const char of text) {
    let n = char.codePointAt(0)!;
    if (n >= 0xd800 && n <= 0xdfff) n = 0xfffd;
    if (n < 0x80) bytes.push(n);
    else if (n < 0x800) bytes.push(0xc0 | (n >> 6), 0x80 | (n & 63));
    else if (n < 0x10000) bytes.push(0xe0 | (n >> 12), 0x80 | ((n >> 6) & 63), 0x80 | (n & 63));
    else bytes.push(0xf0 | (n >> 18), 0x80 | ((n >> 12) & 63), 0x80 | ((n >> 6) & 63), 0x80 | (n & 63));
  }
  return new Uint8Array(bytes);
}
export function utf8Decode(bytes: Uint8Array): string {
  // Strict for both file text and OSC strings: invalid UTF-8 rejects explicitly.
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const first = bytes[i++];
    let count = first < 0x80 ? 0 : first >= 0xc2 && first <= 0xdf ? 1 : first >= 0xe0 && first <= 0xef ? 2 : first >= 0xf0 && first <= 0xf4 ? 3 : -1;
    if (count < 0 || i + count > bytes.length) throw Error('Invalid UTF-8');
    let code = first & (count === 0 ? 127 : (1 << (6 - count)) - 1);
    const width = count;
    while (count--) { const b = bytes[i++]; if ((b & 0xc0) !== 0x80) throw Error('Invalid UTF-8'); code = (code << 6) | (b & 63); }
    if ((width && code < [0, 0x80, 0x800, 0x10000][width]) || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) throw Error('Invalid UTF-8');
    out += String.fromCodePoint(code);
  }
  return out;
}
function argument(value: OscValue): OscArgument {
  if (value === null) return {type: 'N'};
  if (typeof value === 'number') return {type: 'f', value};
  if (typeof value === 'string') return {type: 's', value};
  if (typeof value === 'boolean') return {type: value ? 'T' : 'F'};
  if (typeof value === 'bigint') return {type: 'h', value};
  if (value instanceof Uint8Array) return {type: 'b', value};
  return value;
}
export function encodeOsc(packet: OscPacket, depth = 0): Uint8Array {
  if (depth > 16) throw Error('OSC nesting exceeds 16');
  const bytes = new Uint8Array(65508), view = new DataView(bytes.buffer);
  let cursor = 0;
  const reserve = (n: number) => { if (cursor + n > limit) throw Error('OSC packet exceeds UDP payload limit'); const at = cursor; cursor += n; return at; };
  const string = (s: string) => { if (typeof s !== 'string' || s.includes('\0')) throw Error('Invalid OSC string'); const encoded = utf8Encode(s); bytes.set(encoded, reserve(pad(encoded.length + 1))); };
  const int = (n: number) => view.setInt32(reserve(4), n);
  if ('packets' in packet) {
    string('#bundle');
    if (packet.timetag < 0n || packet.timetag > 0xffffffffffffffffn) throw Error('Invalid OSC timetag');
    view.setBigUint64(reserve(8), packet.timetag);
    for (const child of packet.packets) { const b = encodeOsc(child, depth + 1); int(b.length); bytes.set(b, reserve(b.length)); }
  } else {
    if (!packet.address.startsWith('/')) throw Error('OSC address must start with /');
    string(packet.address);
    const args = (packet.args ?? []).map(argument);
    const tags = (values: OscArgument[], level: number): string => {
      if (level > 16) throw Error('OSC array nesting exceeds 16');
      return values.map(a => a.type === 'array' ? '[' + tags(a.value, level + 1) + ']' : a.type).join('');
    };
    string(',' + tags(args, 0));
    const write = (a: OscArgument): void => {
      switch (a.type) {
        case 'array': for (const child of a.value) write(child); break;
        case 'i': if (!Number.isInteger(a.value) || a.value < -2147483648 || a.value > 2147483647) throw Error('Invalid OSC int32'); int(a.value); break;
        case 'f': view.setFloat32(reserve(4), a.value); break;
        case 'd': view.setFloat64(reserve(8), a.value); break;
        case 'c': case 'r': if (!Number.isInteger(a.value) || a.value < 0 || a.value > 0xffffffff) throw Error('Invalid OSC uint32'); view.setUint32(reserve(4), a.value); break;
        case 'h': if (a.value < -0x8000000000000000n || a.value > 0x7fffffffffffffffn) throw Error('Invalid OSC int64'); view.setBigInt64(reserve(8), a.value); break;
        case 't': if (a.value < 0n || a.value > 0xffffffffffffffffn) throw Error('Invalid OSC timetag'); view.setBigUint64(reserve(8), a.value); break;
        case 's': case 'S': string(a.value); break;
        case 'b': if (!(a.value instanceof Uint8Array)) throw Error('Invalid OSC blob'); int(a.value.length); bytes.set(a.value, reserve(pad(a.value.length))); break;
        case 'm': if (!(a.value instanceof Uint8Array) || a.value.length !== 4) throw Error('OSC MIDI requires 4 bytes'); bytes.set(a.value, reserve(4)); break;
        case 'T': case 'F': case 'N': case 'I': break;
        default: throw Error('Unsupported OSC type');
      }
    };
    for (const a of args) write(a);
  }
  return bytes.slice(0, cursor);
}
export function decodeOsc(bytes: Uint8Array): ReceivedOscMessage[] {
  if (bytes.length > limit || !bytes.length || bytes.length % 4) throw Error('Invalid OSC packet length');
  const messages: ReceivedOscMessage[] = [];
  const parse = (data: Uint8Array, timetag: bigint, depth: number) => {
    if (depth > 16 || messages.length >= 4096) throw Error('OSC nesting/message limit exceeded');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let cursor = 0;
    const take = (n: number) => { if (n < 0 || cursor + n > data.length) throw Error('Truncated OSC packet'); const at = cursor; cursor += n; return at; };
    const string = () => { const start = cursor; while (cursor < data.length && data[cursor]) cursor++; if (cursor === data.length) throw Error('Unterminated OSC string'); const end = cursor; cursor = start; const length = pad(end - start + 1); take(length); for (let i = end; i < cursor; i++) if (data[i]) throw Error('Invalid OSC string padding'); return utf8Decode(data.subarray(start, end)); };
    const head = string();
    if (head === '#bundle') {
      const time = view.getBigUint64(take(8));
      while (cursor < data.length) { const size = view.getInt32(take(4)); if (size <= 0 || size % 4) throw Error('Invalid OSC bundle element'); const offset = take(size); parse(data.subarray(offset, offset + size), time, depth + 1); }
      return;
    }
    if (!head.startsWith('/')) throw Error('Invalid OSC address');
    const tags = string(); if (!tags.startsWith(',')) throw Error('Missing OSC type tags');
    let tag = 1;
    const readArgs = (level: number, nested = false): OscArgument[] => {
      if (level > 16) throw Error('OSC array nesting exceeds 16');
      const args: OscArgument[] = [];
      while (tag < tags.length) {
        const type = tags[tag++];
        if (type === ']') { if (!nested) throw Error('Unexpected OSC array close'); return args; }
        switch (type) {
          case '[': args.push({type: 'array', value: readArgs(level + 1, true)}); break;
          case 'i': args.push({type, value: view.getInt32(take(4))}); break;
          case 'f': args.push({type, value: view.getFloat32(take(4))}); break;
          case 'd': args.push({type, value: view.getFloat64(take(8))}); break;
          case 'c': case 'r': args.push({type, value: view.getUint32(take(4))}); break;
          case 'h': args.push({type, value: view.getBigInt64(take(8))}); break;
          case 't': args.push({type, value: view.getBigUint64(take(8))}); break;
          case 's': case 'S': args.push({type, value: string()}); break;
          case 'b': { const size = view.getInt32(take(4)); if (size < 0 || size > limit) throw Error('Invalid OSC blob size'); const at = take(pad(size)); for (let i = at + size; i < cursor; i++) if (data[i]) throw Error('Invalid OSC blob padding'); args.push({type, value: data.slice(at, at + size)}); break; }
          case 'm': { const at = take(4); args.push({type, value: data.slice(at, at + 4)}); break; }
          case 'T': case 'F': case 'N': case 'I': args.push({type}); break;
          default: throw Error(`Unsupported OSC type: ${type}`);
        }
      }
      if (nested) throw Error('Unterminated OSC array');
      return args;
    };
    const args = readArgs(0); if (cursor !== data.length) throw Error('Trailing OSC bytes');
    messages.push({address: head, args, timetag});
  };
  parse(bytes, 1n, 0);
  return messages;
}
