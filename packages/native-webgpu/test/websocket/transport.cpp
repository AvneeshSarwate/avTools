#include "../../native/embedded/WebSocket.h"
#include <chrono>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <thread>
#include <stdexcept>
using namespace avtools;
void check(bool ok, const char* text) {if (!ok) throw std::runtime_error(text);}
int main(int argc, char** argv) { try {
  std::mutex mutex;
  std::condition_variable cv;
  WebSockets ws([&]{cv.notify_all();});
  auto wait = [&](auto predicate) {
    auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
    while (std::chrono::steady_clock::now() < deadline) {
      WebSocketEvent event;
      while (ws.take(event)) { if (predicate(event)) return event; }
      std::unique_lock lock(mutex); cv.wait_for(lock, std::chrono::milliseconds(10));
    }
    throw std::runtime_error("Transport event timed out");
  };
  std::string url = argv[1];
  for (int index=0; index<30; ++index) {
    ws.open(1,index+1,url);
    wait([](auto& e){return e.id==1 && e.kind=="open";});
    std::vector<uint8_t> data(index==0 ? 1024*1024 : 512, 42);
    ws.send(2,index+1,1,data,false);
    auto message=wait([](auto& e){return e.kind=="binary";});
    check(message.bytes==data,"Binary echo mismatch");
    std::string text="hello 日本語 🎨";
    ws.send(3,index+1,1,{text.begin(),text.end()},true);
    message=wait([](auto& e){return e.kind=="text";});
    check(std::string(message.bytes.begin(),message.bytes.end())==text,"UTF-8 mismatch");
    ws.cancel(index+1);
    check(!ws.pending(),"Cancelled events retained");
  }
  ws.open(4,100,url+"/fragment");
  wait([](auto& e){return e.id==4&&e.kind=="open";});
  auto message=wait([](auto& e){return e.id==4&&e.kind=="text";});
  check(std::string(message.bytes.begin(),message.bytes.end())=="fragmented","Fragment reassembly failed");
  ws.close(4,4001,"done");
  auto closed=wait([](auto& e){return e.id==4&&e.kind=="close";});
  check(closed.code==4001&&closed.text=="done","Local close mismatch");
  ws.open(5,101,url+"/flood");
  std::this_thread::sleep_for(std::chrono::milliseconds(600));
  auto overflow=wait([](auto& e){return e.id==5&&e.kind=="error";});
  check(overflow.text.find("queue")!=std::string::npos,"Receive overflow not reported");
  ws.open(6,102,url+"/close");
  auto remote=wait([](auto& e){return e.id==6&&e.kind=="close";});
  check(remote.code==4000&&remote.text=="server finished","Remote close mismatch");
  ws.open(7,103,"ws://127.0.0.1:1/no-server");
  wait([](auto& e){return e.id==7&&e.kind=="close";});
  for(int n=0;n<100;n++){WebSockets pending([]{});pending.open(1,1,url);}
  std::cout<<"PASS: text/binary, 1 MiB, 30 reconnects, fragments/ping, overflow, close codes, refused connection, 100 in-flight teardowns\n";
} catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;} }
