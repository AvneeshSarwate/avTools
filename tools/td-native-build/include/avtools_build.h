#pragma once
#include <stddef.h>
#ifdef __cplusplus
extern "C" {
#endif
// All strings are UTF-8. A subscription owns its watcher and a shared serialized
// build service. Destroy waits for the final outstanding build when it is the last
// subscription. Calls on a given handle must be serialized by the caller.
// The library must remain loaded until every subscription is destroyed.
int avb_init(const char* directory, char* error, size_t capacity);
void* avb_subscribe_file(const char* typescript_file, const char* target, int automatic);
// Legacy manifest-based interface.
void* avb_subscribe(const char* project_directory, const char* entry, int automatic);
// 1: new status/source, 0: unchanged, -1: API failure. Does not wait for compilation.
int avb_poll(void* subscription);
// Borrowed strings, valid until next poll or destroy. Source is last successful
// bundle; remains available during builds and user-source errors.
const char* avb_source(const void* subscription);
const char* avb_status(const void* subscription);
const char* avb_message(const void* subscription);
void avb_request(const void* subscription);
void avb_destroy(void* subscription);
#ifdef __cplusplus
}
#endif
#ifdef __cplusplus
extern "C" {
#endif
// File watcher uses the same ownership/poll rules. Deletion/read errors retain
// the last complete source and report an error until the file reappears.
void* avb_file_create(const char* path);
int avb_file_poll(void* watcher);
const char* avb_file_source(const void* watcher);
const char* avb_file_error(const void* watcher);
void avb_file_destroy(void* watcher);
#ifdef __cplusplus
}
#endif
