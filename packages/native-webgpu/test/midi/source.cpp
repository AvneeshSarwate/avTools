// Isolated virtual sources for the TD fixture. Never sends to hardware.
#include <CoreMIDI/CoreMIDI.h>
#include <mach/mach_time.h>
#include <chrono>
#include <thread>
#include <fstream>
#include <string>
#include <filesystem>
int main(int argc,char**argv){
 if(argc!=2)return 1;
 MIDIClientRef client;MIDIEndpointRef a,b;
 if(MIDIClientCreate(CFSTR("avTools MIDI fixture"),nullptr,nullptr,&client))return 2;
 if(MIDISourceCreate(client,CFSTR("avTools Test A"),&a)||MIDISourceCreate(client,CFSTR("avTools Test B"),&b))return 3;
 SInt32 ai,bi;MIDIObjectGetIntegerProperty(a,kMIDIPropertyUniqueID,&ai);MIDIObjectGetIntegerProperty(b,kMIDIPropertyUniqueID,&bi);
 std::ofstream(std::string(argv[1])+"/devices.json")<<"{\"a\":\""<<uint32_t(ai)<<"\",\"b\":\""<<uint32_t(bi)<<"\"}";
 auto next=std::chrono::steady_clock::now();
 for(unsigned n=0;n<3600000&&!std::filesystem::exists(std::string(argv[1])+"/stop");n++){
  for(int i=0;i<2;i++){alignas(MIDIPacketList) uint8_t buffer[256];auto list=(MIDIPacketList*)buffer;auto p=MIDIPacketListInit(list);uint8_t bytes[]={0xb0,74,uint8_t(i?100:25)};MIDIPacketListAdd(list,sizeof(buffer),p,mach_absolute_time(),3,bytes);MIDIReceived(i?b:a,list);}
  next+=std::chrono::milliseconds(1);std::this_thread::sleep_until(next);
 }
 MIDIEndpointDispose(a);MIDIEndpointDispose(b);MIDIClientDispose(client);
}
