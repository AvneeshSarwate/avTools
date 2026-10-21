#include "../../native/embedded/Bridge.h"
#include "../../native/embedded/LogSink.h"
#include <dlfcn.h>
#include <mach/mach.h>
#include <algorithm>
#include <atomic>
#include <chrono>
#include <future>
#include <iostream>
#include <memory>
#include <thread>
#include <vector>
using Clock=std::chrono::steady_clock;
void check(bool ok,const std::string& why){if(!ok)throw std::runtime_error(why);}
double elapsed(Clock::time_point t){return std::chrono::duration<double,std::milli>(Clock::now()-t).count();}
double memory(){task_vm_info_data_t i{};mach_msg_type_number_t n=TASK_VM_INFO_COUNT;task_info(mach_task_self(),TASK_VM_INFO,(task_info_t)&i,&n);return i.phys_footprint/1048576.;}
int main(int argc,char** argv){try{
 check(argc==3,"Usage dylib chop-resources");
 auto lib=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);if(!lib)throw std::runtime_error(dlerror());
 #define LOAD(name) auto name=(decltype(&::name))dlsym(lib,#name);check(name,#name)
 LOAD(avLogCreate);LOAD(avLogDestroy);LOAD(avLogLevel);LOAD(avLogRead);LOAD(avLogClear);LOAD(avLogAttach);LOAD(avChopCreate);LOAD(avChopCook);LOAD(avDestroy);
 char error[8192]{};auto ch=avChopCreate(argv[2],error,sizeof error);check(ch,error);auto log=avLogCreate();avLogAttach(ch,log);
 const char* names[]={"out"};float output[1];AVChopFrame frame{};frame.names=names;frame.outputCount=1;frame.outputSamples=1;frame.output=output;frame.rate=60;AVStats stats{};
 auto run=[&](const std::string& source,bool reset=false){frame.source=source.c_str();frame.reset=reset;++frame.absFrame;return avChopCook(ch,&frame,&stats,error,sizeof error);};
 auto snap=std::make_unique<AVLogSnapshot>();auto read=[&](){avLogRead(log,snap.get());};
 auto contains=[&](const std::string& text){for(unsigned n=0;n<snap->count;n++)if(std::string(snap->entries[n].message).find(text)!=std::string::npos)return true;return false;};
 const std::string source=R"JS(
 let touched=0;const evil={get hidden(){touched++;throw Error('getter')},toString(){touched++;throw Error('conversion')},toJSON(){touched++}};
 const proxy=new Proxy({}, {ownKeys(){touched++;throw Error('proxy')},get(){touched++;throw Error('get')}});
 const cycle={value:42};cycle.self=cycle;
 console.info('startup',cycle,evil,proxy,undefined,null,true,Symbol('x'),123n);
 console.debug('filtered',evil);
 console.warn('unicode π🙂\nsecond line',new Float32Array(20000));
 Error.prepareStackTrace=()=>{touched++;throw Error('stack hook')};console.error(new TypeError('sample error'));
 let rope='';for(let n=0;n<10000;n++)rope+='abcdefgh';console.log('deep rope',rope);console.log('nul\0tail'); console.log('x'.repeat(10000)); console.log('🙂'.repeat(2000));
 const mutable={a:1};console.log('snapshot',mutable);mutable.a=99;
 console.log(Array.from({length:100000},(_,i)=>i));console.log(Object.fromEntries(Array.from({length:10000},(_,i)=>['k'+i,i])));
 function setup(h){console.log('setup');let n=0;function tick(){console.log('timer',++n);setTimeout(tick,5)}setTimeout(tick,5)}
 function onCook(h){h.outputs.set('out',touched===0?7:99);console.log('frame')}
 )JS";
 check(run(source),error);check(output[0]==7,"Formatter invoked user hooks");read();check(contains("startup")&&contains("[Circular]")&&contains("[Accessor]")&&contains("[Proxy]"),"Missing previews");check(!contains("filtered"),"Debug not filtered");check(contains("+19992")&&contains("sample error")&&contains("TypeError")&&contains("snapshot {a: 1}")&&contains("nul\\0tail"),"Values not captured");check(snap->truncated>=2,"Missing truncation count");
 uint64_t generation=snap->entries[0].generation,sequence=snap->entries[snap->count-1].sequence;
 std::this_thread::sleep_for(std::chrono::milliseconds(30));read();check(contains("timer"),"Timer didn't log without cook");
 check(run(source,true),error);read();check(snap->entries[snap->count-1].generation>generation,"Restart lost generation");
 avLogClear(log);read();check(snap->count==0&&snap->truncated==0,"Clear failed");check(run("console.error('not an exception');function onCook(h){h.outputs.set('out',3)}"),error);check(output[0]==3,"console.error stopped runtime");read();check(snap->entries[0].sequence>sequence,"Clear reset sequence");
 check(!run("console.log('before failure');function setup(){throw Error('real failure')}"),"Setup should fail");read();check(contains("before failure"),"Failed setup lost logs");check(std::string(error).find("real failure")!=std::string::npos,"Logger replaced diagnostic");
 avLogLevel(log,4);avLogClear(log);check(run("console.error('off');function onCook(h){h.outputs.set('out',4)}"),error);read();check(snap->count==0,"Off captured");
 avLogLevel(log,0);check(run("console.debug('enabled');function onCook(h){for(let n=0;n<1000;n++)console.info('flood',n);h.outputs.set('out',5)}"),error);read();check(snap->count==256&&snap->evicted>=745,"Ring unbounded/wrong eviction");
 const auto overflowEvicted=snap->evicted;
 // Concurrent immutable snapshots and clear while a producer logs heavily.
 const std::string flood="function setup(){function tick(){for(let n=0;n<500;n++)console.log('race',n);setTimeout(tick,1)}setTimeout(tick,1)}function onCook(h){h.outputs.set('out',6)}";
 check(run(flood),error);double mem0=memory();uint64_t maxDrops=0;for(int i=0;i<500;i++){read();maxDrops=std::max(maxDrops,snap->dropped);for(unsigned n=1;n<snap->count;n++)check(snap->entries[n].sequence>snap->entries[n-1].sequence,"Snapshot torn/out of order");if(i%13==0)avLogClear(log);std::this_thread::sleep_for(std::chrono::milliseconds(1));}double mem1=memory();
 check(run("function onCook(h){h.outputs.set('out',8)}"),error);check(output[0]==8,"Flood stalled frame progress");
 // Standalone sink tests isolate clear linearization and two non-destructive observers.
 avtools::LogSink ring;ring.capture(1,1,"one");auto other=std::make_unique<AVLogSnapshot>();ring.snapshot(*snap);ring.snapshot(*other);check(snap->entries[0].sequence==other->entries[0].sequence,"Observers consumed logs");ring.clear();ring.capture(1,2,"after clear");ring.snapshot(*other);check(other->count==1&&std::string(other->entries[0].message)=="after clear","Snapshot repopulated storage");
 std::cout<<"{\"correctness\":\"passed\",\"flood_memory_start_mib\":"<<mem0<<",\"flood_memory_end_mib\":"<<mem1<<",\"overflow_evicted\":"<<overflowEvicted<<",\"race_max_drops_between_clears\":"<<maxDrops<<",\"entry_bytes\":"<<sizeof(AVLogEntry)<<",\"snapshot_bytes\":"<<sizeof(AVLogSnapshot)<<",\"measurements\":[";
 struct Case{const char* name;int level;const char* code;};Case cases[]={{"no_messages",1,""},{"off",4,"console.log('frame',12)"},{"capture",1,"console.log('frame',12)"},{"filtered_debug",1,"console.debug('frame',data)"},{"large_preview",1,"console.log(data)"},{"burst100",1,"for(let n=0;n<100;n++)console.log('burst',n)"}};
 for(int c=0;c<6;c++){avLogLevel(log,cases[c].level);std::string src="const data=new Float32Array(20000);function onCook(h){"+std::string(cases[c].code)+";h.outputs.set('out',1)}";check(run(src),error);std::vector<double> times;for(int i=0;i<1000;i++){auto t=Clock::now();check(run(src),error);times.push_back(elapsed(t));}std::sort(times.begin(),times.end());if(c)std::cout<<',';std::cout<<"{\"case\":\""<<cases[c].name<<"\",\"p50_ms\":"<<times[500]<<",\"p95_ms\":"<<times[950]<<",\"p99_ms\":"<<times[990]<<'}';}
 std::cout<<"],\"format_batches\":[";
 for(int c=0;c<5;c++){avLogLevel(log,cases[c].level);std::string src="const data=new Float32Array(20000);function onCook(h){const start=performance.now();for(let k=0;k<1000;k++){"+std::string(cases[c].code)+";}h.outputs.set('out',performance.now()-start)}";check(run(src),error);std::vector<double> times;for(int i=0;i<200;i++){check(run(src),error);if(i>=20)times.push_back(output[0]/1000);}std::sort(times.begin(),times.end());if(c)std::cout<<',';std::cout<<"{\"case\":\""<<cases[c].name<<"\",\"per_call_p50_ms\":"<<times[90]<<",\"per_call_p95_ms\":"<<times[171]<<'}';}
 std::cout<<"]}\n";
 // Shared ownership makes destroying a public sink handle safe while timers run.
 check(run(flood),error);avLogDestroy(log);std::this_thread::sleep_for(std::chrono::milliseconds(10));avDestroy(ch);
 }catch(const std::exception& e){std::cerr<<"FAIL "<<e.what()<<'\n';return 1;}}
