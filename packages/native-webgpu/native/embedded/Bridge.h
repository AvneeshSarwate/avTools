#pragma once
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
// All caller pointers are borrowed only for the synchronous call. No C++ ABI crosses this boundary.
typedef struct AVSketch AVSketch;
typedef struct {const char* name; const float* samples; uint32_t count;} AVChannel;
typedef struct {const uint8_t* pixels; uint32_t width,height; size_t size;} AVImage;
typedef struct {
  const char* source;
  uint32_t width,height,reset;
  const char* syphonName; uint32_t syphonOnly;
  const char* const* pulses; uint32_t pulseCount;
  double frame,rate,deltaSeconds,absFrame,sampleRate,startIndex;
  const AVChannel* channels; uint32_t channelCount;
  const AVImage* images; uint32_t imageCount;
  uint8_t* output; size_t outputSize;
} AVFrame;
typedef struct {double inputMs,drawMs,readbackMs,totalMs; uint64_t cooks; uint32_t ready,syphonClients,syphonPublished,syphonDropped;} AVStats;
__attribute__((visibility("default"))) AVSketch* avCreate(const char* resources,char* error,size_t errorSize);
__attribute__((visibility("default"))) int avCook(AVSketch*,const AVFrame*,AVStats*,char* error,size_t errorSize);
// Deferred creation does no GPU/V8 initialization on the caller. Dispatch runs on
// a persistent preparation worker (TD input fences may block). avCook submits
// to the separate V8 owner, which continues servicing timers. User data must
// survive through callback completion. avDestroy joins any active callback.
__attribute__((visibility("default"))) AVSketch* avCreateDeferred(const char*,char*,size_t);
typedef void (*AVWork)(AVSketch*,void*);
__attribute__((visibility("default"))) int avDispatch(AVSketch*,AVWork,void*);
__attribute__((visibility("default"))) void avDestroy(AVSketch*);
// CPU channel host. Each call publishes all input snapshots atomically and
// returns this cook's outputs; it never queues a previous-frame result.
typedef struct {uint32_t input; AVChannel channel;} AVChopChannel;
typedef struct {
  const char* source; uint32_t reset;
  double frame,rate,deltaSeconds,absFrame;
  const AVChopChannel* channels; uint32_t channelCount;
  const char* const* names; uint32_t outputCount; float* output;
  const char* const* pulses; uint32_t pulseCount;
  // Channel-major output buffer: outputCount * outputSamples floats.
  // Zero outputSamples means one for scalar callers.
  uint32_t outputSamples;
} AVChopFrame;
__attribute__((visibility("default"))) AVSketch* avChopCreate(const char*,char*,size_t);
__attribute__((visibility("default"))) int avChopCook(AVSketch*,const AVChopFrame*,AVStats*,char*,size_t);
#ifdef __cplusplus
}
#endif
