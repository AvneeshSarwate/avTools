# syphon_bridge

Rust `cdylib` used by Deno FFI to publish WebGPU frames to Syphon on macOS.

## Build

```bash
cargo build --release --manifest-path apps/deno-notebooks/native/syphon_bridge/Cargo.toml
```

Output:
- `apps/deno-notebooks/native/syphon_bridge/target/release/libsyphon_bridge.dylib`

## Syphon.framework lookup order

1. Explicit `frameworkPath` passed through FFI
2. `<dylib_dir>/frameworks/Syphon.framework`
3. `<repo_root>/apps/deno-notebooks/native/syphon_bridge/frameworks/Syphon.framework`
4. `~/Library/Frameworks/Syphon.framework`
5. `/Library/Frameworks/Syphon.framework`

## Notes

- Full runtime publishing tests require `Syphon.framework` to be available in one of the locations above.
- This crate installs an intercepting `CAMetalLayer` subclass and uses `SyphonMetalServer` for publication.
