#pragma once
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <vector>
namespace avtools {
// No V8 objects cross this boundary. Libuv sleeps on OS events; the existing
// isolate owner is notified only when a completion or datagram is available.
struct IOEvent {
  uint64_t id=0,generation=0;
  std::string kind,error,address;
  int port=0;
  std::vector<uint8_t> bytes;
};
class IO {
 public:
  explicit IO(std::function<void()> wake);
  ~IO();
  void read(uint64_t id,uint64_t generation,std::string path);
  void open(uint64_t id,uint64_t generation,std::string address,int port);
  void send(uint64_t id,uint64_t generation,uint64_t socket,std::string address,int port,std::vector<uint8_t> bytes);
  void close(uint64_t socket);
  void cancel(uint64_t generation);
  bool take(IOEvent& event);
  bool pending();
  uint64_t dropped();
 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};
}
