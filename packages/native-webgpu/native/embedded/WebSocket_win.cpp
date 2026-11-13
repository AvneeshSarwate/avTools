// Windows WebSocket transport (WinHTTP). Same contract as WebSocket.mm:
// events open/text/binary/sent/error/close, 16 connections, 8 MiB messages,
// 256 messages / 16 MiB receive queue, 64 pending / 16 MiB sends, redirects
// refused, generation cancellation, and teardown never blocks the caller.
// WinHTTP ships with Windows: no extra DLL in the distribution.
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <winhttp.h>
#include "WebSocket.h"
#include <atomic>
#include <condition_variable>
#include <deque>
#include <map>
#include <mutex>
#include <stdexcept>
#include <thread>
#pragma comment(lib, "winhttp.lib")

namespace avtools {
namespace {
constexpr size_t kMessageLimit = 8 * 1024 * 1024;
constexpr size_t kQueueLimit = 16 * 1024 * 1024;

std::wstring wide(const std::string& s) {
  if (s.empty()) return {};
  int n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), int(s.size()), nullptr, 0);
  if (n <= 0) throw std::runtime_error("Invalid UTF-8");
  std::wstring out(n, L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), int(s.size()), out.data(), n);
  return out;
}
bool validUtf8(const std::vector<uint8_t>& bytes) {
  return bytes.empty() || MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, reinterpret_cast<const char*>(bytes.data()),
                                              int(bytes.size()), nullptr, 0) > 0;
}
std::string describe(DWORD code) {
  wchar_t* text = nullptr;
  DWORD n = FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_HMODULE | FORMAT_MESSAGE_FROM_SYSTEM |
                               FORMAT_MESSAGE_IGNORE_INSERTS,
                           GetModuleHandleW(L"winhttp.dll"), code, 0, reinterpret_cast<LPWSTR>(&text), 0, nullptr);
  std::string out;
  if (n && text) {
    int m = WideCharToMultiByte(CP_UTF8, 0, text, int(n), nullptr, 0, nullptr, nullptr);
    out.resize(m);
    WideCharToMultiByte(CP_UTF8, 0, text, int(n), out.data(), m, nullptr, nullptr);
    while (!out.empty() && (out.back() == '\n' || out.back() == '\r' || out.back() == ' ')) out.pop_back();
  }
  if (text) LocalFree(text);
  return out.empty() ? "WinHTTP error " + std::to_string(code) : out;
}

struct Target {
  std::wstring host, path;
  INTERNET_PORT port = 0;
  bool secure = false;
};
Target parse(const std::string& url) {
  const char* fail = "Expected ws:// or wss:// URL without credentials or fragment";
  if (url.find('\0') != std::string::npos || url.find('#') != std::string::npos) throw std::runtime_error(fail);
  std::string http;
  if (url.rfind("ws://", 0) == 0) http = "http://" + url.substr(5);
  else if (url.rfind("wss://", 0) == 0) http = "https://" + url.substr(6);
  else throw std::runtime_error(fail);
  std::wstring w = wide(http);
  URL_COMPONENTS c{};
  c.dwStructSize = sizeof(c);
  c.dwSchemeLength = c.dwHostNameLength = c.dwUserNameLength = c.dwPasswordLength = c.dwUrlPathLength =
      c.dwExtraInfoLength = DWORD(-1);
  if (!WinHttpCrackUrl(w.c_str(), DWORD(w.size()), 0, &c) || !c.dwHostNameLength || c.dwUserNameLength ||
      c.dwPasswordLength)
    throw std::runtime_error(fail);
  Target t;
  t.host.assign(c.lpszHostName, c.dwHostNameLength);
  t.path.assign(c.lpszUrlPath, c.dwUrlPathLength);
  if (c.dwExtraInfoLength) t.path.append(c.lpszExtraInfo, c.dwExtraInfoLength);
  if (t.path.empty()) t.path = L"/";
  t.port = c.nPort;
  t.secure = c.nScheme == INTERNET_SCHEME_HTTPS;
  return t;
}

struct Outgoing {
  uint64_t request = 0;
  std::vector<uint8_t> bytes;
  bool text = false;
  bool close = false;
  int code = 1000;
  std::string reason;
};
}  // namespace

struct WebSocketConnection {
  uint64_t id = 0, generation = 0;
  Target target;
  std::mutex mutex;  // Guards handles and the outgoing queue. Never held while taking State::mutex.
  std::condition_variable wake;
  std::deque<Outgoing> outgoing;
  HINTERNET session = nullptr, connect = nullptr, request = nullptr, socket = nullptr;
  bool aborted = false;
  std::atomic<bool> opened{false};
  // Interrupt blocking WinHTTP calls on both worker threads. Idempotent.
  void abort() {
    std::lock_guard lock(mutex);
    if (aborted) return;
    aborted = true;
    for (HINTERNET* h : {&socket, &request, &connect, &session})
      if (*h) { WinHttpCloseHandle(*h); *h = nullptr; }
    wake.notify_all();
  }
  ~WebSocketConnection() { abort(); }
};

struct WebSockets::State : std::enable_shared_from_this<State> {
  std::mutex mutex;
  bool alive = true;
  std::function<void()> wake;
  std::map<uint64_t, std::shared_ptr<WebSocketConnection>> connections;
  std::deque<WebSocketEvent> events;
  size_t receivedBytes = 0, receivedCount = 0, sendBytes = 0, sendCount = 0;
  explicit State(std::function<void()> notify) : wake(std::move(notify)) {}
  // Called while holding mutex. Wake has no V8 access.
  void emit(WebSocketEvent event) {
    if (!alive) return;
    if (event.kind == "text" || event.kind == "binary") {
      receivedBytes += event.bytes.size();
      ++receivedCount;
    }
    events.push_back(std::move(event));
    if (wake) wake();
  }
  void end(uint64_t id, const std::string& error, int code, const std::string& reason) {
    auto found = connections.find(id);
    if (found == connections.end()) return;
    auto connection = found->second;
    if (!error.empty()) emit({id, connection->generation, "error", error});
    emit({id, connection->generation, "close", reason, {}, code});
    connections.erase(found);
    connection->abort();
  }
  // True if this exact connection is still current; caller holds mutex.
  bool current(const std::shared_ptr<WebSocketConnection>& c) {
    auto found = connections.find(c->id);
    return alive && found != connections.end() && found->second == c;
  }

  static void reader(std::weak_ptr<State> weak, std::shared_ptr<WebSocketConnection> c) {
    auto fail = [&](const std::string& error, int code, const std::string& reason) {
      if (auto s = weak.lock()) {
        std::lock_guard lock(s->mutex);
        if (s->current(c)) s->end(c->id, error, code, reason);
      }
    };
    HINTERNET request = nullptr;
    {
      std::lock_guard lock(c->mutex);
      if (c->aborted) return;
      c->session = WinHttpOpen(L"avTools", WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, WINHTTP_NO_PROXY_NAME,
                               WINHTTP_NO_PROXY_BYPASS, 0);
      if (c->session) {
        WinHttpSetTimeouts(c->session, 15000, 15000, 15000, 15000);
        c->connect = WinHttpConnect(c->session, c->target.host.c_str(), c->target.port, 0);
      }
      if (c->connect)
        c->request = WinHttpOpenRequest(c->connect, L"GET", c->target.path.c_str(), nullptr, WINHTTP_NO_REFERER,
                                        WINHTTP_DEFAULT_ACCEPT_TYPES, c->target.secure ? WINHTTP_FLAG_SECURE : 0);
      if (c->request) {
        DWORD never = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;  // a redirect must not change the destination
        WinHttpSetOption(c->request, WINHTTP_OPTION_REDIRECT_POLICY, &never, sizeof(never));
        DWORD noCookies = WINHTTP_DISABLE_COOKIES;
        WinHttpSetOption(c->request, WINHTTP_OPTION_DISABLE_FEATURE, &noCookies, sizeof(noCookies));
        WinHttpSetOption(c->request, WINHTTP_OPTION_UPGRADE_TO_WEB_SOCKET, nullptr, 0);
      }
      request = c->request;
    }
    if (!request) return fail(describe(GetLastError()), 1006, "Connection failed");
    if (!WinHttpSendRequest(request, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
        !WinHttpReceiveResponse(request, nullptr))
      return fail(describe(GetLastError()), 1006, "Connection failed");
    DWORD status = 0, size = sizeof(status);
    WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, WINHTTP_HEADER_NAME_BY_INDEX,
                        &status, &size, WINHTTP_NO_HEADER_INDEX);
    if (status != 101) return fail("WebSocket upgrade refused (HTTP " + std::to_string(status) + ")", 1006, "Connection failed");
    HINTERNET socket = WinHttpWebSocketCompleteUpgrade(request, 0);
    if (!socket) return fail(describe(GetLastError()), 1006, "Connection failed");
    {
      std::lock_guard lock(c->mutex);
      if (c->aborted) { WinHttpCloseHandle(socket); return; }
      c->socket = socket;
      WinHttpCloseHandle(c->request);
      c->request = nullptr;
    }
    {
      auto s = weak.lock();
      if (!s) return;
      std::lock_guard lock(s->mutex);
      if (!s->current(c)) return;
      c->opened = true;
      s->emit({c->id, c->generation, "open"});
    }
    std::thread([weak, c] { sender(weak, c); }).detach();

    std::vector<uint8_t> message, chunk(64 * 1024);
    for (;;) {
      DWORD read = 0;
      WINHTTP_WEB_SOCKET_BUFFER_TYPE type{};
      DWORD error = WinHttpWebSocketReceive(socket, chunk.data(), DWORD(chunk.size()), &read, &type);
      if (error != NO_ERROR) {
        bool aborted;
        { std::lock_guard lock(c->mutex); aborted = c->aborted; }
        if (!aborted) fail(describe(error), 1006, "Connection ended");
        return;
      }
      if (type == WINHTTP_WEB_SOCKET_CLOSE_BUFFER_TYPE) {
        USHORT code = 1005;
        char reason[WINHTTP_WEB_SOCKET_MAX_CLOSE_REASON_LENGTH] = {};
        DWORD reasonLength = 0;
        WinHttpWebSocketQueryCloseStatus(socket, &code, reason, sizeof(reason), &reasonLength);
        return fail("", code, std::string(reason, reasonLength));
      }
      if (message.size() + read > kMessageLimit) return fail("WebSocket message exceeds 8 MiB", 1009, "Message too big");
      message.insert(message.end(), chunk.begin(), chunk.begin() + read);
      bool text = type == WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE;
      if (type == WINHTTP_WEB_SOCKET_UTF8_FRAGMENT_BUFFER_TYPE || type == WINHTTP_WEB_SOCKET_BINARY_FRAGMENT_BUFFER_TYPE)
        continue;
      auto s = weak.lock();
      if (!s) return;
      std::lock_guard lock(s->mutex);
      if (!s->current(c)) return;
      if (s->receivedCount >= 256 || s->receivedBytes + message.size() > kQueueLimit) {
        s->end(c->id, "WebSocket receive queue exceeded 256 messages / 16 MiB", 1009, "Receive queue full");
        return;
      }
      WebSocketEvent event{c->id, c->generation, text ? "text" : "binary"};
      event.bytes.swap(message);
      s->emit(std::move(event));
      message.clear();
    }
  }

  static void sender(std::weak_ptr<State> weak, std::shared_ptr<WebSocketConnection> c) {
    for (;;) {
      Outgoing item;
      HINTERNET socket = nullptr;
      {
        std::unique_lock lock(c->mutex);
        c->wake.wait(lock, [&] { return c->aborted || !c->outgoing.empty(); });
        if (c->outgoing.empty()) return;
        item = std::move(c->outgoing.front());
        c->outgoing.pop_front();
        socket = c->aborted ? nullptr : c->socket;
      }
      if (item.close) {
        // Best effort close frame; State::end already reported the close locally.
        if (socket) WinHttpWebSocketShutdown(socket, USHORT(item.code), item.reason.empty() ? nullptr : item.reason.data(),
                                             DWORD(std::min<size_t>(item.reason.size(), WINHTTP_WEB_SOCKET_MAX_CLOSE_REASON_LENGTH)));
        c->abort();
        return;
      }
      DWORD error = socket ? WinHttpWebSocketSend(socket,
                                                  item.text ? WINHTTP_WEB_SOCKET_UTF8_MESSAGE_BUFFER_TYPE
                                                            : WINHTTP_WEB_SOCKET_BINARY_MESSAGE_BUFFER_TYPE,
                                                  item.bytes.empty() ? nullptr : item.bytes.data(), DWORD(item.bytes.size()))
                           : ERROR_WINHTTP_OPERATION_CANCELLED;
      auto s = weak.lock();
      if (!s) return;
      std::lock_guard lock(s->mutex);
      --s->sendCount;
      s->sendBytes -= item.bytes.size();
      // A closed/reloaded connection has already rejected its pending promises.
      if (!s->current(c)) continue;
      s->emit({item.request, c->generation, "sent", error == NO_ERROR ? "" : describe(error)});
    }
  }
};

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
  // Worker threads hold weak state references; aborting closes their handles so
  // they exit on their own. Teardown never joins or waits on the network.
  for (auto& [id, connection] : retired) connection->abort();
}
void WebSockets::open(uint64_t id, uint64_t generation, const std::string& url) {
  std::lock_guard lock(state_->mutex);
  if (state_->events.size() >= 1024) throw std::runtime_error("WebSocket pending event limit (1024)");
  if (state_->connections.size() >= 16) throw std::runtime_error("WebSocket connection limit (16)");
  if (state_->connections.count(id)) throw std::runtime_error("Duplicate WebSocket id");
  auto connection = std::make_shared<WebSocketConnection>();
  connection->id = id;
  connection->generation = generation;
  connection->target = parse(url);
  state_->connections.emplace(id, connection);
  std::weak_ptr<State> weak = state_;
  std::thread([weak, connection] { State::reader(weak, connection); }).detach();
}
void WebSockets::send(uint64_t request, uint64_t generation, uint64_t socket, const std::vector<uint8_t>& bytes,
                      bool text) {
  std::lock_guard lock(state_->mutex);
  auto found = state_->connections.find(socket);
  if (found == state_->connections.end() || found->second->generation != generation || !found->second->opened)
    throw std::runtime_error("WebSocket is not open");
  if (bytes.size() > kMessageLimit || state_->sendCount >= 64 || state_->sendBytes + bytes.size() > kQueueLimit)
    throw std::runtime_error("WebSocket send limit (8 MiB/message, 64 pending / 16 MiB)");
  if (text && !validUtf8(bytes)) throw std::runtime_error("Invalid WebSocket UTF-8");
  ++state_->sendCount;
  state_->sendBytes += bytes.size();
  auto& c = found->second;
  std::lock_guard connectionLock(c->mutex);
  c->outgoing.push_back({request, bytes, text});
  c->wake.notify_all();
}
void WebSockets::close(uint64_t socket, int code, const std::string& reason) {
  std::lock_guard lock(state_->mutex);
  auto found = state_->connections.find(socket);
  if (found == state_->connections.end()) return;
  auto c = found->second;
  {
    std::lock_guard connectionLock(c->mutex);
    Outgoing closing;
    closing.close = true;
    closing.code = code;
    closing.reason = reason;
    c->outgoing.push_back(std::move(closing));
    c->wake.notify_all();
  }
  // Report locally now (as on macOS); the sender sends the close frame, then aborts.
  state_->emit({socket, c->generation, "close", reason, {}, code});
  state_->connections.erase(found);
  if (!c->opened) c->abort();
}
void WebSockets::cancel(uint64_t generation) {
  std::vector<std::shared_ptr<WebSocketConnection>> retired;
  {
    std::lock_guard lock(state_->mutex);
    for (auto it = state_->connections.begin(); it != state_->connections.end();) {
      if (it->second->generation == generation) {
        retired.push_back(it->second);
        it = state_->connections.erase(it);
      } else ++it;
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
  for (auto& c : retired) c->abort();
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
}  // namespace avtools
