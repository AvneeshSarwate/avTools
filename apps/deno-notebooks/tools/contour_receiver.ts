/**
 * WebSocket receiver for binary contour frames streamed from the Swift Vision app.
 *
 * Wire format (little-endian):
 *   HEADER (12 bytes): magic 0x434F4E54, frameNumber u32, contourCount u16, reserved u16
 *   DESCRIPTORS (N × 20 bytes): pointCount u16, parentIndex i16, pointOffset u32,
 *                                centroidX f32, centroidY f32, area f32
 *   POINT DATA: packed Float32 pairs [x, y, ...]
 */

import type { Point } from "./text_on_path.ts";

export interface ContourNode {
  points: Point[];
  parentIndex: number;
  children: number[];
  centroid: Point;
  area: number;
}

export interface ContourFrame {
  frameNumber: number;
  contours: ContourNode[];
}

export interface ContourReceiver {
  readonly latestFrame: ContourFrame | null;
  close(): void;
}

const MAGIC = 0x434f4e54; // "CONT"
const HEADER_SIZE = 12;
const DESC_SIZE = 20;

function parseContourFrame(buf: ArrayBuffer): ContourFrame | null {
  if (buf.byteLength < HEADER_SIZE) return null;
  const dv = new DataView(buf);

  if (dv.getUint32(0, true) !== MAGIC) return null;
  const frameNumber = dv.getUint32(4, true);
  const contourCount = dv.getUint16(8, true);

  const pointDataStart = HEADER_SIZE + contourCount * DESC_SIZE;
  if (buf.byteLength < pointDataStart) return null;

  const contours: ContourNode[] = [];

  for (let i = 0; i < contourCount; i++) {
    const off = HEADER_SIZE + i * DESC_SIZE;
    const pointCount = dv.getUint16(off, true);
    const parentIndex = dv.getInt16(off + 2, true);
    const pointOffset = dv.getUint32(off + 4, true);
    const centroidX = dv.getFloat32(off + 8, true);
    const centroidY = dv.getFloat32(off + 12, true);
    const area = dv.getFloat32(off + 16, true);

    const base = pointDataStart + pointOffset;
    const points: Point[] = new Array(pointCount);
    for (let j = 0; j < pointCount; j++) {
      points[j] = {
        x: dv.getFloat32(base + j * 8, true),
        y: dv.getFloat32(base + j * 8 + 4, true),
      };
    }
    contours.push({
      points,
      parentIndex,
      children: [],
      centroid: { x: centroidX, y: centroidY },
      area,
    });
  }

  // Build children lists
  for (let i = 0; i < contours.length; i++) {
    const pi = contours[i].parentIndex;
    if (pi >= 0 && pi < contours.length) {
      contours[pi].children.push(i);
    }
  }

  return { frameNumber, contours };
}

export function createContourReceiver(
  url = "ws://127.0.0.1:9100",
): ContourReceiver {
  let _latestFrame: ContourFrame | null = null;
  let ws: WebSocket | null = null;
  let closed = false;

  function connect() {
    if (closed) return;
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    ws.onmessage = (ev: MessageEvent) => {
      if (ev.data instanceof ArrayBuffer) {
        const frame = parseContourFrame(ev.data);
        if (frame) _latestFrame = frame;
      }
    };

    ws.onopen = () => {
      console.log(`[ContourReceiver] connected to ${url}`);
    };

    ws.onclose = () => {
      if (!closed) {
        console.log("[ContourReceiver] disconnected, reconnecting in 1s...");
        setTimeout(connect, 1000);
      }
    };

    ws.onerror = () => {};
  }

  connect();

  return {
    get latestFrame() {
      return _latestFrame;
    },
    close() {
      closed = true;
      ws?.close();
    },
  };
}
