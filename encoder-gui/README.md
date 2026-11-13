# HAP Encoder GUI

An egui-based desktop frontend that drives `ffmpeg` to encode source video
into HAP / HAP-Q `.mov` files and then re-packages them into the project's
`.happack` container.

## Run in development

```sh
cd encoder-gui
cargo run --release
```

Requires `ffmpeg` and `ffprobe` on `PATH`. Override with the
`HAP_ENCODER_FFMPEG` / `HAP_ENCODER_FFPROBE` env vars if you want to point
at specific binaries. The sidecar lookup is in
`src/platform/bundled_ffmpeg.rs`.

## Build a self-contained macOS `.app`

The bundle includes `ffmpeg`, `ffprobe`, and every non-system dylib they
transitively link against, so end users don't need Homebrew or anything
else installed.

```sh
cd encoder-gui
cargo install cargo-bundle              # one-time
bundle/macos/build-app.sh
```

Output: `target/release/bundle/osx/HAP Encoder.app` (~87 MB). Double-click
to launch.

### What the build script does

1. **`bundle/macos/stage-ffmpeg.sh`** — resolves `which ffmpeg` and
   `which ffprobe`, then recursively walks their dependency chain via
   `otool -L`. For each non-system reference it:
   - Resolves `@rpath/...` entries by reading the referrer's `LC_RPATH`
     load commands (Homebrew dylibs reference each other this way).
   - Copies the real file into `bundle/macos/staging/`.
   - Rewrites every install name to `@loader_path/<basename>` so the
     bundle is relocatable.
   - Strips Homebrew's ad-hoc signature, then re-signs with
     `codesign --sign -`. **Required**: the Apple Silicon kernel
     SIGKILLs any binary without a valid signature.
   - A few Homebrew dylibs (e.g. `libSDL2`) have a `__LINKEDIT` layout
     that `install_name_tool` refuses to rewrite; the script falls back
     to `strip -x` and retries. Most of these are optional ffmpeg
     features the encode path never touches.

2. **`cargo bundle --release`** — generates `HAP Encoder.app` from the
   `[package.metadata.bundle]` block in `Cargo.toml`. It preserves source
   paths, so staged files land at `Resources/bundle/macos/staging/`.

3. **Flatten step** — moves everything up to `Contents/Resources/` where
   the runtime's `sidecar_candidates` lookup expects them
   (`MacOS/../Resources/ffmpeg`).

The staging directory (`bundle/macos/staging/`) is git-ignored — it's
re-generated from the host's Homebrew install on every build.

## Distributing the `.app` (Developer ID code signing)

The ad-hoc signing above is enough for local use, but Gatekeeper will
flag a downloaded `.app` as "from an unidentified developer" or refuse
to open it entirely (quarantine bit). For real distribution you need a
**Developer ID Application** certificate, which requires an
[Apple Developer Program](https://developer.apple.com/developer-id/)
membership ($99/year). Notarization is included free with the
membership.

The pipeline once you have a cert:

```sh
codesign --deep --force --options runtime \
  --sign "Developer ID Application: Your Name (TEAMID)" \
  --entitlements bundle/macos/entitlements.plist \
  "target/release/bundle/osx/HAP Encoder.app"

ditto -c -k --keepParent "target/release/bundle/osx/HAP Encoder.app" HAPEncoder.zip
xcrun notarytool submit HAPEncoder.zip \
  --apple-id you@example.com --team-id TEAMID --password APP_PASSWORD --wait

xcrun stapler staple "target/release/bundle/osx/HAP Encoder.app"
```

Notes for bundled ffmpeg under hardened runtime:

- An `entitlements.plist` is needed enabling
  `com.apple.security.cs.allow-unsigned-executable-memory` and
  `com.apple.security.cs.disable-library-validation` so the embedded
  ffmpeg can dlopen its dylibs.
- `--deep` re-signs every binary inside the bundle, including the
  sidecar ffmpeg/ffprobe and all 90+ dylibs.

To bypass Gatekeeper warnings on an unsigned bundle (yourself or
trusted users):

```sh
xattr -dr com.apple.quarantine "HAP Encoder.app"
```

## Layout

```
encoder-gui/
├─ Cargo.toml                       # [package.metadata.bundle] config
├─ src/
│  ├─ app.rs                        # egui app
│  ├─ platform/bundled_ffmpeg.rs    # sidecar lookup (env / next-to-binary / Resources/ / PATH)
│  ├─ encode/ffmpeg.rs              # ffmpeg invocation
│  └─ happack/                      # HAP container writer
└─ bundle/macos/
   ├─ stage-ffmpeg.sh               # walks dylib chain, fixes install names, re-signs
   ├─ build-app.sh                  # stage + cargo bundle + flatten
   └─ staging/                      # generated, git-ignored
```
