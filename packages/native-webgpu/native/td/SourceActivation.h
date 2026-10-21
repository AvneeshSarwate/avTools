#pragma once
#include <deque>
#include <string>
#include <stdexcept>
#include <optional>
#include <sstream>
// TD-thread policy only. Bundles are copied into accepted native requests;
// runtime destruction and initialization always happen on the owner worker.
class SourceActivation {
 public:
  struct Version {std::string identity,code;bool operator==(const Version& b)const{return identity==b.identity&&code==b.code;}};
  struct Choice {Version version;bool restart=false,control=false;};
 private:
  Version available,active;
  std::string selected;
  std::deque<std::optional<Version>> requests; // Reload=true; Reset=false. Never coalesce controls.
  bool automatic=true,started=false;
 public:
  void observe(std::string identity,const std::string& code,bool enabled){
    automatic=enabled;
    if(selected!=identity){selected=std::move(identity);available={selected,{}};}
    if(!code.empty())available={selected,code};
    // A Reload is accepted at the first cook that observes it. Freeze the
    // available version now, even if a busy TOP cannot submit until later.
    for(auto& request:requests)if(!request)request=available;
  }
  void request(bool reload){if(requests.size()>=16)throw std::runtime_error("Reload/Reset queue full (16)");requests.push_back(reload?std::nullopt:std::optional<Version>(active));}
  Choice choose(){
    if(!requests.empty()){
      if(!requests.front())requests.front()=available;
      const auto& version=*requests.front();
      if(version.code.empty()){requests.pop_front();throw std::runtime_error("No successful source available for this Reload/Reset");}
      return {version,true,true};
    }
    if((!started||automatic)&&!available.code.empty()&&(!started||!(available==active)))return {available,true,false};
    return {active,false,false};
  }
  void accepted(const Choice& choice){active=choice.version;started=true;if(choice.control)requests.pop_front();}
  std::string status()const{return !requests.empty()?"Reload Pending (next accepted submission)":!started?"Waiting for source":!(available==active)?"Pending Reload":"Active (see runtime diagnostics)";}
  static std::string fingerprint(const Version& v){uint64_t hash=14695981039346656037ull;for(unsigned char c:v.code){hash^=c;hash*=1099511628211ull;}std::ostringstream s;s<<std::hex<<hash;return v.code.empty()?"none":s.str();}
  std::string identities()const{return "selected="+selected+"; available="+fingerprint(available)+"; active="+active.identity+"@"+fingerprint(active);}

};
