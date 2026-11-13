# Files, UDP, OSC and WebSockets in TouchDesigner

Both TOP and CHOP scripts receive `host.files`, `host.udp`, and `host.osc`.
These are native libuv-backed APIs; they do not require Node, npm, a terminal
process, or an additional library beside the `.plugin` bundle.

Use `async setup(...)` to load assets or bind sockets. I/O callbacks and promise
continuations run on the instance's existing JavaScript worker even when TD is
not cooking. They can read the latest accepted inputs/parameters and update
ordinary script state. A CHOP publishes completed callback-turn output; a TOP
uses the updated state on its next render. TD still needs a cook to present it.

```ts
import type {ChopHost} from '@avtools/native-webgpu/td-chop';

export async function setup(host: ChopHost) {
  const config = JSON.parse(await host.files.readText('./config.json'));
  const osc = await host.osc.open({port: config.port});

  osc.onMessage((message, remote) => {
    const value = message.args[0];

    if (message.address === '/gain' && value?.type === 'f') {
      host.outputs.set('value', value.value);
      osc.send({address: '/ack', args: [value]}, remote).catch(console.warn);
    }
  });

  osc.onError((error) => console.warn(error.message));
}
```

## File paths

`await host.files.readBytes(path)` returns an owned `Uint8Array`.
`await host.files.readText(path)` reads UTF-8 text, rejecting invalid encoding.
For a TypeScript or Source File entry, relative paths resolve beside that file,
not beside a generated cache bundle. DAT scripts use `project.folder`; legacy
manifest projects use their Project Directory. `host.files.baseDirectory`
reports that directory. Absolute paths, `../` and symlinks are supported with
TouchDesigner's normal macOS file permissions. No virtual filesystem is used.

Only regular files are accepted, up to 64 MiB each, with at most four pending
reads per instance. Missing files, directories, permissions and size limits
reject the promise. File edits alone do not trigger a TypeScript rebuild:
press Reset to reread setup assets, or explicitly read them again in your code.

The older TOP `host.readFile()` remains a synchronous compatibility API for
existing renderer/font usage; prefer `host.files` for new application code.
This is not Node's `fs` module and does not install global `fetch` or `Buffer`.

## UDP sockets

`await host.udp.open({address: '127.0.0.1', port: 9000})` binds a socket.
Omitting the options uses loopback and an available port (`0`). Inspect
`socket.localAddress`, register `socket.onMessage((bytes, remote) => ...)`, and
send with `await socket.send(bytes, {address: '127.0.0.1', port: 9001})`.
Payload bytes are copied before `send` returns. Each listener receives the same
owned packet object; copy it if you want to mutate it independently.

Numeric IPv4 and IPv6 addresses and `localhost` are supported. DNS hostnames,
multicast and broadcast options are not implemented. Bind `0.0.0.0` or `::`
explicitly for LAN reception. Ports are exclusive: a duplicate bind rejects.
A successful send means the OS accepted the datagram, not that a peer received
it. UDP can lose or reorder messages.

Listeners return an unsubscribe function. `socket.close()` is idempotent.
Reload, Reset, failed-generation invalidation and operator destruction close
sockets automatically and discard old callbacks. Changing a Port parameter
requires Reset when the socket is opened in setup. `onError` handles receive
errors; a native receive failure closes that socket after reporting it.
Open/send errors reject their promises.

Limits per instance: 16 open sockets, 64 in-flight native sends, 128 pending
operations and a 65,507-byte UDP payload. The received packet queue retains at
most 256 packets / 4 MiB; excess packets are dropped. Read
`host.udp.droppedDatagrams` to monitor queue overflow. This counter does not
include packets lost by the network or OS. File and send completions are kept
separately from the packet admission limit so flooding cannot lose promises.

## OSC messages and bundles

`host.osc.open()` wraps a UDP socket with the same options and lifecycle.

```ts
await osc.send({
  address: '/position',
  args: [0.25, 0.75, {type: 'i', value: 42}, 'hello', true],
}, {address: '127.0.0.1', port: 9001});

await osc.send({
  timetag: 1n,
  packets: [{address: '/start'}, {address: '/gain', args: [0.5]}],
}, remote);
```

Plain numbers encode as OSC float32; strings, booleans, null, bigint and
Uint8Array infer string, boolean, nil, int64 and blob respectively. Explicit
`{type, value}` arguments support `i f s b h t d S c r m T F N I` and nested
`{type: 'array', value: [...]}` arrays. Incoming arguments retain their type;
see [td-io.d.ts](td-io.d.ts) for the full public types.

Bundle messages are delivered in wire order immediately, including future
bundles. Each message has the innermost bundle's raw 64-bit NTP `timetag`;
standalone messages use `1n`. There is no automatic future scheduling or OSC
address-pattern routing. Use TimeContext or your own dispatch logic if needed.
Malformed packets, unsupported tags and nesting beyond 16 are discarded as a
whole and reported to the socket's `onError` listeners. User callback exceptions
follow the normal sketch error policy.

## Examples and implementation

Create Template Project includes `examples/osc/channels.ts` (TimeContext easing
and OSC replies), `picture.ts` (OSC-controlled position), `udp.ts` (raw echo),
and `config.json` (async setup asset). The CHOP examples document their required
Output Channels at the top of each file. The live repo fixture is in
[native/td/io-example](native/td/io-example/README.md).

Libuv is statically linked into the private runtime inside each plugin. Each
instance creates its I/O loop/thread lazily on first use. That loop sleeps on
OS events and wakes the existing V8 owner through its condition variable; no
1 ms polling was added. File work uses libuv's shared thread pool. All V8 calls
stay on the owner, with the existing watchdog, microtask and generation rules.
An instance that never uses I/O creates no libuv thread. Teardown joins the loop
and drains in-flight file requests; unusually slow filesystems can delay teardown.

`native-manifest.json` pins libuv 1.52.1 and its archive SHA-256. `embedding.mjs`
builds it statically through `scripts/libuv.mjs`. The TypeScript compiler is
statically linked into each TOP/CHOP executable, independently of the Rust text
renderer in the runtime. Compiler services are shared within a loaded plugin
binary; different plugin binaries can have separate watchers/compiler caches.
Unique temporary filenames make concurrent cache publication atomic.

Run `node --test packages/native-webgpu/test/io/codec.mjs` and
`node packages/native-webgpu/test/io/run.mjs` from the repo root. The latter
requires permission to bind local UDP sockets. See the fixture README for live
TouchDesigner checks and recorded timing results.

## Validation on this Mac

On the M1 Max, the final native test recorded a localhost OSC request/reply
median of **0.089 ms**, p95 **0.197 ms**, while TD submitted no cooks. Four idle
UDP instances consumed **0.011% of one core** over a 600 ms sample. Four simple
synchronous CHOP cooks together took **0.150 ms median / 0.324 ms p95**. The idle
sample is short and near the measurement floor; these are local test results,
not a promise about LAN latency or heavier scripts.

A 6,001-packet burst with a deliberately stalled JS callback delivered 257
packets and dropped 5,744 at the bounded queue, then recovered. Tests also cover
50 fixed-port reloads, failed-setup socket release, teardown, UTF-8/binary reads,
missing/directory/FIFO/oversize files, malformed OSC, nested/future bundles and
10,000 malformed-packet fuzz inputs. Existing compiler watcher, buffered CHOP,
and 400 CHOP / 160 TOP restart regression checks passed.

Real TouchDesigner 2025.31550 tests copied each plugin into a separate temporary
folder, without any sibling compiler library; both generated and built templates.
TD OSC Out DAT ↔ JS replies, TOP pixel output, TimeContext easing, relative JSON
assets, Reset and source-save/reload on the same port passed. Machine-readable
results: [native.json](test/io/results/native.json), [td.json](test/io/results/td.json).

## WebSocket client API (TOP and CHOP)

`host.webSocket.connect(url)` returns a connection immediately, initially in
`connecting` state. Register listeners synchronously after connecting. Use
`ws://` for local servers or `wss://` for TLS; DNS names are supported. macOS's
system transport handles framing, fragmentation, ping/pong, DNS and certificate
validation. No extra dylib, Node process, or npm dependency is needed inside TD.
This does not install global `WebSocket`, `fetch`, HTTP, or raw TCP APIs. Servers
run externally. URLs cannot contain credentials or fragments; redirects are not
followed. Cookies and shared credential storage are disabled.

```ts
const socket = host.webSocket.connect('ws://127.0.0.1:8080');

socket.onOpen(() => {
  void socket.send(JSON.stringify({type: 'subscribe', drawing: 'main'}))
    .catch(error => console.warn(error.message));
});

socket.onMessage(data => {
  // string for text; owned Uint8Array for binary.
  if (typeof data === 'string') {
    const message = JSON.parse(data);
    // Update ordinary state here. TOP draw() reads it on its next render;
    // CHOP callbacks can write host.outputs immediately.
  }
});

socket.onError(error => console.warn(error.message));
socket.onClose(({code, reason}) => console.log('Closed:', code, reason));
```

API details:

- `url`: the requested URL.
- `readyState`: `connecting | open | closing | closed`.
- `bufferedAmount`: payload bytes awaiting native send completion.
- `onOpen(fn)`, `onMessage(fn)`, `onError(fn)`, `onClose(fn)` return unsubscribe
  functions. Registering a listener does not replay earlier events.
- `send(string | Uint8Array): Promise<void>` copies data and resolves on transport
  send completion, not peer acknowledgment. Sending before open or after close
  rejects. Catch send failures. Text is UTF-8; binary has no encoding conversion.
- `close(code = 1000, reason = '')`: idempotent local shutdown; code must be 1000
  or 3000–4999, reason at most 123 UTF-8 bytes. Local close does not await the
  peer handshake or guarantee delivery of outstanding sends. Remote failures
  generally close with 1006; error precedes close when available.

Limits per runtime: 16 connections, 8 MiB per message, 64 pending sends / 16 MiB,
and 256 queued incoming messages / 16 MiB. An incoming queue overflow closes the
connection with an error instead of silently losing messages. Coalesce stale
updates before sending, and use application acknowledgments for state transfer.

Callbacks run on the existing JS worker, independently of TD cooks, alongside
TimeContext and timers. No per-frame polling is added. Heavy JSON parsing or
geometry processing still occupies that worker. Reset, reload, failed setup and
destruction cancel connections and suppress callbacks from old generations.
There is no automatic reconnect: scripts can use a timer from `onClose`, with a
stopped flag registered through `host.onDispose`. On reconnect, request a current
snapshot instead of assuming messages sent while disconnected will be replayed.

Generated examples: `examples/websocket/picture.ts` and `channels.ts`. They expect
an external server at port 8080. The avTools repository also has `apps/td-canvas`,
a standalone Vue drawing app, local WebSocket relay, and TOP/CHOP examples with
reconnect and full-state recovery.
