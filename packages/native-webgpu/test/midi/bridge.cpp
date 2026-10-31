#include "../../native/embedded/Bridge.h"
#include <CoreMIDI/CoreMIDI.h>
#include <mach/mach_time.h>
#include <dlfcn.h>
#include <sys/resource.h>
#include <chrono>
#include <thread>
#include <iostream>
#include <string>
#include <stdexcept>
#include <atomic>
using namespace std::chrono;
static std::atomic<int> outputMessages{0};
static void outputReceived(const MIDIPacketList* list,void*,void*){auto packet=&list->packet[0];for(unsigned i=0;i<list->numPackets;i++){for(unsigned j=0;j+2<packet->length;j+=3)if(packet->data[j]==0xb0&&packet->data[j+1]==74)++outputMessages;packet=MIDIPacketNext(packet);}}
static void check(bool ok,const std::string& message){if(!ok)throw std::runtime_error(message);}
static void pause(int n){std::this_thread::sleep_for(milliseconds(n));}
static std::string portId(MIDIEndpointRef endpoint){SInt32 id;check(!MIDIObjectGetIntegerProperty(endpoint,kMIDIPropertyUniqueID,&id),"source id");return std::to_string(uint32_t(id));}
static void send(MIDIEndpointRef source,int n){alignas(MIDIPacketList) uint8_t bytes[256];auto list=reinterpret_cast<MIDIPacketList*>(bytes);auto p=MIDIPacketListInit(list);uint8_t msg[]={0xb0,uint8_t((n/128)%128),uint8_t(n%128)};MIDIPacketListAdd(list,sizeof(bytes),p,mach_absolute_time(),3,msg);check(!MIDIReceived(source,list),"send");}
int main(int argc,char**argv){try{
 check(argc==3,"bridge runtime resources");auto lib=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);check(lib,dlerror()?"runtime dlopen failed":"dlopen");
 auto create=(decltype(&avChopCreate))dlsym(lib,"avChopCreate");auto cook=(decltype(&avChopCook))dlsym(lib,"avChopCook");
 auto collect=(decltype(&avChopCollect))dlsym(lib,"avChopCollect");auto destroy=(decltype(&avDestroy))dlsym(lib,"avDestroy");auto selection=(decltype(&avMidiSelections))dlsym(lib,"avMidiSelections");
 check(create&&cook&&collect&&destroy&&selection,"exports");
 MIDIClientRef client;MIDIEndpointRef a,b;check(!MIDIClientCreate(CFSTR("avTools MIDI integration test"),nullptr,nullptr,&client),"CoreMIDI client (run outside sandbox)");
 check(!MIDISourceCreate(client,CFSTR("avTools isolated A"),&a),"source A");check(!MIDISourceCreate(client,CFSTR("avTools isolated B"),&b),"source B");
 const auto aid=portId(a),bid=portId(b);const auto selected="{\"Controller\":\""+aid+"\"}";
 const char* names[]={"count","last","ticks","status","connected","drops","errors","inputs"};
 AVSketch* sketches[4]{};AVChopFrame frames[4]{};float values[4][8]{};std::string sources[4];char error[8192]{};AVStats stats{};AVChopDiagnostics diag{};
 for(int i=0;i<4;i++){
  sketches[i]=create(argv[2],error,sizeof(error));check(sketches[i],error);selection(sketches[i],selected.c_str());
  sources[i]=R"JS(function setup(h){
    let count=0,last=-1,errors=0;
    const input=h.midi.bindInput('Controller');
    input.onStatus(()=>h.outputs.set('status',h.outputs.get('status')+1));
    input.on('cc',event=>{
      const n=event.controller*128+event.value;
      if(n<=last)errors++;
      last=n;h.outputs.set('last',last);h.outputs.set('count',++count);h.outputs.set('errors',errors);
      STALL
    });
    function tick(){h.outputs.set('ticks',h.outputs.get('ticks')+1);h.outputs.set('connected',+input.connected);h.outputs.set('drops',h.midi.stats.droppedMessages);h.outputs.set('inputs',h.midi.stats.inputs);setTimeout(tick,20);}
    tick();
  })JS";
  auto at=sources[i].find("STALL");sources[i].replace(at,5,i==3?"if(count%20===0){const end=performance.now()+20;while(performance.now()<end){}}":"");
  auto& f=frames[i];f.source=sources[i].c_str();f.names=names;f.outputCount=8;f.output=values[i];f.rate=60;f.parametersJSON=selected.c_str();
  check(cook(sketches[i],&f,&stats,error,sizeof(error)),error);
 }
 auto start=steady_clock::now();rusage before{},after{};getrusage(RUSAGE_SELF,&before);
 std::thread sender([&]{auto next=steady_clock::now();for(int n=0;n<5000;n++){send(a,n);next+=milliseconds(1);std::this_thread::sleep_until(next);}});
 for(int n=0;n<30;n++){pause(110);frames[0].reset=1;check(cook(sketches[0],&frames[0],&stats,error,sizeof(error)),error);frames[0].reset=0;}
 sender.join();pause(500);getrusage(RUSAGE_SELF,&after);
 auto cpu=[](const rusage& r){return r.ru_utime.tv_sec+r.ru_utime.tv_usec/1e6+r.ru_stime.tv_sec+r.ru_stime.tv_usec/1e6;};
 std::cout<<"four V8 workers, 5000 messages at 1kHz, 30 reloads; cpu_seconds="<<cpu(after)-cpu(before)<<", wall_seconds="<<duration<double>(steady_clock::now()-start).count()<<"\n";
 for(int i=0;i<4;i++){
  check(collect(sketches[i],values[i],8,&stats,&diag,error,sizeof(error)),error);
  std::cout<<"worker="<<i<<" count="<<values[i][0]<<" last="<<values[i][1]<<" ticks="<<values[i][2]<<" drops="<<values[i][5]<<" order_errors="<<values[i][6]<<" inputs="<<values[i][7]<<"\n";
  if(i)check(values[i][0]==5000&&values[i][1]==4999&&values[i][5]==0&&values[i][6]==0,"continuous worker delivery");
  check(values[i][7]==1,"no leaked connection after reload");
 }
 // Switch while there are no cooks. All registered JS listeners survive.
 auto change="{\"Controller\":\""+bid+"\"}";selection(sketches[1],change.c_str());pause(100);
 send(a,5000);send(b,6000);pause(100);check(collect(sketches[1],values[1],8,&stats,&diag,error,sizeof(error)),error);
 check(values[1][0]==5001&&values[1][1]==6000&&values[1][3]==1,"selection switch without cook");
 selection(sketches[1],"{\"Controller\":\"missing-device\"}");pause(100);collect(sketches[1],values[1],8,&stats,&diag,error,sizeof(error));check(values[1][4]==0&&values[1][7]==0,"missing input disconnects");
 selection(sketches[1],"{\"Controller\":\"\"}");pause(100);collect(sketches[1],values[1],8,&stats,&diag,error,sizeof(error));check(values[1][7]==0,"None closes input");
 for(auto s:sketches)destroy(s);
 // Actual native sends to an isolated virtual destination; explicit opens and coalescing.
 MIDIEndpointRef destination;check(!MIDIDestinationCreate(client,CFSTR("avTools isolated destination"),outputReceived,nullptr,&destination),"destination");
 auto did=portId(destination);auto extra=create(argv[2],error,sizeof(error));check(extra,error);
 std::string extraSource="async function setup(h){const input=await h.midi.openInput('"+aid+"',{rateHz:50,rawCC:false});input.on('cc',e=>{h.outputs.set('count',h.outputs.get('count')+1);h.outputs.set('last',e.value)});const output=await h.midi.openOutput('"+did+"');for(let i=0;i<7;i++)output.cc(0,74,i);setTimeout(()=>{h.outputs.set('inputs',h.midi.stats.inputs)},30);}";
 frames[0].source=extraSource.c_str();frames[0].reset=0;check(cook(extra,&frames[0],&stats,error,sizeof(error)),error);
 for(int n=0;n<128;n++)send(a,n);
 pause(150);check(collect(extra,values[0],8,&stats,&diag,error,sizeof(error)),error);
 check(values[0][0]>=1&&values[0][0]<128&&values[0][1]==127,"coalesced latest CC");check(outputMessages==7,"native output loopback");
 std::cout<<"native output loopback messages="<<outputMessages<<"; coalesced 128 CC into "<<values[0][0]<<" events\n";
 destroy(extra);MIDIEndpointDispose(destination);
 MIDIEndpointDispose(a);MIDIEndpointDispose(b);MIDIClientDispose(client);
 std::cout<<"PASS: fan-out, slow JS consumer, reload, selection changes without cooks, missing/None, cleanup\n";return 0;
 }catch(const std::exception&e){std::cerr<<"FAIL: "<<e.what()<<"\n";return 1;}}
