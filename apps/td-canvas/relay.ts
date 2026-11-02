import {WebSocket, WebSocketServer} from 'ws';
import type {Server} from 'node:http';
import {mkdir, readFile, writeFile, rename} from 'node:fs/promises';
import {join} from 'node:path';
import {applyPreview, createEmptyDrawingDocument, normalizeDrawingDocument, type DrawingDocument, type DrawingMessage} from './shared/protocol.ts';

interface Peer {socket: WebSocket; inFlight: number | null; sentAt: number;}
interface Room {
  document: DrawingDocument; committed: DrawingDocument; revision: number;
  peers: Set<Peer>; editor?: WebSocket; persist?: ReturnType<typeof setTimeout>;
  saving: Promise<void>;
}
export async function attachRelay(server: Server, directory: string, port: number) {
  await mkdir(directory, {recursive: true});
  const rooms = new Map<string, Promise<Room>>();
  const wss = new WebSocketServer({noServer: true, maxPayload: 8 * 1024 * 1024, perMessageDeflate: false});
  async function roomFor(name: string) {
    if (!rooms.has(name)) rooms.set(name, (async () => {
      let document = createEmptyDrawingDocument();
      try { document = normalizeDrawingDocument(JSON.parse(await readFile(join(directory, name + '.json'), 'utf8'))); }
      catch (error: any) { if (error.code !== 'ENOENT') console.warn('Cannot restore drawing:', name, error.message); }
      return {document, committed: document, revision: 0, peers: new Set<Peer>(), saving: Promise.resolve()} as Room;
    })());
    return rooms.get(name)!;
  }
  function persist(room: Room, name: string) {
    if (room.persist) clearTimeout(room.persist);
    room.persist = setTimeout(() => {
      room.persist = undefined;
      const json = JSON.stringify(room.committed);
      room.saving = room.saving.then(async () => {
        const path = join(directory, name + '.json');
        await writeFile(path + '.tmp', json);
        await rename(path + '.tmp', path);
      }).catch(error => console.error('Saving drawing failed:', error));
    }, 150);
  }
  function snapshot(room: Room): DrawingMessage {
    return {type: 'snapshot', revision: room.revision, document: room.document};
  }
  function send(peer: Peer, message: DrawingMessage) {
    if (peer.socket.readyState !== WebSocket.OPEN || peer.inFlight !== null) return;
    const payload = JSON.stringify(message);
    if (Buffer.byteLength(payload) > 8 * 1024 * 1024) { peer.socket.close(1009, 'Drawing exceeds 8 MiB'); return; }
    peer.inFlight = message.revision;
    peer.sentAt = Date.now();
    peer.socket.send(payload);
  }
  function publish(room: Room, message: DrawingMessage) {
    for (const peer of room.peers) send(peer, message);
  }
  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/canvas') return; // Vite handles its own HMR upgrade.
    const origin = request.headers.origin;
    if (origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(origin)) { socket.destroy(); return; }
    const name = url.searchParams.get('drawing') ?? 'main';
    const role = url.searchParams.get('role') ?? 'subscriber';
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name) || !['editor', 'subscriber'].includes(role)) { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, ws => {
      // Buffer no messages before the asynchronous disk restore finishes.
      ws.on('error', () => {});
      ws.pause();
      void roomFor(name).then(room => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const peer: Peer = {socket: ws, inFlight: null, sentAt: 0};
        if (role === 'editor') {
          if (room.editor?.readyState === WebSocket.OPEN) { ws.resume(); ws.close(4009, 'This drawing already has an editor'); return; }
          room.editor = ws;
          ws.send(JSON.stringify({type: 'snapshot', revision: room.revision, document: room.committed}));
        } else {
          room.peers.add(peer);
          send(peer, snapshot(room));
        }
        ws.on('message', (raw, binary) => {
          try {
            if (binary) throw Error('Expected JSON text');
            const message = JSON.parse(raw.toString());
            if (role === 'subscriber') {
              if (message.type === 'ack' && message.revision === peer.inFlight) {
                peer.inFlight = null;
                if (message.revision !== room.revision) send(peer, snapshot(room));
              } else if (message.type === 'resync') { peer.inFlight = null; send(peer, snapshot(room)); }
              return;
            }
            const base = room.revision;
            if (message.type === 'commit') {
              const document = normalizeDrawingDocument(message.document);
              if (Buffer.byteLength(JSON.stringify(document)) > 8 * 1024 * 1024 - 256) throw Error('Drawing exceeds 8 MiB');
              room.document = room.committed = document;
              ++room.revision;
              persist(room, name);
              publish(room, snapshot(room));
            } else if (message.type === 'preview') {
              const document = applyPreview(room.document, message.preview);
              if (Buffer.byteLength(JSON.stringify(document)) > 8 * 1024 * 1024 - 256) throw Error('Drawing exceeds 8 MiB');
              room.document = document;
              ++room.revision;
              publish(room, {type: 'preview', base, revision: room.revision, preview: message.preview});
            } else throw Error('Unknown editor message');
            ws.send(JSON.stringify({type: 'accepted', revision: room.revision}));
          } catch (error) { ws.send(JSON.stringify({type: 'error', message: String(error)})); }
        });
        ws.on('close', () => {
          room.peers.delete(peer);
          if (room.editor === ws) {
            room.editor = undefined;
            room.document = room.committed; // Discard an unfinished gesture.
            ++room.revision;
            publish(room, snapshot(room));
          }
        });
        ws.resume();
      }).catch(error => { console.error(error); ws.close(1011, 'Cannot load drawing'); });
    });
  });
  // An unresponsive consumer gets disconnected instead of retaining an old lane forever.
  const timer = setInterval(() => {
    for (const promise of rooms.values()) void promise.then(room => {
      for (const peer of room.peers) if (peer.inFlight !== null && Date.now() - peer.sentAt > 15000) peer.socket.close(4008, 'Acknowledgment timeout');
    });
  }, 5000);
  timer.unref();
  return async () => {
    clearInterval(timer);
    for (const socket of wss.clients) socket.terminate();
    wss.close();
    for (const [name, pending] of rooms) {
      const room = await pending;
      if (room.persist) {
        clearTimeout(room.persist);
        await room.saving;
        await writeFile(join(directory, name + '.json'), JSON.stringify(room.committed));
      } else await room.saving;
    }
  };
}
