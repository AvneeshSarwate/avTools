#include "../../native/embedded/Bridge.h"
#include <dlfcn.h>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>
#include <chrono>
static void require(bool value,const char* detail){if(!value)throw std::runtime_error(detail);}
int main(int argc,char**argv){try{
  require(argc==3,"bridge-probe runtime.dylib Resources");void* lib=dlopen(argv[1],RTLD_NOW|RTLD_LOCAL);if(!lib)throw std::runtime_error(dlerror());
  auto create=reinterpret_cast<decltype(&avCreate)>(dlsym(lib,"avCreate"));auto cook=reinterpret_cast<decltype(&avCook)>(dlsym(lib,"avCook"));auto destroy=reinterpret_cast<decltype(&avDestroy)>(dlsym(lib,"avDestroy"));require(create&&cook&&destroy,"Missing C API");
  const char* source=R"JS(let count=0;async function setup(p,host){await host.device.queue.onSubmittedWorkDone();p.textSize(16);}function draw(p,f){count++;if(f.controls.channels[0].samples.length!==3||f.controls.sampleRate!==120)throw Error('CHOP snapshot');p.background(f.chop('amount',1),f.chop('amount',2),count);p.image(f.top(0),0,0,8,8);p.fill(255);p.noStroke();p.text('Dawn',10,30);})JS";
  for(int cycle=0;cycle<3;cycle++){
    char error[8192]{};AVSketch* a=create(argv[2],error,sizeof(error));require(a,error);AVSketch* b=create(argv[2],error,sizeof(error));require(b,error);
    std::vector<uint8_t> input(4*4*4);for(int y=0;y<4;y++)for(int x=0;x<4;x++){auto i=(y*4+x)*4;input[i]=y<2?255:0;input[i+1]=y>=2?255:0;input[i+3]=255;}
    float samples[]={0,40,80};AVChannel channel{"amount",samples,3};AVImage image{input.data(),4,4,input.size()};std::vector<uint8_t> pixels(65*37*4,7);
    AVFrame f{};f.source=source;f.width=65;f.height=37;f.rate=60;f.sampleRate=120;f.channels=&channel;f.channelCount=1;f.images=&image;f.imageCount=1;f.output=pixels.data();f.outputSize=pixels.size();AVStats stats{};
    auto render=[&](AVSketch* s){int result=cook(s,&f,&stats,error,sizeof(error));if(!result)fprintf(stderr,"Cook: %s\n",error);return result;};
    for(int frame=1;frame<=100;frame++){f.frame=frame;f.deltaSeconds=1.0/60;require(render(a),error);require(!*error,error);auto last=pixels.size()-4;require(pixels[last]==40&&pixels[last+1]==80&&pixels[last+2]==frame,"CHOP / persistent state / padded readback mismatch");require(pixels[0]>240&&pixels[1]<10,"TOP top orientation mismatch");require(pixels[6*65*4]<10&&pixels[6*65*4+1]>240,"TOP bottom orientation mismatch");}
    require(render(b),error);require(pixels[pixels.size()-2]==1,"Instances shared sketch state");
    int white=0;for(size_t i=0;i<pixels.size();i+=4)if(pixels[i]>240&&pixels[i+1]>240&&pixels[i+2]>240)white++;require(white>20,"Rust text missing");
    f.source="function draw( broken";require(render(b),"Bad source should retain old sketch");require(strstr(error,"SyntaxError"),"Compile error not reported");require(pixels[pixels.size()-2]==2,"Last valid sketch not kept");
    f.source="function draw(){throw new Error('expected draw error')}";require(!render(b),"Draw exception accepted");require(strstr(error,"expected draw error"),"Draw exception lost");
    f.source="function draw(){while(true){}}";auto start=std::chrono::steady_clock::now();require(!render(b),"Infinite loop accepted");require(strstr(error,"budget"),"Timeout not reported");require(std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count()<2,"Timeout exceeded bound");
    f.source=source;f.reset=1;require(render(b),error);require(pixels[pixels.size()-2]==1,"Reset failed to restart setup state");
    pixels.resize(71*41*4);f.width=71;f.height=41;f.reset=0;f.output=pixels.data();f.outputSize=pixels.size();require(render(b),error);require(pixels[pixels.size()-2]==1,"Resize did not reset state");
    f.source="let level=0;function onPulse(name,p,f){if(name==='Trigger')level+=f.chop('amount',1)+f.chop('missing');}function draw(p){p.background(level,0,0)}";f.reset=1;
    const char* pulses[]={"Trigger","Trigger"};f.pulses=pulses;f.pulseCount=2;require(render(b),error);require(pixels[0]==80,"Pulse handlers did not read CHOP snapshot exactly twice");f.reset=0;f.pulseCount=0;require(render(b),error);require(pixels[0]==80,"Pulse was replayed");
    f.source="async function setup(){await new Promise(()=>{})} function draw(){}";require(!render(b),"Unresolved setup accepted");require(strstr(error,"budget"),"Async timeout missing");
    destroy(b);destroy(a);printf("Bridge cycle %d passed: text, CHOP samples, TOP orientation, 100 cooks, two isolates, reload, reset, resize, errors, sync/async budgets, disposal\n",cycle);
  }
  dlclose(lib);return 0;
}catch(const std::exception& e){fprintf(stderr,"FAIL: %s\n",e.what());return 1;}}
