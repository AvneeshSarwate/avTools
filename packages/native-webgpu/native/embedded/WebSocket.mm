#import <Foundation/Foundation.h>
#include "WebSocket.h"
#include <deque>
#include <map>
#include <mutex>
#include <stdexcept>

namespace avtools {
constexpr size_t kMessageLimit = 8 * 1024 * 1024;
constexpr size_t kQueueLimit = 16 * 1024 * 1024;
struct WebSocketConnection {
  uint64_t id, generation;
  NSURLSession* session = nil;
  NSURLSessionWebSocketTask* task = nil;
  bool opened = false;
  ~WebSocketConnection() {
    [task cancel];
    [session invalidateAndCancel];
    [task release];
    [session release];
  }
};
struct WebSockets::State : std::enable_shared_from_this<State> {
  std::mutex mutex;
  bool alive = true;
  std::function<void()> wake;
  std::map<uint64_t, std::shared_ptr<WebSocketConnection>> connections;
  std::deque<WebSocketEvent> events;
  size_t receivedBytes = 0, receivedCount = 0, sendBytes = 0, sendCount = 0;
  explicit State(std::function<void()> notify) : wake(std::move(notify)) {}
  // Every method below is called while holding mutex. Wake has no V8 access.
  void emit(WebSocketEvent event) {
    if (!alive) return;
    if (event.kind == "text" || event.kind == "binary") {
      receivedBytes += event.bytes.size();
      ++receivedCount;
    }
    events.push_back(std::move(event));
    wake();
  }
  void end(uint64_t id, const std::string& error, int code, const std::string& reason) {
    auto found = connections.find(id);
    if (found == connections.end()) return;
    auto connection = found->second;
    if (!error.empty()) emit({id, connection->generation, "error", error});
    emit({id, connection->generation, "close", reason, {}, code});
    connections.erase(found);
  }
  void receive(uint64_t id) {
    auto found = connections.find(id);
    if (found == connections.end()) return;
    auto weak = weak_from_this();
    auto task = found->second->task;
    [task receiveMessageWithCompletionHandler:^(NSURLSessionWebSocketMessage* message, NSError* error) {
      auto state = weak.lock();
      if (!state) return;
      std::lock_guard lock(state->mutex);
      auto found = state->connections.find(id);
      if (!state->alive || found == state->connections.end() || found->second->task != task) return;
      if (error) {
        auto task = found->second->task;
        int code = int(task.closeCode);
        NSString* reason = [[[NSString alloc] initWithData:task.closeReason encoding:NSUTF8StringEncoding] autorelease];
        state->end(id, code > 0 ? "" : error.localizedDescription.UTF8String,
                   code > 0 ? code : 1006, reason ? reason.UTF8String : "");
        return;
      }
      NSData* data = message.type == NSURLSessionWebSocketMessageTypeString
        ? [message.string dataUsingEncoding:NSUTF8StringEncoding] : message.data;
      if (state->receivedCount >= 256 || state->receivedBytes + data.length > kQueueLimit) {
        state->end(id, "WebSocket receive queue exceeded 256 messages / 16 MiB", 1009, "Receive queue full");
        return;
      }
      WebSocketEvent event{id, found->second->generation,
        message.type == NSURLSessionWebSocketMessageTypeString ? "text" : "binary"};
      if (data.length) {
        auto* begin = static_cast<const uint8_t*>(data.bytes);
        event.bytes.assign(begin, begin + data.length);
      }
      state->emit(std::move(event));
      state->receive(id);
    }];
  }
};
}

@interface AVToolsWebSocketDelegate : NSObject <NSURLSessionWebSocketDelegate> {
 @public
  std::weak_ptr<avtools::WebSockets::State> state;
  uint64_t socketId;
}
@end
@implementation AVToolsWebSocketDelegate
- (void)URLSession:(NSURLSession*)session webSocketTask:(NSURLSessionWebSocketTask*)task didOpenWithProtocol:(NSString*)protocol {
  auto owner = state.lock();
  if (!owner) return;
  std::lock_guard lock(owner->mutex);
  auto found = owner->connections.find(socketId);
  if (!owner->alive || found == owner->connections.end() || found->second->task != task) return;
  found->second->opened = true;
  owner->emit({socketId, found->second->generation, "open"});
  owner->receive(socketId);
}
- (void)URLSession:(NSURLSession*)session webSocketTask:(NSURLSessionWebSocketTask*)task didCloseWithCode:(NSURLSessionWebSocketCloseCode)code reason:(NSData*)reason {
  auto owner = state.lock();
  if (!owner) return;
  std::lock_guard lock(owner->mutex);
  auto found = owner->connections.find(socketId);
  if (found == owner->connections.end() || found->second->task != task) return;
  NSString* text = [[[NSString alloc] initWithData:reason encoding:NSUTF8StringEncoding] autorelease];
  owner->end(socketId, "", int(code), text ? text.UTF8String : "");
}
- (void)URLSession:(NSURLSession*)session task:(NSURLSessionTask*)task didCompleteWithError:(NSError*)error {
  auto owner = state.lock();
  if (!owner) return;
  std::lock_guard lock(owner->mutex);
  auto found = owner->connections.find(socketId);
  if (found == owner->connections.end() || found->second->task != task) return;
  owner->end(socketId, error ? error.localizedDescription.UTF8String : "", 1006, "Connection ended");
}
// A redirect must not silently change the destination requested by the sketch.
- (void)URLSession:(NSURLSession*)session task:(NSURLSessionTask*)task willPerformHTTPRedirection:(NSHTTPURLResponse*)response newRequest:(NSURLRequest*)request completionHandler:(void (^)(NSURLRequest*))completionHandler {
  completionHandler(nil);
}
@end

namespace avtools {
WebSockets::WebSockets(std::function<void()> wake) : state_(std::make_shared<State>(std::move(wake))) {}
WebSockets::~WebSockets() {
  std::map<uint64_t, std::shared_ptr<WebSocketConnection>> retired;
  {
    std::lock_guard lock(state_->mutex);
    state_->alive = false;
    state_->wake = {};
    retired.swap(state_->connections);
    state_->events.clear();
  }
  // Delegates and completion blocks hold weak state references. Teardown never
  // waits on the main thread and no callback can wake a destroyed runtime.
}
void WebSockets::open(uint64_t id, uint64_t generation, const std::string& url) {
  @autoreleasepool {
    std::lock_guard lock(state_->mutex);
    if (state_->events.size() >= 1024) throw std::runtime_error("WebSocket pending event limit (1024)");
    if (state_->connections.size() >= 16) throw std::runtime_error("WebSocket connection limit (16)");
    NSURL* target = [NSURL URLWithString:[NSString stringWithUTF8String:url.c_str()]];
    if (!target || !target.host.length ||
        !([target.scheme isEqualToString:@"ws"] || [target.scheme isEqualToString:@"wss"]) ||
        target.user || target.password || target.fragment || url.find('\0') != std::string::npos)
      throw std::runtime_error("Expected ws:// or wss:// URL without credentials or fragment");
    if (state_->connections.count(id)) throw std::runtime_error("Duplicate WebSocket id");
    auto connection = std::make_shared<WebSocketConnection>();
    connection->id = id;
    connection->generation = generation;
    auto delegate = [[AVToolsWebSocketDelegate alloc] init];
    delegate->state = state_;
    delegate->socketId = id;
    auto config = [NSURLSessionConfiguration ephemeralSessionConfiguration];
    config.HTTPCookieStorage = nil;
    config.URLCredentialStorage = nil;
    config.URLCache = nil;
    config.timeoutIntervalForRequest = 15;
    connection->session = [[NSURLSession sessionWithConfiguration:config delegate:delegate delegateQueue:nil] retain];
    [delegate release];
    connection->task = [[connection->session webSocketTaskWithURL:target] retain];
    connection->task.maximumMessageSize = kMessageLimit;
    state_->connections.emplace(id, connection);
    [connection->task resume];
  }
}
void WebSockets::send(uint64_t request, uint64_t generation, uint64_t socket,
                      const std::vector<uint8_t>& bytes, bool text) {
  @autoreleasepool {
    std::lock_guard lock(state_->mutex);
    auto found = state_->connections.find(socket);
    if (found == state_->connections.end() || found->second->generation != generation || !found->second->opened)
      throw std::runtime_error("WebSocket is not open");
    if (bytes.size() > kMessageLimit || state_->sendCount >= 64 || state_->sendBytes + bytes.size() > kQueueLimit)
      throw std::runtime_error("WebSocket send limit (8 MiB/message, 64 pending / 16 MiB)");
    NSData* data = [NSData dataWithBytes:bytes.data() length:bytes.size()];
    NSURLSessionWebSocketMessage* message;
    if (text) {
      NSString* value = [[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] autorelease];
      if (!value) throw std::runtime_error("Invalid WebSocket UTF-8");
      message = [[NSURLSessionWebSocketMessage alloc] initWithString:value];
    } else message = [[NSURLSessionWebSocketMessage alloc] initWithData:data];
    ++state_->sendCount;
    state_->sendBytes += bytes.size();
    auto weak = std::weak_ptr<State>(state_);
    size_t size = bytes.size();
    [found->second->task sendMessage:message completionHandler:^(NSError* error) {
      auto state = weak.lock();
      if (!state) return;
      std::lock_guard lock(state->mutex);
      --state->sendCount;
      state->sendBytes -= size;
      // A closed/reloaded connection has already rejected its pending promises.
      auto connection = state->connections.find(socket);
      if (!state->alive || connection == state->connections.end() || connection->second->generation != generation) return;
      state->emit({request, generation, "sent", error ? error.localizedDescription.UTF8String : ""});
    }];
    [message release];
  }
}
void WebSockets::close(uint64_t socket, int code, const std::string& reason) {
  @autoreleasepool {
    std::lock_guard lock(state_->mutex);
    auto found = state_->connections.find(socket);
    if (found == state_->connections.end()) return;
    [found->second->task cancelWithCloseCode:static_cast<NSURLSessionWebSocketCloseCode>(code)
      reason:[NSData dataWithBytes:reason.data() length:reason.size()]];
    state_->end(socket, "", code, reason);
  }
}
void WebSockets::cancel(uint64_t generation) {
  std::lock_guard lock(state_->mutex);
  for (auto it = state_->connections.begin(); it != state_->connections.end();) {
    if (it->second->generation == generation) it = state_->connections.erase(it);
    else ++it;
  }
  for (auto it = state_->events.begin(); it != state_->events.end();) {
    if (it->generation != generation) { ++it; continue; }
    if (it->kind == "text" || it->kind == "binary") {
      --state_->receivedCount;
      state_->receivedBytes -= it->bytes.size();
    }
    it = state_->events.erase(it);
  }
}
bool WebSockets::take(WebSocketEvent& event) {
  std::lock_guard lock(state_->mutex);
  if (state_->events.empty()) return false;
  event = std::move(state_->events.front());
  state_->events.pop_front();
  if (event.kind == "text" || event.kind == "binary") {
    --state_->receivedCount;
    state_->receivedBytes -= event.bytes.size();
  }
  return true;
}
bool WebSockets::pending() {
  std::lock_guard lock(state_->mutex);
  return !state_->events.empty();
}
}
