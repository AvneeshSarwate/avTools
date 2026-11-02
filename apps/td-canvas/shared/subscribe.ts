import type {IOHost, WebSocketConnection} from '../../../packages/native-webgpu/td-io.d.ts';
import {applyPreview, normalizeDrawingDocument, type DrawingDocument, type DrawingMessage} from './protocol.ts';

/** Shared by TOP and CHOP examples. Keeps the last drawing while disconnected.
 * Reconnect uses the server's latest snapshot; no history replay is required. */
export function subscribeDrawing(
  host: Pick<IOHost, 'webSocket'> & {onDispose(callback: () => void): void},
  url: string,
  onDocument: (document: DrawingDocument, revision: number) => void,
  onStatus: (status: string) => void = () => {},
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let socket: WebSocketConnection | undefined;
  let document: DrawingDocument | undefined;
  let revision = -1;
  let retry = 250;

  function connect() {
    if (stopped) return;
    onStatus('connecting');
    try {
      socket = host.webSocket.connect(url);
    } catch (error) {
      onStatus(String(error));
      schedule();
      return;
    }
    const current = socket;
    const send = (value: unknown) => current.send(JSON.stringify(value)).catch(error => {
      onStatus(String(error)); current.close();
    });
    current.onOpen(() => { retry = 250; revision = -1; onStatus('connected'); });
    current.onMessage(data => {
      if (typeof data !== 'string') return;
      try {
        const message = JSON.parse(data) as DrawingMessage;
        if (message.type === 'snapshot') {
          document = normalizeDrawingDocument(message.document);
        } else if (message.type === 'preview') {
          if (!document || message.base !== revision) { void send({type: 'resync'}); return; }
          document = applyPreview(document, message.preview);
        } else return;
        if (!Number.isSafeInteger(message.revision) || message.revision < 0) throw Error('Invalid revision');
        revision = message.revision;
        onDocument(document, revision);
        void send({type: 'ack', revision});
      } catch (error) {
        onStatus(String(error));
        current.close(4002, 'Invalid drawing message');
      }
    });
    current.onError(error => onStatus(error.message));
    current.onClose(() => { onStatus('disconnected'); schedule(); });
  }

  function schedule() {
    if (stopped || timer !== undefined) return;
    timer = setTimeout(() => { timer = undefined; connect(); }, retry);
    retry = Math.min(retry * 2, 5000);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
    socket?.close();
  }
  host.onDispose(stop);
  connect();
  return stop;
}
