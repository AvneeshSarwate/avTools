#define main integration_main
#include "bridge.cpp"
#undef main
static std::atomic<bool> entered{false},releaseCallback{false},closed{false};
static std::atomic<int> calls{0};
static void callback(uintptr_t context,const uint8_t*,uint32_t){
 check(context==123,"callback context");++calls;entered=true;
 while(!releaseCallback)std::this_thread::sleep_for(milliseconds(1));
}
int main(int argc,char** argv){try{
 check(argc==2,"barrier MIDI library");auto lib=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);check(lib,"dlopen");
 using Open=uint32_t(*)(const uint8_t*,uint32_t,uint32_t,uint32_t,void(*)(uintptr_t,const uint8_t*,uint32_t),uintptr_t,uint8_t*,uint32_t);
 auto open=(Open)dlsym(lib,"av_midi_open_input");auto close=(void(*)(uint32_t))dlsym(lib,"midi_close_input");check(open&&close,"embedded ABI");
 MIDIClientRef client;MIDIEndpointRef source;check(!MIDIClientCreate(CFSTR("avTools close barrier test"),nullptr,nullptr,&client),"MIDI client");check(!MIDISourceCreate(client,CFSTR("avTools isolated close test"),&source),"MIDI source");
 const auto port=portId(source);uint8_t error[1024]{};
 auto handle=open((const uint8_t*)port.data(),port.size(),1000,1,callback,123,error,sizeof(error));check(handle,(char*)error);
 send(source,1);auto deadline=steady_clock::now()+seconds(2);while(!entered){check(steady_clock::now()<deadline,"callback timeout");pause(1);}
 std::thread closing([&]{close(handle);closed=true;});pause(30);
 const bool waited=!closed;releaseCallback=true;closing.join();check(waited,"close returned while callback was in flight");
 const int count=calls;for(int i=0;i<100;i++)send(source,i);pause(30);check(calls==count,"callback after close barrier");
 MIDIEndpointDispose(source);MIDIClientDispose(client);std::cout<<"PASS: embedded close waits for in-flight callback; no callback after close returns\n";return 0;
}catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}}
