#include "../../native/embedded/Bridge.h"
#include "../../native/td/SourceActivation.h"
#include <dlfcn.h>
#include <mach/mach.h>
#include <algorithm>
#include <chrono>
#include <fstream>
#include <future>
#include <iostream>
#include <thread>
#include <vector>
using Clock=std::chrono::steady_clock;
void check(bool ok,const std::string& e){if(!ok)throw std::runtime_error(e);}
double elapsed(Clock::time_point t){return std::chrono::duration<double,std::milli>(Clock::now()-t).count();}
double memory(){task_vm_info_data_t i{};mach_msg_type_number_t n=TASK_VM_INFO_COUNT;task_info(mach_task_self(),TASK_VM_INFO,(task_info_t)&i,&n);return i.phys_footprint/1048576.;}
void policy(){SourceActivation q;q.observe("a","one",false);q.accepted(q.choose());q.request(true);q.observe("a","two",false);q.observe("a","three",false);check(q.choose().version.code=="two","Queued Reload changed when a later build completed");q.accepted(q.choose());check(q.choose().version.code=="two","Frozen version auto activated");SourceActivation a,b;a.observe("a","one",false);auto c=a.choose();check(c.restart,"Initial load frozen");a.accepted(c);a.observe("a","two",false);check(a.choose().version.code=="one","Frozen version replaced");a.request(false);c=a.choose();check(c.restart&&c.version.code=="one","Reset adopted pending source");a.accepted(c);a.request(true);c=a.choose();check(c.version.code=="two","Reload did not adopt");a.accepted(c);a.request(true);check(a.choose().restart,"Identical Reload ignored");a.accepted(a.choose());a.observe("b","",true);check(a.choose().version.code=="two","Unavailable selected source replaced active");a.request(true);bool rejected=false;try{a.choose();}catch(...){rejected=true;}check(rejected,"Reload used previous entry source");a.observe("b","three",true);check(a.choose().restart,"Enable auto failed");b.observe("a","two",false);b.accepted(b.choose());b.observe("a","three",false);check(b.choose().version.code=="two","Instance activation state shared");}
int main(int argc,char** argv){try{
 check(argc==5,"Usage runtime top-resources chop-resources portable-bundle");policy();
 auto lib=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);check(lib,"dlopen failed");
 auto create=(decltype(&avCreateDeferred))dlsym(lib,"avCreateDeferred");auto chopCreate=(decltype(&avChopCreate))dlsym(lib,"avChopCreate");auto cook=(decltype(&avCook))dlsym(lib,"avCook");auto chopCook=(decltype(&avChopCook))dlsym(lib,"avChopCook");auto collect=(decltype(&avChopCollect))dlsym(lib,"avChopCollect");auto destroy=(decltype(&avDestroy))dlsym(lib,"avDestroy");
 char error[8192]{};auto ch=chopCreate(argv[3],error,sizeof error);check(ch,error);const char* names[]={"out","ticks"};float out[2];AVChopFrame cf{};cf.names=names;cf.outputCount=2;cf.outputSamples=1;cf.output=out;cf.rate=60;AVStats stats{};
 auto run=[&](const std::string& src,bool reset=false){cf.source=src.c_str();cf.reset=reset;++cf.absFrame;return chopCook(ch,&cf,&stats,error,sizeof error);};
 std::ifstream input(argv[4]);std::string imported((std::istreambuf_iterator<char>(input)),{});check(!imported.empty(),"Missing portable bundle");
 check(run(imported),error);std::this_thread::sleep_for(std::chrono::milliseconds(60));AVChopDiagnostics d{};collect(ch,out,2,&stats,&d,error,sizeof error);check(out[1]>=3,"Imported TimeContext timers did not run without cooks");
 const std::string sentinel="if(globalThis.marker)throw Error('global survived');globalThis.marker=1;function setup(h){setTimeout(()=>h.outputs.set('out',999),20);requestAnimationFrame(()=>h.outputs.set('ticks',999));addEventListener('old',()=>h.outputs.set('out',999));}function onCook(h){h.outputs.set('out',1)}";
 std::vector<double> restart,steady,mem;
 for(int i=0;i<400;i++){auto t=Clock::now();check(run(sentinel,true),error);restart.push_back(elapsed(t));check(out[0]==1,"State not reset");check(run("function onCook(h){dispatchEvent(new Event('old'));h.outputs.set('out',globalThis.marker||2)}"),error);std::this_thread::sleep_for(std::chrono::milliseconds(25));collect(ch,out,2,&stats,&d,error,sizeof error);check(out[0]==2,"Old timer/listener/global survived");if(i%10==0)mem.push_back(memory());t=Clock::now();check(run("function onCook(h){dispatchEvent(new Event('old'));h.outputs.set('out',globalThis.marker||2)}"),error);steady.push_back(elapsed(t));}
 check(!run("function setup(){setTimeout(()=>{throw Error('zombie')},5);throw Error('setup failure')}"),"Setup should fail");check(std::string(error).find("setup failure")!=std::string::npos,"Missing error");std::this_thread::sleep_for(std::chrono::milliseconds(25));check(!run("function setup(){setTimeout(()=>{throw Error('zombie')},5);throw Error('setup failure')}"),"Failed bundle retried");check(std::string(error).find("setup failure")!=std::string::npos,"Old callback ran after failed activation");
 check(run("function setup(h){h.onDispose(()=>{while(true){}})}function onCook(h){h.outputs.set('out',1)}"),error);auto bounded=Clock::now();check(run(sentinel,true),error);check(elapsed(bounded)<2000,"Unbounded disposal");destroy(ch);
 std::sort(restart.begin(),restart.end());std::sort(steady.begin(),steady.end());std::cout<<"CHOP {\"restart_p50_ms\":"<<restart[200]<<",\"restart_p95_ms\":"<<restart[380]<<",\"steady_p50_ms\":"<<steady[200]<<",\"memory_first_mib\":"<<mem.front()<<",\"memory_last_mib\":"<<mem.back()<<",\"memory_mid_mib\":"<<mem[mem.size()/2]<<"}\n";
 std::vector<AVSketch*> tops;for(int i=0;i<4;i++){auto s=create(argv[2],error,sizeof error);check(s,error);tops.push_back(s);}
 std::vector<double> batches,stable,footprints;
 for(int round=0;round<40;round++){
  auto start=Clock::now();std::vector<std::future<double>> jobs;
  for(auto top:tops)jobs.push_back(std::async(std::launch::async,[&,top]{std::vector<uint8_t> pixels(1920*1080*4);AVFrame f{};f.width=1920;f.height=1080;f.output=pixels.data();f.outputSize=pixels.size();f.rate=60;f.reset=1;f.source="if(globalThis.marker)throw Error('global survived');globalThis.marker=1;function setup(p,h){const b=h.device.createBuffer({size:256,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});b.mapAsync(GPUMapMode.READ).then(()=>b.unmap());setTimeout(()=>{},5000);h.onDispose(()=>{if(globalThis.badDispose)while(true){}})}function draw(p){p.background(255,0,0)}";AVStats st{};char e[8192]{};check(cook(top,&f,&st,e,sizeof e),e);check(pixels[0]==255&&pixels[1]==0,"Bad restart image");f.reset=0;auto warm=Clock::now();check(cook(top,&f,&st,e,sizeof e),e);return elapsed(warm);}));
  for(auto& j:jobs)stable.push_back(j.get());batches.push_back(elapsed(start));footprints.push_back(memory());
 }
 // Setup/draw see the accepted snapshot; the host getter advances on later cooks.
 {std::vector<uint8_t> pixels(64*64*4);AVFrame f{};f.width=f.height=64;f.output=pixels.data();f.outputSize=pixels.size();f.rate=60;
 f.source="let host;function setup(p,h){host=h;if(h.params.Speed!==20)throw Error('setup params stale')}function draw(p,f){if(host.params!==f.params||!Object.isFrozen(f.params)||!Object.isFrozen(f.params.Point))throw Error('snapshot invalid');p.background(f.params.Speed,0,0)}";
 f.parametersJSON=R"({"Speed":20,"Point":[1,2]})";check(cook(tops[0],&f,&stats,error,sizeof error),error);check(pixels[0]==20,"TOP first parameter read stale");
 f.parametersJSON=R"({"Speed":40,"Point":[3,4]})";check(cook(tops[0],&f,&stats,error,sizeof error),error);check(pixels[0]==40,"TOP updated parameter read stale");}
 // Poison a GPU environment with an outstanding map future, then replace it.
 {std::vector<uint8_t> pixels(64*64*4);AVFrame f{};f.width=f.height=64;f.output=pixels.data();f.outputSize=pixels.size();f.rate=60;f.source="function setup(p,h){const b=h.device.createBuffer({size:256,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});b.mapAsync(GPUMapMode.READ).then(()=>b.unmap());h.device.queue.onSubmittedWorkDone();h.device.pushErrorScope('validation');h.device.popErrorScope();const m=h.device.createShaderModule({code:'@compute @workgroup_size(1) fn main() {}'});m.getCompilationInfo();h.device.createComputePipelineAsync({layout:'auto',compute:{module:m,entryPoint:'main'}});while(true){}}function draw(p){p.background(1)}";AVStats st{};check(!cook(tops[0],&f,&st,error,sizeof error),"Poisoned TOP unexpectedly succeeded");f.source="function draw(p){p.background(0,255,0)}";check(cook(tops[0],&f,&st,error,sizeof error),error);check(pixels[1]==255,"GPU recovery failed");}
 for(auto t:tops)destroy(t);std::sort(batches.begin(),batches.end());std::sort(stable.begin(),stable.end());
 std::cout<<"TOP4 {\"restart_plus_frame_p50_ms\":"<<batches[20]<<",\"restart_plus_frame_p95_ms\":"<<batches[38]<<",\"steady_per_top_p50_ms\":"<<stable[stable.size()/2]<<",\"memory_warm_mib\":"<<footprints[10]<<",\"memory_last_mib\":"<<footprints.back()<<",\"memory_peak_mib\":"<<*std::max_element(footprints.begin(),footprints.end())<<"}\nPASS fresh isolates, callbacks, runtime failure, disposal watchdog, imported timing, independent operators, 400 CHOP / 160 TOP restarts\n";
}catch(const std::exception& e){std::cerr<<"FAIL "<<e.what()<<'\n';return 1;}}
