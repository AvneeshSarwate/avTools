Below is a copy-pasteable implementation plan for a coding agent.

---

# Project: HAP Encoder Tool + Browser WebGPU HAP Player

## Goal

Build two related systems:

1. **Desktop encoder GUI**
   A simple cross-platform native GUI app that lets users select video files and encode them into a browser-playable HAP package format.

2. **Browser playback system**
   A Chrome desktop / MacBook Pro-focused WebGPU player that loads the custom HAP package from a local file, decodes HAP frames in a worker, uploads BC3 compressed texture data to WebGPU, and renders the video.

No audio support is needed.

Primary target:

```txt
macOS MacBook Pro
Chrome desktop
WebGPU enabled by default
texture-compression-bc required
local file playback
Hap Q / HapY only for v1
```

Do not attempt generic MOV playback in the browser. The browser should only consume our custom indexed `.happack` format.

---

# Part 1 — Rust Encoder GUI

## Technology choices

Use:

```txt
Language: Rust
GUI: egui + eframe
File dialogs: rfd
Encoding backend: bundled ffmpeg executable invoked as subprocess
Packaging: custom Rust .happack writer
Distribution: native binary/app bundle with ffmpeg bundled or extracted
```

Do not bind directly to libav for v1. Run FFmpeg as a subprocess.

The GUI exists so users never type CLI commands. Internally, the app can still call FFmpeg.

---

## Encoder app user flow

The app should provide:

```txt
Add files
Remove files
Choose output folder
Choose preset
Encode
Show progress
Show log
Show success/error per file
```

Recommended UI:

```txt
[ Add Videos ] [ Remove Selected ]

Output Folder:
[ /path/to/output ] [ Choose Folder ]

Preset:
(•) WebGPU Hap Q, recommended
( ) Fast Hap, lower quality

Advanced:
Chunks: [4]
Snappy compression: [on]
Generate .happack: [on]

[ Encode ]

Queue:
input_01.mov    75%
input_02.mp4    waiting
input_03.mov    done

[ Show FFmpeg Log ]
```

For v1, only implement the recommended preset:

```txt
WebGPU Hap Q
FourCC: HapY
HAP format: hap_q
GPU texture format: bc3-rgba-unorm
Color encoding: scaled YCoCg
Compressor: snappy
Chunks: 4
No audio
```

---

## Rust crates

Use these crates:

```toml
[dependencies]
eframe = "latest"
egui = "latest"
rfd = "latest"
serde = { version = "latest", features = ["derive"] }
serde_json = "latest"
anyhow = "latest"
thiserror = "latest"
byteorder = "latest"
crossbeam-channel = "latest"
tempfile = "latest"
```

Optional later:

```toml
tracing = "latest"
tracing-subscriber = "latest"
directories = "latest"
```

---

## Internal app modules

Suggested Rust module layout:

```txt
src/
  main.rs
  app.rs
  config.rs
  encode/
    mod.rs
    ffmpeg.rs
    progress.rs
    jobs.rs
  happack/
    mod.rs
    writer.rs
    mov_reader.rs
    types.rs
  platform/
    mod.rs
    bundled_ffmpeg.rs
```

Responsibilities:

```txt
app.rs
  egui UI state
  queue management
  start/cancel encode jobs
  display progress/errors/logs

encode/ffmpeg.rs
  locate bundled ffmpeg
  build ffmpeg args
  spawn process
  parse progress output

encode/progress.rs
  parse ffmpeg -progress pipe:1 output

encode/jobs.rs
  background job thread
  per-file encode lifecycle

happack/writer.rs
  write .happack file

happack/mov_reader.rs
  extract HAP compressed samples from FFmpeg-generated MOV

happack/types.rs
  shared package metadata/index structs

platform/bundled_ffmpeg.rs
  find ffmpeg next to app
  or extract embedded ffmpeg to cache/temp dir
```

---

## FFmpeg command

For Hap Q / HapY output:

```bash
ffmpeg \
  -y \
  -i INPUT_FILE \
  -an \
  -c:v hap \
  -format hap_q \
  -chunks 4 \
  -compressor snappy \
  -progress pipe:1 \
  TEMP_OUTPUT.mov
```

Notes:

```txt
-an removes audio.
-c:v hap selects the HAP encoder.
-format hap_q selects Hap Q / HapY.
-chunks 4 creates independently decompressible HAP chunks.
-compressor snappy uses Snappy second-stage compression.
-progress pipe:1 gives machine-readable progress.
```

The GUI should never expose this command directly unless the user opens a debug log.

---

## FFmpeg progress parsing

Use:

```bash
-progress pipe:1
```

Parse lines like:

```txt
frame=123
fps=45.2
out_time_ms=4100000
progress=continue
progress=end
```

To compute percent, get source duration first with ffprobe or by parsing FFmpeg probe output.

Simpler v1:

1. Before encoding, run:

```bash
ffprobe \
  -v error \
  -select_streams v:0 \
  -show_entries stream=duration,nb_frames,r_frame_rate,width,height \
  -of json \
  INPUT_FILE
```

2. Store duration seconds.

3. During encode, compute:

```txt
percent = out_time_ms / (duration_seconds * 1_000_000)
```

Clamp to 0–100%.

---

## HAP package format

Create a custom `.happack` file.

Purpose:

```txt
Browser does not parse MOV.
Browser reads our header and index.
Browser can directly seek to each encoded HAP frame.
Each frame payload is one complete HAP sample from the MOV.
```

Use little-endian binary.

### File layout

```txt
HAPPACK FILE

[FixedHeader]
[Metadata JSON bytes]
[FrameIndexEntry array]
[Frame payload bytes...]
```

### FixedHeader

Size: 64 bytes.

```rust
#[repr(C)]
struct FixedHeader {
    magic: [u8; 8],           // b"HAPPACK\0"
    version: u32,             // 1
    header_size: u32,         // 64
    metadata_offset: u64,     // 64
    metadata_length: u64,
    index_offset: u64,
    index_entry_count: u64,
    index_entry_size: u32,    // 32 for v1
    reserved: [u8; 12],
}
```

Use magic:

```txt
48 41 50 50 41 43 4B 00
"HAPPACK\0"
```

### Metadata JSON

Example:

```json
{
  "version": 1,
  "codec": "HapY",
  "hapFlavor": "hap_q",
  "gpuFormat": "bc3-rgba-unorm",
  "colorModel": "scaled-ycocg",
  "width": 3840,
  "height": 2160,
  "frameRateNumerator": 60,
  "frameRateDenominator": 1,
  "timescale": 1000000,
  "frameCount": 1200,
  "durationUs": 20000000,
  "hasAudio": false,
  "chunks": 4,
  "compressor": "snappy"
}
```

### FrameIndexEntry

Size: 32 bytes.

```rust
#[repr(C)]
struct FrameIndexEntry {
    timestamp_us: u64,
    duration_us: u32,
    flags: u32,
    offset: u64,
    byte_length: u64,
}
```

Flags v1:

```txt
0x00000001 = keyframe
```

Since HAP is intra-frame, every frame can be treated as keyframe.

### Frame payload

Each payload is the exact compressed HAP sample from the encoded MOV.

Do not decode HAP during packaging. The packer should preserve the sample bytes.

---

## How to extract HAP samples from MOV

For v1, the packer only needs to support MOV files generated by our own FFmpeg command.

Implement a minimal QuickTime/MP4 sample extractor in Rust.

Required atoms:

```txt
ftyp
moov
mdat
trak
mdia
hdlr
mdhd
minf
stbl
stsd
stts
stsc
stsz
stco
co64
```

Optional but useful:

```txt
ctts
stss
elst
```

For v1, assume:

```txt
One video track
No audio
No edit list
Constant frame rate preferred
HAP sample entry in stsd
mdat contains video samples
```

The extractor should:

1. Parse atom tree.
2. Find video track:

   * `trak.mdia.hdlr` handler type == `vide`
3. Read:

   * width
   * height
   * timescale from `mdhd`
   * sample description FourCC from `stsd`; expect `HapY`
   * sample durations from `stts`
   * sample sizes from `stsz`
   * chunk offsets from `stco` or `co64`
   * sample-to-chunk mapping from `stsc`
4. Compute absolute file offset for every sample.
5. Copy each sample byte range into `.happack`.
6. Convert timestamps/durations to microseconds.

Conversion:

```rust
timestamp_us = timestamp_in_track_timescale * 1_000_000 / timescale
duration_us = duration_in_track_timescale * 1_000_000 / timescale
```

Validate:

```txt
FourCC must be HapY for v1.
Width/height must be > 0.
Frame count must match sample count.
Each sample offset + size must be inside file.
```

Do not support arbitrary user-supplied HAP MOV edge cases yet. Only support the MOV generated by our own app.

---

## Encoding pipeline per input file

For each selected video:

```txt
1. Probe input file.
2. Create temp directory.
3. Run FFmpeg to encode input -> temp_hapq.mov.
4. Parse temp_hapq.mov sample table.
5. Write output_file.happack.
6. Delete temp_hapq.mov unless debug mode is enabled.
7. Mark job complete.
```

Suggested output naming:

```txt
input.mov -> input.happack
```

Avoid overwriting unless the user confirms or the app auto-suffixes:

```txt
input.happack
input_2.happack
input_3.happack
```

---

## Job threading

The UI must stay responsive.

Architecture:

```txt
Main/UI thread:
  egui rendering
  queue display
  receives progress messages

Worker thread:
  runs encoding jobs sequentially
  spawns ffmpeg
  parses progress
  runs packer
  sends progress updates to UI thread
```

Use `crossbeam-channel`.

Progress message enum:

```rust
enum JobEvent {
    Started { job_id: usize },
    Progress { job_id: usize, percent: f32, message: String },
    LogLine { job_id: usize, line: String },
    Finished { job_id: usize, output_path: PathBuf },
    Failed { job_id: usize, error: String },
}
```

Cancellation v1:

```txt
Store child process handle.
On cancel, kill FFmpeg process.
Mark current job cancelled.
```

---

## Bundling FFmpeg

Support two modes.

### Mode A: sidecar executable

Recommended for early development.

```txt
macOS:
  HapEncoder.app/Contents/Resources/ffmpeg

Windows:
  HapEncoder.exe
  ffmpeg.exe
```

The app locates FFmpeg relative to its executable.

### Mode B: embedded executable

For “single binary” distribution.

Use `include_bytes!()` to embed platform-specific FFmpeg.

On startup:

```txt
1. Compute expected cache path.
2. If missing or wrong hash, write embedded ffmpeg bytes to cache.
3. On macOS, chmod +x.
4. Use extracted path when spawning FFmpeg.
```

Cache location example:

```txt
macOS: ~/Library/Caches/HapEncoder/ffmpeg
Windows: %LOCALAPPDATA%/HapEncoder/ffmpeg.exe
```

Do not statically link libav in v1.

---

## Encoder app MVP milestones

### Milestone E1 — Basic GUI shell

Deliver:

```txt
egui window
Add files
Remove files
Choose output folder
Preset dropdown
Encode button disabled/enabled correctly
Queue table
Log panel
```

No FFmpeg yet.

### Milestone E2 — FFmpeg sidecar encode

Deliver:

```txt
Run FFmpeg on one selected file
Produce temp Hap Q MOV
Show progress
Show logs
Handle errors
```

### Milestone E3 — Batch encode

Deliver:

```txt
Multiple files processed sequentially
Per-job status
Cancel current job
Continue or stop on error option
```

### Milestone E4 — MOV sample extractor

Deliver:

```txt
Parse FFmpeg-generated Hap Q MOV
Extract video samples
Print frame count, width, height, FourCC
Unit test against fixture MOV
```

### Milestone E5 — .happack writer

Deliver:

```txt
Write valid .happack
Header
Metadata JSON
Frame index
Frame payloads
Validation tool can read it back
```

### Milestone E6 — App-integrated packer

Deliver:

```txt
Input video -> temp Hap Q MOV -> final .happack
GUI shows final output path
```

### Milestone E7 — Single-binary-ish distribution

Deliver:

```txt
Embed or bundle FFmpeg
macOS build
Windows build
Smoke test on clean machines
```

---

# Part 2 — Browser WebGPU Playback System

## Technology choices

Use:

```txt
Language: TypeScript
Build tool: Vite
Renderer: WebGPU only
Decode worker: Web Worker
Input: local .happack file
Codec v1: Hap Q / HapY only
GPU texture: bc3-rgba-unorm
No audio
```

Do not support:

```txt
Safari
Firefox
mobile
WebGL fallback
generic MOV demuxing
WebCodecs decoder registration
audio sync
Hap Alpha / Hap R / HDR in v1
```

---

## Browser package layout

Suggested structure:

```txt
web-player/
  package.json
  vite.config.ts
  src/
    main.ts
    app.ts
    happack/
      reader.ts
      types.ts
    hap/
      decoder.ts
      parser.ts
      snappy.ts
    gpu/
      renderer.ts
      shaders.ts
    playback/
      scheduler.ts
      clock.ts
      frame_queue.ts
    workers/
      decode.worker.ts
```

---

## Runtime feature detection

At startup:

```ts
export async function createDevice(): Promise<GPUDevice> {
  if (!navigator.gpu) {
    throw new Error("WebGPU is not available.");
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("No WebGPU adapter found.");
  }

  if (!adapter.features.has("texture-compression-bc")) {
    throw new Error("WebGPU BC compressed textures are unavailable.");
  }

  return await adapter.requestDevice({
    requiredFeatures: ["texture-compression-bc"],
  });
}
```

Fail clearly if unavailable.

---

## Browser user flow

Simple player page:

```txt
[ Select .happack File ]

After load:
  Canvas
  Play / Pause
  Seek slider
  Frame number
  FPS
  Loop checkbox
  Debug stats
```

No audio controls.

---

## Happack reader

Browser should read:

```txt
File object
  -> header
  -> metadata JSON
  -> frame index
```

Use local file APIs:

```ts
async function readRange(file: File, offset: number, length: number): Promise<ArrayBuffer> {
  return await file.slice(offset, offset + length).arrayBuffer();
}
```

Types:

```ts
export type HapPackMetadata = {
  version: number;
  codec: "HapY";
  hapFlavor: "hap_q";
  gpuFormat: "bc3-rgba-unorm";
  colorModel: "scaled-ycocg";
  width: number;
  height: number;
  frameRateNumerator: number;
  frameRateDenominator: number;
  timescale: number;
  frameCount: number;
  durationUs: number;
  hasAudio: false;
  chunks: number;
  compressor: "snappy";
};

export type FrameIndexEntry = {
  timestampUs: number;
  durationUs: number;
  flags: number;
  offset: number;
  byteLength: number;
};
```

Reader API:

```ts
export class HapPackReader {
  static async open(file: File): Promise<HapPackReader>;

  readonly file: File;
  readonly metadata: HapPackMetadata;
  readonly index: FrameIndexEntry[];

  async readFrame(frameNumber: number): Promise<ArrayBuffer>;
}
```

Validation:

```txt
magic == HAPPACK\0
version == 1
codec == HapY
gpuFormat == bc3-rgba-unorm
frameCount == index.length
offset/byteLength within file
```

---

## HAP decoder

Input:

```txt
One encoded HAP sample from .happack
```

Output:

```txt
One complete BC3 compressed texture byte buffer
```

API:

```ts
export type DecodedHapFrame = {
  frameNumber: number;
  width: number;
  height: number;
  gpuFormat: "bc3-rgba-unorm";
  bcBytes: Uint8Array;
};

export function decodeHapYFrame(
  encoded: Uint8Array,
  width: number,
  height: number
): Uint8Array;
```

Expected BC3 output size:

```ts
export function expectedBc3ByteLength(width: number, height: number): number {
  const blockWidth = Math.ceil(width / 4);
  const blockHeight = Math.ceil(height / 4);
  return blockWidth * blockHeight * 16;
}
```

Validate after decode:

```ts
if (bcBytes.byteLength !== expectedBc3ByteLength(width, height)) {
  throw new Error("Decoded BC3 byte length mismatch.");
}
```

---

## HAP frame parsing requirements

Implement only what is needed for Hap Q / HapY v1.

The decoder must support:

```txt
Top-level HAP section parsing
Snappy-compressed frame data
Chunked frame data
Chunk size table
Chunk offset table
Chunk compressor table if present
Uncompressed chunks
```

The decoder should produce the raw BC3/DXT5 Scaled-YCoCg texture payload.

Do not convert YCoCg to RGBA on CPU.

Do not expand BC3 on CPU.

---

## Snappy

Use an existing JS/WASM Snappy implementation initially.

Wrap it behind:

```ts
export function snappyUncompress(input: Uint8Array, expectedLength?: number): Uint8Array;
```

Later, optimize with WASM if necessary.

Important:

```txt
Decoded frame output should be one contiguous Uint8Array containing BC3 blocks.
Avoid unnecessary copies.
Reuse buffers where possible after v1 works.
```

---

## Decode worker

Use one dedicated worker in v1.

The worker owns:

```txt
File reference
HapPack metadata
Frame index
Decode request queue
```

Main thread sends init:

```ts
worker.postMessage({
  type: "init",
  file,
  metadata,
  index
});
```

Main thread requests frames:

```ts
worker.postMessage({
  type: "decodeFrame",
  requestId,
  frameNumber
});
```

Worker:

```ts
self.onmessage = async (event) => {
  switch (event.data.type) {
    case "init":
      // store file, metadata, index
      break;

    case "decodeFrame":
      // read file slice
      // decode HapY
      // transfer BC3 ArrayBuffer back
      break;

    case "cancelBefore":
      // drop stale queued requests
      break;
  }
};
```

Worker output:

```ts
self.postMessage(
  {
    type: "decodedFrame",
    requestId,
    frameNumber,
    buffer: bcBytes.buffer
  },
  [bcBytes.buffer]
);
```

Use transferable `ArrayBuffer`s. Do not copy large buffers between worker and main thread.

---

## Playback clock

No audio. Use `performance.now()`.

Clock state:

```ts
class PlaybackClock {
  fps: number;
  playing: boolean;
  playStartTimeMs: number;
  playStartFrame: number;
  pausedFrame: number;

  play(fromFrame?: number): void;
  pause(): void;
  seek(frame: number): void;
  currentFrame(now?: number): number;
}
```

Frame calculation:

```ts
const elapsedSec = (performance.now() - playStartTimeMs) / 1000;
const frame = playStartFrame + Math.floor(elapsedSec * fps);
```

Looping:

```ts
frame = frame % frameCount;
```

---

## Scheduler

The scheduler decides which frames to request from the worker.

Start settings:

```txt
readAheadFrames: 16
maxInFlightRequests: 4
maxReadyCpuFrames: 8
```

For current frame `N`, request:

```txt
N
N+1
N+2
...
N+16
```

For looping, wrap around frame count.

On seek:

```txt
clear ready frame queue
increment generation id
send cancelBefore/generation to worker
request new frame window
```

Use generation IDs so stale decoded frames are ignored.

Types:

```ts
type DecodeRequest = {
  generation: number;
  frameNumber: number;
};
```

Worker response includes generation.

---

## Frame queue

Main thread stores decoded CPU-side BC3 buffers briefly.

```ts
class FrameQueue {
  add(frameNumber: number, bcBytes: Uint8Array): void;
  getExact(frameNumber: number): DecodedFrame | undefined;
  getLatestReadyAtOrBefore(frameNumber: number): DecodedFrame | undefined;
  remove(frameNumber: number): void;
  clear(): void;
}
```

For smooth playback:

```txt
Prefer exact desired frame.
If exact frame is missing, present latest ready frame before it.
If no frame is ready, keep displaying previous texture.
```

---

## WebGPU renderer

Renderer owns:

```txt
GPUDevice
GPUCanvasContext
render pipeline
sampler
bind group layout
3–5 GPUTextures in ring
current texture
fullscreen quad or triangle
YCoCg shader
```

Create textures:

```ts
const texture = device.createTexture({
  size: {
    width,
    height,
    depthOrArrayLayers: 1
  },
  format: "bc3-rgba-unorm",
  usage:
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.COPY_DST
});
```

Upload BC3 frame:

```ts
function uploadBc3Frame(
  device: GPUDevice,
  texture: GPUTexture,
  bc3Bytes: Uint8Array,
  width: number,
  height: number
) {
  const blockWidth = Math.ceil(width / 4);
  const blockHeight = Math.ceil(height / 4);

  device.queue.writeTexture(
    { texture },
    bc3Bytes,
    {
      bytesPerRow: blockWidth * 16,
      rowsPerImage: blockHeight
    },
    {
      width,
      height,
      depthOrArrayLayers: 1
    }
  );
}
```

Use a texture ring:

```txt
texture[0]
texture[1]
texture[2]
```

Do not create a new GPUTexture every frame.

---

## YCoCg shader

Hap Q stores Scaled YCoCg in BC3/DXT5. The fragment shader must sample the BC3 texture and convert to RGB.

Create a WGSL shader with:

```wgsl
@group(0) @binding(0)
var hapTex: texture_2d<f32>;

@group(0) @binding(1)
var hapSampler: sampler;

fn ycocg_to_rgb(c: vec4<f32>) -> vec3<f32> {
    // Placeholder. Implement exact Scaled YCoCg conversion matching HAP reference.
    // The sampled channels from BC3 need to be interpreted according to HAP Q layout.
    let y = c.a;
    let co = c.r - 0.5;
    let cg = c.g - 0.5;

    let r = y + co - cg;
    let g = y + cg;
    let b = y - co - cg;

    return vec3<f32>(r, g, b);
}
```

Important task for the coding agent:

```txt
Check the official HAP reference shader / reference implementation and implement the exact Hap Q Scaled YCoCg mapping.
Do not assume the placeholder above is final.
Add visual test fixtures to verify colors.
```

Renderer API:

```ts
export class HapWebGpuRenderer {
  constructor(canvas: HTMLCanvasElement, device: GPUDevice, width: number, height: number);

  uploadFrame(frameNumber: number, bcBytes: Uint8Array): void;

  draw(): void;

  resize(): void;

  destroy(): void;
}
```

---

## Main playback loop

Use `requestAnimationFrame`.

Pseudo-code:

```ts
function tick(now: DOMHighResTimeStamp) {
  if (!playing) {
    renderer.draw();
    requestAnimationFrame(tick);
    return;
  }

  const desiredFrame = clock.currentFrame(now);

  scheduler.ensureFramesAround(desiredFrame);

  const ready = frameQueue.getExact(desiredFrame)
    ?? frameQueue.getLatestReadyAtOrBefore(desiredFrame);

  if (ready && ready.frameNumber !== currentlyUploadedFrame) {
    renderer.uploadFrame(ready.frameNumber, ready.bcBytes);
    frameQueue.remove(ready.frameNumber);
    currentlyUploadedFrame = ready.frameNumber;
  }

  renderer.draw();

  requestAnimationFrame(tick);
}
```

---

## Browser MVP milestones

### Milestone P1 — Static WebGPU test

Deliver:

```txt
Open page in Chrome
Create WebGPU device with texture-compression-bc
Create bc3-rgba-unorm texture
Render test texture or clear screen
Show feature status
```

### Milestone P2 — .happack reader

Deliver:

```txt
File picker
Read header
Parse metadata
Parse index
Display metadata
Validate frame count and offsets
```

### Milestone P3 — Decode one frame

Deliver:

```txt
Read frame 0 payload
Decode HapY to BC3 bytes
Validate BC3 byte length
Log timing
```

### Milestone P4 — Render one frame

Deliver:

```txt
Upload decoded BC3 to WebGPU texture
Draw fullscreen
Apply Hap Q YCoCg shader
Confirm image looks correct
```

### Milestone P5 — Worker decode

Deliver:

```txt
Move file range read + HAP decode to worker
Transfer BC3 ArrayBuffer back
Render decoded frame on main thread
```

### Milestone P6 — Playback clock

Deliver:

```txt
Play/pause
performance.now clock
Frame stepping
Seek slider
Looping
```

### Milestone P7 — Read-ahead scheduler

Deliver:

```txt
Request 16 frames ahead
Maintain ready frame queue
Drop late/stale frames
Handle seek generation IDs
```

### Milestone P8 — Performance pass

Deliver stats overlay:

```txt
current frame
target frame
decoded queue length
in-flight requests
decode ms
file read ms
upload ms
dropped frames
average FPS
```

---

# Shared Test Fixtures

Create test assets:

```txt
fixtures/
  colorbars_1080p_60.mov
  colorbars_1080p_60.happack
  colorbars_4k_60.mov
  colorbars_4k_60.happack
  gradient_1080p_30.happack
```

Encoder tests:

```txt
Input fixture -> .happack
Verify header
Verify metadata
Verify frame index count
Verify all offsets valid
Verify first frame payload non-empty
```

Browser tests:

```txt
Load fixture
Decode frame 0
Decoded BC3 byte length matches expected
Render visually
Seek to middle
Loop playback
```

For visual correctness, include:

```txt
color bars
skin-tone-ish gradient
high contrast edges
red/green/blue primaries
```

This helps catch YCoCg shader mistakes.

---

# Performance Targets

Initial targets on MacBook Pro:

```txt
1080p60 Hap Q: smooth playback
4K30 Hap Q: smooth playback
4K60 Hap Q: target smooth, benchmark and optimize
```

Approximate BC3 upload payload:

```txt
1920x1080: ~2.0 MB/frame
3840x2160: ~8.3 MB/frame
```

At 60 fps:

```txt
1080p60: ~124 MB/s GPU upload
4K60: ~498 MB/s GPU upload
```

The player should avoid:

```txt
creating new GPUTexture every frame
copying ArrayBuffers unnecessarily
decoding on main thread
queueing hundreds of decoded frames
CPU RGBA conversion
```

---

# Explicit Non-Goals for v1

Do not implement:

```txt
Browser MOV demuxing
MP4Box.js integration
WebCodecs integration
Audio playback/sync
Safari support
Firefox support
Mobile support
WebGL fallback
Hap Alpha
Hap Q Alpha
Hap R / BC7
Hap HDR / BC6H
Network streaming
DRM
Installer/signing/notarization polish
```

---

# Final Build Order

Build in this order:

```txt
1. Browser WebGPU BC3 feature test
2. Rust encoder GUI shell
3. FFmpeg sidecar Hap Q encode from GUI
4. Rust MOV sample extractor for our generated MOV
5. Rust .happack writer
6. Browser .happack reader
7. Browser single-frame HapY decoder
8. Browser single-frame WebGPU render
9. Worker-based decode
10. Playback clock + read-ahead scheduler
11. Batch encoding in GUI
12. Embedded/bundled FFmpeg distribution
13. Performance tuning
```

The highest-risk item is not the GUI. The highest-risk item is the correctness of:

```txt
HapY frame parse
Snappy/chunk decode
BC3 byte layout
YCoCg shader conversion
```

Validate that path with one frame before building the full playback UI.
