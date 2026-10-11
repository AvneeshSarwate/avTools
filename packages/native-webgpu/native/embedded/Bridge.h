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
__attribute__((visibility("default"))) void avDestroy(AVSketch*);
#ifdef __cplusplus
}
#endif
