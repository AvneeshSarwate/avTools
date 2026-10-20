#include "../include/avtools_build.h"
#include <fstream>
#include <string>
#include <cstdio>
#include <thread>
#include <chrono>
int main(int argc,char**argv){
 if(argc!=2)return 2;std::string path=argv[1],temp=path+".save";
 auto write=[&](const char* text){std::ofstream(temp)<<text;std::rename(temp.c_str(),path.c_str());};
 write("first");void* watcher=avb_file_create(path.c_str());if(!watcher)return 3;
 auto wait=[&](const char* expected,bool error=false){for(int i=0;i<300;i++){avb_file_poll(watcher);if(std::string(avb_file_source(watcher))==expected && (std::string(avb_file_error(watcher)).empty()!=error))return true;std::this_thread::sleep_for(std::chrono::milliseconds(10));}return false;};
 if(!wait("first"))return 4;write("second");if(!wait("second"))return 5;
 std::remove(path.c_str());if(!wait("second",true))return 6;
 write("third");if(!wait("third"))return 7;
 avb_file_destroy(watcher);std::remove(path.c_str());puts("PASS bundle watcher: atomic replacement, deletion keeps last-good, recreation recovers");
}
