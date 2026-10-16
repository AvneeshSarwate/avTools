#pragma once
#include <memory>
#include <string>
#include <thread>
#include <v8.h>
#include "HostLoop.h"
#include "src/dawn/node/napi_v8/napi_v8.h"

namespace avtools {
// One owner thread per isolate. No Node runtime or process-level exit API.
class Runtime {
 public:
  explicit Runtime(std::shared_ptr<Wake> wake = std::make_shared<Wake>());
  ~Runtime();
  Runtime(const Runtime&) = delete;
  Runtime& operator=(const Runtime&) = delete;
  bool evaluate(const std::string& source, int budgetMs = 1000);
  bool pump(int budgetMs = 1000);
  Clock::time_point deadline();
  void sleepUntil(Clock::time_point limit) { wake_->wait(std::min(limit, deadline())); }
  bool poisoned() const { return poisoned_; }
  size_t taskCount() const;
  bool call(const char* name, int budgetMs = 1000);
  std::string value(const char* name);
  void collect();
  bool setString(const char* name, const std::string& value);
  bool setBytes(const char* name, const void* data, size_t size);
  bool copyRows(const char* name, void* destination, size_t capacity, size_t rowBytes, size_t stride, size_t height);
  size_t metadataCount() const { return env_->references.size() + env_->callback_bindings.size(); }
  const std::string& error() const { return error_; }
 private:
  struct State;
  std::unique_ptr<State> state_;
  std::unique_ptr<Watchdog> watchdog_;
  std::shared_ptr<Wake> wake_;
  std::shared_ptr<Foreground> foreground_;
  bool poisoned_ = false;
  bool finish(v8::TryCatch&);
  void owner() const;
  bool caught(v8::TryCatch& catcher);
  std::thread::id owner_ = std::this_thread::get_id();
  std::unique_ptr<v8::ArrayBuffer::Allocator> allocator_;
  v8::Isolate* isolate_ = nullptr;
  v8::Global<v8::Context> context_;
  napi_env env_ = nullptr;
  std::string error_;
};
}
