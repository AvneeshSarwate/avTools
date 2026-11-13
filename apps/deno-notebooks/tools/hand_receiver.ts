/// <reference lib="dom" />

/**
 * WebSocket receiver for JSON hand-bounding-box frames streamed from the
 * Swift Vision app on the same ws://127.0.0.1:9100 that carries contours.
 *
 * Wire shape (UTF-8 text frames):
 *   {
 *     "type": "hand",
 *     "frameNumber": 123,
 *     "hands": [
 *       {"chirality": "left"|"right"|"unknown",
 *        "validJointCount": 21,
 *        "bbox": [minX, minY, maxX, maxY]}  // normalized [0,1], top-left origin
 *     ]
 *   }
 *
 * Safe to run on the same URL as the contour receiver — each ignores the
 * messages it doesn't recognize (contour = ArrayBuffer, hand = string).
 */

export interface HandBBox {
  chirality: "left" | "right" | "unknown";
  validJointCount: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface HandFrame {
  frameNumber: number;
  hands: HandBBox[];
}

export interface HandReceiver {
  readonly latestFrame: HandFrame | null;
  close(): void;
}

function parseHandFrame(text: string): HandFrame | null {
  let msg: unknown;
  try {
    msg = JSON.parse(text);
  } catch {
    return null;
  }
  if (!msg || typeof msg !== "object") return null;
  const obj = msg as Record<string, unknown>;
  if (obj.type !== "hand") return null;

  const frameNumber = typeof obj.frameNumber === "number" ? obj.frameNumber : 0;
  const rawHands = Array.isArray(obj.hands) ? obj.hands : [];
  const hands: HandBBox[] = [];

  for (const h of rawHands) {
    if (!h || typeof h !== "object") continue;
    const rec = h as Record<string, unknown>;
    const bbox = rec.bbox;
    if (!Array.isArray(bbox) || bbox.length !== 4) continue;
    const [minX, minY, maxX, maxY] = bbox.map((n) =>
      typeof n === "number" ? n : NaN
    );
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) continue;

    const chirality = rec.chirality === "left" || rec.chirality === "right"
      ? rec.chirality
      : "unknown";
    const validJointCount = typeof rec.validJointCount === "number"
      ? rec.validJointCount
      : 0;

    hands.push({ chirality, validJointCount, minX, minY, maxX, maxY });
  }

  return { frameNumber, hands };
}

export function createHandReceiver(
  url = "ws://127.0.0.1:9100",
): HandReceiver {
  let _latestFrame: HandFrame | null = null;
  let ws: WebSocket | null = null;
  let closed = false;

  function connect() {
    if (closed) return;
    ws = new WebSocket(url);

    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data !== "string") return;
      const frame = parseHandFrame(ev.data);
      if (frame) _latestFrame = frame;
    };

    ws.onopen = () => {
      console.log(`[HandReceiver] connected to ${url}`);
    };

    ws.onclose = () => {
      if (!closed) {
        // console.log("[HandReceiver] disconnected, reconnecting in 1s...");
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
