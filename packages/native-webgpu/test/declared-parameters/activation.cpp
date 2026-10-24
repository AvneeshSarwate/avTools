#include "../../native/td/SourceActivation.h"
#include <cassert>
int main(){
 SourceActivation a;a.observe("entry","version 1",true);a.accepted(a.choose());
 a.observe("entry","version 2",false);assert(a.choose().version.code=="version 1");
 a.request(false);assert(a.choose().version.code=="version 1");a.accepted(a.choose());
 a.request(true);auto picked=a.choose();assert(picked.version.code=="version 2");a.pin(picked);
 // Recreated instance observes a newer build; the selected revision stays exact.
 SourceActivation recreated=std::move(a);recreated.observe("entry","version 3",false);
 assert(recreated.choose().version.code=="version 2"&&recreated.choose().restart);
 recreated.accepted(recreated.choose());assert(recreated.choose().version.code=="version 2");
 recreated.request(false);assert(recreated.choose().version.code=="version 2");recreated.accepted(recreated.choose());
 recreated.request(true);auto invalid=recreated.choose();recreated.reject(invalid);assert(recreated.current().version.code=="version 2");
}
