// Windows: no Syphon (macOS-only). Runtime.cpp registers optional platform
// texture-sharing classes through this hook; registering nothing makes
// `nativeGPU.NativeSyphon` undefined, and td-runtime.ts only constructs it when a
// Syphon name is set. A future Spout publisher can register here instead.
#include <napi.h>

void InitializeSyphon(Napi::Env, Napi::Object) {}
