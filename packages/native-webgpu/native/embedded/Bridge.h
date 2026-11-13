#pragma once
#include <stddef.h>
#include <stdint.h>
// macOS: exported from the private runtime dylib. Windows: linked into the one
// operator DLL, so these stay internal (DLLs export nothing by default).
#ifdef _WIN32
#define AV_API
#else
#define AV_API __attribute__((visibility("default")))
#endif
#ifdef __cplusplus
extern "C" {
#endif
// All caller pointers are borrowed only for the synchronous call. No C++ ABI crosses this boundary.
typedef struct AVSketch AVSketch;
// MIDI selection control updates coalesce independently of frame submissions.
AV_API void avMidiSelections(AVSketch*,const char* json);
AV_API uint32_t avMidiInputs(char* output,uint32_t capacity);
// Logging handles own bounded history independently of V8 and may outlive a sketch.
// Levels: Debug=0, Info/log=1, Warning=2, Error=3, Off=4.
typedef struct AVLog AVLog;
typedef struct {uint64_t sequence,generation;double timeMs;int32_t level;char message[4097];} AVLogEntry;
typedef struct {uint32_t count;uint64_t evicted,dropped,truncated;AVLogEntry entries[256];} AVLogSnapshot;
AV_API AVLog* avLogCreate(void);
AV_API void avLogDestroy(AVLog*);
AV_API void avLogLevel(AVLog*,int32_t);
AV_API void avLogClear(AVLog*);
AV_API void avLogRead(AVLog*,AVLogSnapshot*);
// Counters only; does not copy message rows.
AV_API void avLogStats(AVLog*,AVLogSnapshot*);
// Attach before the first frame. Attach/replacement synchronizes once with the worker.
AV_API void avLogAttach(AVSketch*,AVLog*);

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
  const char* parametersJSON; // Owned accepted snapshot, or null for no declarations.
  const char* baseDirectory; // Script entry directory; null means process cwd for native callers.
} AVFrame;
typedef struct {double inputMs,drawMs,readbackMs,totalMs; uint64_t cooks; uint32_t ready,syphonClients,syphonPublished,syphonDropped;} AVStats;
AV_API AVSketch* avCreate(const char* resources,char* error,size_t errorSize);
AV_API int avCook(AVSketch*,const AVFrame*,AVStats*,char* error,size_t errorSize);
// Deferred creation does no GPU/V8 initialization on the caller. Dispatch runs on
// a persistent preparation worker (TD input fences may block). avCook submits
// to the separate V8 owner, which continues servicing timers. User data must
// survive through callback completion. avDestroy joins any active callback.
AV_API AVSketch* avCreateDeferred(const char*,char*,size_t);
typedef void (*AVWork)(AVSketch*,void*);
AV_API int avDispatch(AVSketch*,AVWork,void*);
AV_API void avDestroy(AVSketch*);
// CPU channel host. avChopCook preserves the synchronous compatibility API.
// avChopExecute copies all borrowed inputs before returning in either mode.
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
  const char* parametersJSON;
  const char* baseDirectory;
} AVChopFrame;
typedef struct {
  uint64_t submitted,accepted,completed,published,consumed,sourceRequest,generation,schema;
  uint64_t reused,sameRequest,coalesced,pulseOverflows;
  uint32_t blocking,busy,ready,pulseDepth;
  double sourceFrame,publicationAgeMs,inputAgeMs,inputCopyMs,outputCopyMs,waitMs,workerMs,repeatedPercent;
} AVChopDiagnostics;
AV_API int avChopExecute(AVSketch*,const AVChopFrame*,uint32_t waitForCurrent,AVStats*,AVChopDiagnostics*,char*,size_t);
// Collect timer publications without submitting a frame tick. Caller supplies
// the current schema's exact output capacity; no worker wait.
AV_API int avChopCollect(AVSketch*,float*,size_t,AVStats*,AVChopDiagnostics*,char*,size_t);
AV_API AVSketch* avChopCreate(const char*,char*,size_t);
AV_API int avChopCook(AVSketch*,const AVChopFrame*,AVStats*,char*,size_t);
#ifdef __cplusplus
}
#endif
