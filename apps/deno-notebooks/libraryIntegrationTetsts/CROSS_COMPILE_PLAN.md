# Cross-Compile Plan: @gfx/canvas for Raspberry Pi ARM64

## Overview

Build `libnative_canvas.so` (Skia-backed Canvas 2D) for Linux ARM64, to be
checked into the repo or hosted as a release asset. This gives Pi users the
full-quality native canvas (proper measureText, textAlign, textBaseline,
HarfBuzz shaping) instead of the WASM fallback.

**Platforms with prebuilt binaries (no build needed):**
- macOS x64, macOS ARM64, Windows x64, Linux x64

**Platform needing cross-compile:**
- Linux ARM64 (Raspberry Pi 4/5 running 64-bit Raspberry Pi OS)

---

## Architecture

Two things get compiled:

1. **Skia** (C++ via GN/Ninja) → static libraries (`libskia.a` etc, ~321 MB)
2. **native_canvas** (C++ via CMake) → `libnative_canvas.so` (~22-24 MB)
   - Statically links Skia + freetype + harfbuzz + ICU + libpng + zlib + etc.
   - Dynamically links: libGL, libX11, libfontconfig, libc/libstdc++

The Deno FFI layer is pure TypeScript — no native compilation needed.

---

## Step-by-Step Build Process

### Prerequisites

- Docker Desktop on Apple Silicon Mac (ARM64 containers run natively, no emulation)
- ~16 GB free disk space
- ~8 GB RAM allocated to Docker

### Step 1: Create build directory and Dockerfile

```
mkdir -p scripts/build-skia-arm64
```

**`scripts/build-skia-arm64/Dockerfile`:**
```dockerfile
FROM debian:bookworm

RUN apt-get update && apt-get install -y \
    git python3 curl wget clang lld cmake ninja-build pkg-config \
    libfontconfig1-dev libgl1-mesa-dev libglu1-mesa-dev mesa-common-dev \
    libx11-dev libxrandr-dev libxinerama-dev libxcursor-dev libxi-dev \
    libxcomposite-dev libxdamage-dev libxext-dev libxfixes-dev \
    libxrender-dev libglx-dev libegl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
```

### Step 2: Build the Docker image

```bash
cd scripts/build-skia-arm64
docker build --platform linux/arm64 -t skia-arm64-builder .
```

### Step 3: Run the build

**`scripts/build-skia-arm64/build.sh`** (runs INSIDE the container):
```bash
#!/bin/bash
set -euo pipefail

SKIA_COMMIT="2290b0b75a8abb80e23d9cb9aced5b5cebbf702d"
OUTPUT_DIR="/output"

echo "=== Step 1/6: Building GN from source (no ARM64 prebuilt exists) ==="
git clone https://gn.googlesource.com/gn /tmp/gn
cd /tmp/gn
python3 build/gen.py
ninja -C out
cp out/gn /usr/local/bin/
echo "GN built: $(gn --version)"

echo "=== Step 2/6: Cloning Skia at pinned commit ==="
git clone https://skia.googlesource.com/skia.git /build/skia
cd /build/skia
git checkout "$SKIA_COMMIT"

echo "=== Step 3/6: Syncing Skia dependencies (~2 GB download) ==="
python3 tools/git-sync-deps

echo "=== Step 4/6: Configuring GN build ==="
mkdir -p out/Release
cat > out/Release/args.gn << 'ARGS'
cc = "clang"
cxx = "clang++"
is_official_build = false
is_debug = false
is_component_build = false
skia_enable_gpu = true
skia_use_gl = true
skia_enable_discrete_gpu = true
skia_use_x11 = true
skia_use_system_harfbuzz = false
skia_use_system_libpng = false
skia_use_system_libwebp = false
skia_use_system_zlib = false
skia_use_system_icu = false
skia_use_system_expat = false
skia_use_system_libjpeg_turbo = false
skia_use_system_freetype2 = false
skia_enable_skshaper = true
skia_enable_svg = true
skia_enable_pdf = true
skia_enable_particles = true
skia_use_libwebp_encode = true
skia_use_libwebp_decode = true
extra_cflags = ["-std=c++17", "-fno-exceptions"]
ARGS
gn gen out/Release

echo "=== Step 5/6: Building Skia (this takes 30-60 minutes) ==="
ninja -j$(nproc) -C out/Release

echo "=== Step 6/6: Building native_canvas ==="
cd /build
git clone https://github.com/DjDeveloperr/skia_canvas.git
cd skia_canvas/native
mkdir build && cd build
CC=clang CXX=clang++ cmake .. \
    -DCMAKE_BUILD_TYPE=Release \
    -DSKIA_DIR=/build/skia \
    -DSKIA_OUT_DIR=/build/skia/out/Release
cmake --build . --config Release
strip libnative_canvas.so

echo "=== Done! Copying artifact ==="
cp libnative_canvas.so "$OUTPUT_DIR/libnative_canvas_aarch64.so"
ls -lh "$OUTPUT_DIR/libnative_canvas_aarch64.so"
echo "Build complete!"
```

### Step 4: Run the build in Docker

```bash
mkdir -p output
docker run --platform linux/arm64 \
    -v $(pwd)/output:/output \
    -v $(pwd)/build.sh:/build.sh:ro \
    skia-arm64-builder \
    bash /build.sh
```

**Estimated time:** 45-90 minutes on Apple Silicon Mac.

The artifact lands at `output/libnative_canvas_aarch64.so` (~22-24 MB).

### Step 5: Verify the artifact

```bash
file output/libnative_canvas_aarch64.so
# Expected: ELF 64-bit LSB shared object, ARM aarch64, ...

# Check dynamic dependencies (optional, requires aarch64 readelf):
docker run --platform linux/arm64 -v $(pwd)/output:/output debian:bookworm \
    bash -c "apt-get update && apt-get install -y binutils && readelf -d /output/libnative_canvas_aarch64.so | grep NEEDED"
```

---

## Distribution

### Option A: Check into repo (with Git LFS)

```bash
git lfs install
git lfs track "*.so"
cp output/libnative_canvas_aarch64.so native/prebuilt/
git add native/prebuilt/libnative_canvas_aarch64.so
git commit -m "Add prebuilt libnative_canvas for RPi ARM64"
```

### Option B: GitHub Release asset (recommended)

Upload `libnative_canvas_aarch64.so` as a release asset. The `pi-setup.sh`
script downloads it:

```bash
#!/bin/bash
# pi-setup.sh - Run on Raspberry Pi to set up native canvas support
RELEASE_URL="https://github.com/<owner>/<repo>/releases/download/v0.1.0"
DEST="$HOME/.cache/deno-skia"

echo "Installing system dependencies..."
sudo apt-get install -y libfontconfig1 libgl1-mesa-glx libgl1-mesa-dri \
    libegl1 libx11-6 libxrandr2 libxinerama1 libxcursor1 libxi6

echo "Downloading prebuilt native canvas for ARM64..."
mkdir -p "$DEST"
curl -L "$RELEASE_URL/libnative_canvas_aarch64.so" -o "$DEST/libnative_canvas.so"

echo "Done! Set DENO_SKIA_PATH=$DEST before running."
echo "export DENO_SKIA_PATH=$DEST"
```

---

## Runtime Configuration

When running on Pi, users set the env var so `@gfx/canvas` finds the library:

```bash
export DENO_SKIA_PATH=$HOME/.cache/deno-skia
deno run --unstable-webgpu --allow-all your_script.ts
```

The `@gfx/canvas` FFI loader checks `DENO_SKIA_PATH` before trying to
download from GitHub (which would fail for ARM64 since no official prebuilt).

---

## Pi Runtime Dependencies

These are standard packages already installed on Pi OS Desktop:
```
libfontconfig1 libgl1-mesa-glx libgl1-mesa-dri libegl1
libx11-6 libxrandr2 libxinerama1 libxcursor1 libxi6
libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrender1
```

---

## CMakeLists.txt Notes

The `native_canvas` CMakeLists.txt may need the `-DSKIA_DIR` and
`-DSKIA_OUT_DIR` variables adjusted to point to the local Skia build.
If the CMakeLists.txt doesn't support these, the Skia headers and libs
may need to be placed where it expects them (check the `build_skia.ts`
script for the expected layout).

---

## Advanced: Cross-compiling for other platforms

For users who want to build for a non-standard platform:

1. Clone skia_canvas: `git clone https://github.com/DjDeveloperr/skia_canvas.git`
2. Build Skia from source with `SKIA_FROM_SOURCE=1 deno run -A scripts/build_skia.ts`
   (or use the Docker approach above adapted for their platform)
3. Build native_canvas: `cd native && mkdir build && cd build && cmake .. && make`
4. Set `DENO_SKIA_PATH=/path/to/directory/containing/libnative_canvas.so`
