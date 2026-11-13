#pragma once
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>

namespace avtools {
struct WebSocketEvent {
  uint64_t id = 0, generation = 0;
  std::string kind, text;
  std::vector<uint8_t> bytes;
  int code = 0;
};
// Platform transport boundary: no V8 values or TD objects enter OS callbacks.
class WebSockets {
 public:
  struct State;
  explicit WebSockets(std::function<void()> wake);
  ~WebSockets();
  void open(uint64_t id, uint64_t generation, const std::string& url);
  void send(uint64_t request, uint64_t generation, uint64_t socket,
            const std::vector<uint8_t>& bytes, bool text);
  void close(uint64_t socket, int code, const std::string& reason);
  void cancel(uint64_t generation);
  bool take(WebSocketEvent& event);
  bool pending();
 private:
  std::shared_ptr<State> state_;
};
}
