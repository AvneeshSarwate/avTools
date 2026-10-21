#include "../include/avtools_build.h"
#include <chrono>
#include <thread>
#include <fstream>
#include <filesystem>
#include <string>
#include <cstdio>
#include <cstring>
using namespace std::chrono_literals;
void write(const std::filesystem::path& path,const char* text){std::ofstream(path)<<text;}
template<class F> bool until(F predicate){auto end=std::chrono::steady_clock::now()+15s;while(std::chrono::steady_clock::now()<end){if(predicate())return true;std::this_thread::sleep_for(10ms);}return false;}
int main(int argc,char**argv){
 if(argc!=2)return 2;std::filesystem::path root=argv[1];char error[4096]{};
 if(!avb_init(root.c_str(),error,sizeof(error))){std::fprintf(stderr,"%s\n",error);return 3;}
 if(avb_init(root.c_str(),error,sizeof(error))||!std::strstr(error,"replace"))return 4;
 auto a=avb_subscribe_file((root/"sketches/channels/main.ts").c_str(),"chop",1);
 auto duplicate=avb_subscribe_file((root/"sketches/channels/main.ts").c_str(),"chop",0);
 auto b=avb_subscribe_file((root/"sketches/background/main.ts").c_str(),"top",1);
 if(!a||!b||!duplicate)return 5;
 auto poll=[&](){avb_poll(a);avb_poll(b);avb_poll(duplicate);};
 if(!until([&]{poll();return !strcmp(avb_status(a),"ready")&&!strcmp(avb_status(b),"ready")&&strlen(avb_source(duplicate));}))return 6;
 if(strcmp(avb_source(a),avb_source(duplicate)))return 7;
 const std::string good=avb_source(b);
 write(root/"sketches/background/main.ts","export const draw=missingIdentifier;");
 write(root/"sketches/channels/math.ts","export const scale=(value:number)=>value*19;");
 if(!until([&]{poll();return !strcmp(avb_status(b),"error")&&strstr(avb_source(a),"* 19")&&strstr(avb_source(duplicate),"* 19");}))return 8;
 if(good!=avb_source(b))return 9;
 write(root/"sketches/background/main.ts","export function draw(){};");
 if(!until([&]{poll();return !strcmp(avb_status(b),"ready");}))return 10;
 avb_destroy(duplicate);avb_destroy(a);avb_destroy(b);
 std::puts("PASS entry ABI: template/no overwrite, shared subscriptions, independent errors, last-good and recovery");
}
