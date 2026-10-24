#include "IO.h"
#include <uv.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <deque>
#include <map>
#include <set>
#include <mutex>
#include <thread>
#include <stdexcept>
#include <algorithm>
#include <cstdlib>
namespace avtools {
struct IO::Impl {
  struct Socket {uv_udp_t handle{};Impl* owner;uint64_t id,gen;};
  struct Read {uv_fs_t req{};Impl* owner;uint64_t id,gen;std::string path;int fd=-1;int stage=0;size_t offset=0;std::vector<uint8_t> bytes;std::string error;};
  struct Send {uv_udp_send_t req{};Impl* owner;uint64_t id,gen;std::vector<uint8_t> bytes;};
  uv_loop_t loop{};uv_async_t async{};std::thread thread;
  std::mutex mutex;std::deque<std::function<void()>> commands;
  std::deque<IOEvent> events;size_t packetCount=0,packetBytes=0;uint64_t drops=0;
  bool stopping=false;std::function<void()> wake;
  std::map<uint64_t,Socket*> sockets;std::set<uint64_t> cancelled;
  size_t reads=0,sends=0;
  explicit Impl(std::function<void()> notify):wake(std::move(notify)){
    int e=uv_loop_init(&loop);if(e)throw std::runtime_error(uv_strerror(e));
    async.data=this;e=uv_async_init(&loop,&async,[](uv_async_t* h){auto& s=*static_cast<Impl*>(h->data);std::deque<std::function<void()>> pending;{std::lock_guard lock(s.mutex);pending.swap(s.commands);}for(auto& command:pending)command();});
    if(e){uv_loop_close(&loop);throw std::runtime_error(uv_strerror(e));}
    thread=std::thread([this]{uv_run(&loop,UV_RUN_DEFAULT);uv_loop_close(&loop);});
  }
  ~Impl(){post([this]{stopping=true;while(!sockets.empty())closeSocket(sockets.begin()->first);uv_close(reinterpret_cast<uv_handle_t*>(&async),nullptr);});thread.join();}
  void post(std::function<void()> command){{std::lock_guard lock(mutex);commands.push_back(std::move(command));}uv_async_send(&async);}
  bool dead(uint64_t gen){return stopping||cancelled.count(gen);}
  void emit(IOEvent event){if(dead(event.generation))return;{std::lock_guard lock(mutex);
    if(event.kind=="data") {if(packetCount>=256||packetBytes+event.bytes.size()>4*1024*1024){++drops;return;}++packetCount;packetBytes+=event.bytes.size();}
    events.push_back(std::move(event));}wake();
  }
  void result(uint64_t id,uint64_t gen,int error){emit({id,gen,error?"error":"ok",error?uv_strerror(error):""});}
  static int address(const std::string& host,int port,sockaddr_storage& out){
    const auto name=host=="localhost"?"127.0.0.1":host.c_str();
    if(host.find(':')!=std::string::npos)return uv_ip6_addr(name,port,reinterpret_cast<sockaddr_in6*>(&out));
    return uv_ip4_addr(name,port,reinterpret_cast<sockaddr_in*>(&out));
  }
  static void peer(const sockaddr* a,std::string& host,int& port){char text[INET6_ADDRSTRLEN]{};if(a->sa_family==AF_INET){auto* p=reinterpret_cast<const sockaddr_in*>(a);uv_ip4_name(p,text,sizeof(text));port=ntohs(p->sin_port);}else{auto* p=reinterpret_cast<const sockaddr_in6*>(a);uv_ip6_name(p,text,sizeof(text));port=ntohs(p->sin6_port);}host=text;}
  void closeSocket(uint64_t id){auto it=sockets.find(id);if(it==sockets.end())return;auto* socket=it->second;sockets.erase(it);uv_udp_recv_stop(&socket->handle);uv_close(reinterpret_cast<uv_handle_t*>(&socket->handle),[](uv_handle_t* h){delete static_cast<Socket*>(h->data);});}
  void open(uint64_t id,uint64_t gen,const std::string& host,int port){
    if(dead(gen))return;if(sockets.size()>=16){result(id,gen,UV_EMFILE);return;}
    sockaddr_storage addr{};int e=address(host,port,addr);if(e){result(id,gen,e);return;}
    auto* s=new Socket{{},this,id,gen};s->handle.data=s;
    e=uv_udp_init(&loop,&s->handle);if(e){delete s;result(id,gen,e);return;}
    sockets[id]=s;e=uv_udp_bind(&s->handle,reinterpret_cast<sockaddr*>(&addr),0);
    if(!e)e=uv_udp_recv_start(&s->handle,[](uv_handle_t*,size_t,uv_buf_t* b){b->base=static_cast<char*>(malloc(65536));b->len=b->base?65536:0;},[](uv_udp_t* h,ssize_t n,const uv_buf_t* b,const sockaddr* a,unsigned flags){
      auto* s=static_cast<Socket*>(h->data);auto& owner=*s->owner;
      if(n<0){
        // A persistent OS receive error must not create an unbounded error queue.
        // Report once and close; pending sends still complete through libuv.
        owner.emit({s->id,s->gen,"socketError",uv_strerror(int(n))});owner.closeSocket(s->id);
      }
      else if(a&&!(flags&UV_UDP_PARTIAL)){IOEvent event{s->id,s->gen,"data"};peer(a,event.address,event.port);event.bytes.assign(b->base,b->base+n);owner.emit(std::move(event));}
      else if(flags&UV_UDP_PARTIAL){std::lock_guard lock(owner.mutex);++owner.drops;}
      free(b->base);
    });
    if(e){closeSocket(id);result(id,gen,e);return;}
    int len=sizeof(addr);e=uv_udp_getsockname(&s->handle,reinterpret_cast<sockaddr*>(&addr),&len);
    if(e){closeSocket(id);result(id,gen,e);return;}
    IOEvent event{id,gen,"open"};peer(reinterpret_cast<sockaddr*>(&addr),event.address,event.port);emit(std::move(event));
  }
  void send(uint64_t id,uint64_t gen,uint64_t socket,const std::string& host,int port,std::vector<uint8_t> bytes){
    if(dead(gen))return;auto it=sockets.find(socket);if(it==sockets.end()||it->second->gen!=gen){result(id,gen,UV_EBADF);return;}
    if(sends>=64){result(id,gen,UV_EBUSY);return;}sockaddr_storage addr{};int e=address(host,port,addr);if(e){result(id,gen,e);return;}
    auto* r=new Send{{},this,id,gen,std::move(bytes)};r->req.data=r;auto b=uv_buf_init(reinterpret_cast<char*>(r->bytes.data()),unsigned(r->bytes.size()));++sends;
    e=uv_udp_send(&r->req,&it->second->handle,&b,1,reinterpret_cast<sockaddr*>(&addr),[](uv_udp_send_t* req,int status){auto* r=static_cast<Send*>(req->data);--r->owner->sends;r->owner->result(r->id,r->gen,status);delete r;});
    if(e){--sends;delete r;result(id,gen,e);}
  }
  static void readDone(uv_fs_t* req){auto* r=static_cast<Read*>(req->data);auto& s=*r->owner;auto n=req->result;auto stat=req->statbuf;uv_fs_req_cleanup(req);
    if(r->stage==3){if(r->error.empty()&&n<0)r->error=uv_strerror(int(n));IOEvent e{r->id,r->gen,r->error.empty()?"file":"error",r->error};e.bytes=std::move(r->bytes);--s.reads;s.emit(std::move(e));delete r;return;}
    if(n<0)r->error=uv_strerror(int(n));
    if(r->stage==0&&n>=0)r->fd=int(n);
    if(s.dead(r->gen))r->error="File read cancelled";
    if(r->error.empty()&&r->stage==0){r->stage=1;int e=uv_fs_fstat(&s.loop,req,r->fd,readDone);if(e<0){req->result=e;readDone(req);}return;}
    if(r->error.empty()&&r->stage==1){
      if(!S_ISREG(stat.st_mode))r->error="Only regular files can be read";
      else if(stat.st_size>64*1024*1024)r->error="File exceeds 64 MiB";
      else {r->bytes.resize(stat.st_size);r->stage=2;}
    }else if(r->error.empty()&&r->stage==2){if(n==0)r->bytes.resize(r->offset);else r->offset+=size_t(n);}
    if(r->error.empty()&&r->stage==2&&r->offset<r->bytes.size()){
      auto b=uv_buf_init(reinterpret_cast<char*>(r->bytes.data()+r->offset),unsigned(std::min(size_t(256*1024),r->bytes.size()-r->offset)));
      int e=uv_fs_read(&s.loop,req,r->fd,&b,1,r->offset,readDone);if(e<0){req->result=e;readDone(req);}return;
    }
    r->stage=3;if(r->fd>=0){int e=uv_fs_close(&s.loop,req,r->fd,readDone);if(e<0){req->result=e;readDone(req);}}else{req->result=0;readDone(req);}
  }
  void read(uint64_t id,uint64_t gen,std::string path){if(dead(gen))return;if(reads>=4){result(id,gen,UV_EBUSY);return;}++reads;auto* r=new Read{{},this,id,gen,std::move(path)};r->req.data=r;int e=uv_fs_open(&loop,&r->req,r->path.c_str(),O_RDONLY|O_NONBLOCK,0,readDone);if(e<0){r->req.result=e;readDone(&r->req);}}
};
IO::IO(std::function<void()> wake):impl_(std::make_unique<Impl>(std::move(wake))){}
IO::~IO()=default;
void IO::read(uint64_t id,uint64_t gen,std::string path){impl_->post([s=impl_.get(),id,gen,path=std::move(path)]{s->read(id,gen,path);});}
void IO::open(uint64_t id,uint64_t gen,std::string address,int port){impl_->post([s=impl_.get(),id,gen,address=std::move(address),port]{s->open(id,gen,address,port);});}
void IO::send(uint64_t id,uint64_t gen,uint64_t socket,std::string address,int port,std::vector<uint8_t> bytes){impl_->post([s=impl_.get(),id,gen,socket,address=std::move(address),port,bytes=std::move(bytes)]()mutable{s->send(id,gen,socket,address,port,std::move(bytes));});}
void IO::close(uint64_t socket){impl_->post([s=impl_.get(),socket]{s->closeSocket(socket);});}
void IO::cancel(uint64_t gen){impl_->post([s=impl_.get(),gen]{s->cancelled.insert(gen);for(auto it=s->sockets.begin();it!=s->sockets.end();){auto id=(it++)->first;if(s->sockets.at(id)->gen==gen)s->closeSocket(id);}});}
bool IO::take(IOEvent& event){std::lock_guard lock(impl_->mutex);if(impl_->events.empty())return false;event=std::move(impl_->events.front());impl_->events.pop_front();if(event.kind=="data"){--impl_->packetCount;impl_->packetBytes-=event.bytes.size();}return true;}
bool IO::pending(){std::lock_guard lock(impl_->mutex);return !impl_->events.empty();}
uint64_t IO::dropped(){std::lock_guard lock(impl_->mutex);return impl_->drops;}
}
