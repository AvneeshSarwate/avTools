// Standalone TouchEngine verification host. Never creates NSApplication/windows.
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#include <TouchEngine/TouchEngine.h>
#include <TouchEngine/TEMetal.h>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <stdexcept>
#include <string>
#include <vector>
struct State { std::atomic<bool> ready{false}, loaded{false}, frame{false}, unloaded{false}; std::atomic<int> error{0}; };
static void event(TEInstance*, TEEvent event, TEResult result, int64_t, int32_t, int64_t, int32_t, void* info) {
    auto& s = *(State*)info;
    fprintf(stderr, "TouchEngine event %d: %s\n", int(event), TEResultGetDescription(result));
    if (TEResultGetSeverity(result) == TESeverityError) {
        fprintf(stderr, "TouchEngine event %d: %s\n", int(event), TEResultGetDescription(result)); s.error = int(result);
    }
    if (event == TEEventInstanceReady) s.ready = true;
    if (event == TEEventInstanceDidLoad) s.loaded = true;
    if (event == TEEventFrameDidFinish) s.frame = true;
    if (event == TEEventInstanceDidUnload) s.unloaded = true;
}
static void link(TEInstance*, TELinkEvent, const char*, void*) {}
static void check(TEResult r) {
    if (TEResultGetSeverity(r) == TESeverityError) throw std::runtime_error(TEResultGetDescription(r));
}
static void wait(std::atomic<bool>& flag, State& s) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(45);
    while (!flag && !s.error && std::chrono::steady_clock::now() < deadline)
        @autoreleasepool { [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.005]]; }
    if (s.error) throw std::runtime_error(TEResultGetDescription(TEResult(s.error.load())));
    if (!flag) throw std::runtime_error("TouchEngine timed out");
}
static std::string amountInput,gpuInput,pluginInput;
static void outputLinks(TEInstance* instance, const char* parent, std::vector<std::string>& outputs) {
    TouchObject<TEStringArray> children; check(TEInstanceLinkGetChildren(instance, parent, children.take()));
    if (!children) return;
    for (int i=0;i<children->count;i++) {
        const char* id = children->strings[i]; TouchObject<TELinkInfo> info;
        check(TEInstanceLinkGetInfo(instance, id, info.take()));
        if(info->scope==TEScopeInput && info->type==TELinkTypeBoolean && std::string(info->name)=="Gpu") gpuInput=id;
        if(info->scope==TEScopeInput && info->type==TELinkTypeDouble && std::string(info->name)=="Amount") amountInput=id;
        if (info->scope == TEScopeInput && info->type == TELinkTypeString) {
            if(std::string(info->name)=="Pluginpath") pluginInput=id;
            TouchObject<TEString> value;
            check(TEInstanceLinkGetStringValue(instance, id, TELinkValueCurrent, value.take()));
            fprintf(stderr, "Input %s (%s): %s\n", info->name, id, value ? value->string : "<unset>");
        }
        if (info->type == TELinkTypeGroup || info->type == TELinkTypeComplex || info->type == TELinkTypeSequence) outputLinks(instance,id,outputs);
        else if (info->scope == TEScopeOutput && info->type == TELinkTypeTexture) {
            outputs.emplace_back(id); check(TEInstanceLinkSetInterest(instance,id,TELinkInterestAll));
            fprintf(stderr,"Output %s (%s)\n",info->name,id);
        }
    }
}
int main(int argc, const char** argv) {
    if (argc < 2) { fprintf(stderr,"Usage: touchengine-probe fixture.tox [frames]\n"); return 2; }
    @autoreleasepool {
        State state;
        TouchObject<TEInstance> instance;
        TouchObject<TEMetalContext> context;
        id<MTLDevice> device = MTLCreateSystemDefaultDevice();
        id<MTLCommandQueue> queue = [device newCommandQueue];
        int status = 0;
        try {
            check(TEInstanceCreate(event,link,&state,instance.take()));
            check(TEInstanceSetPreferredEnginePath(instance,"/Applications/TouchDesigner.app"));
            check(TEMetalContextCreate(device,context.take()));
            check(TEInstanceAssociateGraphicsContext(instance,(TEGraphicsContext*)context.get()));
            check(TEInstanceConfigure(instance,argv[1],TETimeExternal)); wait(state.ready,state);
            check(TEInstanceLoad(instance)); wait(state.loaded,state);
            std::vector<std::string> outputs; outputLinks(instance,nullptr,outputs);
            if(argc>4){if(pluginInput.empty())throw std::runtime_error("Missing Pluginpath parameter");check(TEInstanceLinkSetStringValue(instance,pluginInput.c_str(),argv[4]));}
            check(TEInstanceResume(instance));
            const int frames = argc > 2 ? atoi(argv[2]) : 10;
            const bool benchmark=argc>3 && std::string(argv[3]).find("--bench-")==0;
            if(benchmark){if(gpuInput.empty())throw std::runtime_error("Missing Gpu parameter");check(TEInstanceLinkSetBooleanValue(instance,gpuInput.c_str(),std::string(argv[3])=="--bench-syphon"));}
            auto begin=std::chrono::steady_clock::now();
            for (int frame=0;frame<frames;frame++) {
                // Syphon discovery and its independent producer need wall-clock time.
                const double elapsed=std::chrono::duration<double>(std::chrono::steady_clock::now()-begin).count();
                const double delay=benchmark?std::max(0.0,frame/60.0-elapsed):1.0/60.0;
                [[NSRunLoop currentRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:delay]];
                if(argc>3 && std::string(argv[3])=="--sketch" && !amountInput.empty()){double amount=frame<45?40:90;check(TEInstanceLinkSetDoubleValue(instance,amountInput.c_str(),&amount,1));}
                auto cookStart=std::chrono::steady_clock::now();
                state.frame = false; check(TEInstanceStartFrameAtTime(instance,frame,60,false)); wait(state.frame,state);
                const double cookMs=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-cookStart).count();
                for (const auto& identifier : outputs) {
                    TouchObject<TETexture> wrapped; check(TEInstanceLinkGetTextureValue(instance,identifier.c_str(),TELinkValueCurrent,wrapped.take()));
                    if (!wrapped) continue;
                    if (TETextureGetType(wrapped) != TETextureTypeMetal) throw std::runtime_error("Probe currently requires Metal output textures");
                    id<MTLTexture> texture = TEMetalTextureGetTexture((TEMetalTexture*)wrapped.get());
                    if (texture.pixelFormat != MTLPixelFormatRGBA8Unorm && texture.pixelFormat != MTLPixelFormatBGRA8Unorm)
                        throw std::runtime_error("Probe currently requires RGBA8/BGRA8 output");
                    id<MTLCommandBuffer> command = [queue commandBuffer];
                    TouchObject<TESemaphore> incoming; uint64_t value=0;
                    if (TEInstanceHasTextureTransfer(instance,wrapped)) {
                        check(TEInstanceGetTextureTransfer(instance,wrapped,incoming.take(),&value));
                        if (incoming && TESemaphoreGetType(incoming) == TESemaphoreTypeMetal) {
                            id<MTLSharedEvent> shared = [device newSharedEventWithHandle:TEMetalSemaphoreGetSharedEventHandle((TEMetalSemaphore*)incoming.get())];
                            [command encodeWaitForEvent:shared value:value]; [shared release];
                        } else throw std::runtime_error("Expected Metal transfer semaphore");
                    }
                    NSUInteger row = (texture.width * 4 + 255) & ~NSUInteger(255);
                    id<MTLBuffer> pixels = [device newBufferWithLength:row*texture.height options:MTLResourceStorageModeShared];
                    id<MTLBlitCommandEncoder> blit = [command blitCommandEncoder];
                    [blit copyFromTexture:texture sourceSlice:0 sourceLevel:0 sourceOrigin:MTLOriginMake(0,0,0)
                        sourceSize:MTLSizeMake(texture.width,texture.height,1) toBuffer:pixels destinationOffset:0
                        destinationBytesPerRow:row destinationBytesPerImage:row*texture.height]; [blit endEncoding];
                    id<MTLSharedEvent> done = [device newSharedEvent];
                    [command encodeSignalEvent:done value:1]; [command commit]; [command waitUntilCompleted];
                    if (command.status == MTLCommandBufferStatusError) throw std::runtime_error("Probe readback failed");
                    if (TEInstanceDoesTextureOwnershipTransfer(instance)) {
                        MTLSharedEventHandle* handle = [done newSharedEventHandle];
                        TouchObject<TEMetalSemaphore> outgoing; outgoing.take(TEMetalSemaphoreCreate(handle,nullptr,nullptr));
                        check(TEInstanceAddTextureTransfer(instance,wrapped,(TESemaphore*)outgoing.get(),1)); [handle release];
                    }
                    unsigned char* bytes = (unsigned char*)pixels.contents;
                    const auto origin=TETextureGetOrigin(wrapped);
                    NSUInteger topOffset=origin==TETextureOriginTopLeft?0:row*(texture.height-1);
                    NSUInteger bottomOffset=origin==TETextureOriginTopLeft?row*(texture.height-1):0;
                    NSUInteger offset = row*(texture.height/2) + (texture.width/2)*4;
                    NSDictionary* result = @{ @"frame":@(frame), @"cookMs":@(cookMs), @"output":[NSString stringWithUTF8String:identifier.c_str()],
                        @"width":@(texture.width), @"height":@(texture.height), @"pixelFormat":@(texture.pixelFormat),
                        @"origin":@(origin),
                        @"visualTop":@[@(bytes[topOffset]),@(bytes[topOffset+1]),@(bytes[topOffset+2]),@(bytes[topOffset+3])],
                        @"visualBottom":@[@(bytes[bottomOffset]),@(bytes[bottomOffset+1]),@(bytes[bottomOffset+2]),@(bytes[bottomOffset+3])],
                        @"corner":@[@(bytes[0]),@(bytes[1]),@(bytes[2]),@(bytes[3])],
                        @"center":@[@(bytes[offset]),@(bytes[offset+1]),@(bytes[offset+2]),@(bytes[offset+3])] };
                    NSData* json=[NSJSONSerialization dataWithJSONObject:result options:0 error:nil];
                    fwrite(json.bytes,1,json.length,stdout); fputc('\n',stdout); fflush(stdout);
                    [done release]; [pixels release];
                }
            }
            fprintf(stderr,"Measured frame-loop seconds: %.6f\n",std::chrono::duration<double>(std::chrono::steady_clock::now()-begin).count());
            check(TEInstanceSuspend(instance)); check(TEInstanceUnload(instance)); wait(state.unloaded,state);
            fprintf(stderr,"TouchEngine probe passed: %zu outputs, %d cooks\n",outputs.size(),frames);
        } catch (const std::exception& e) { fprintf(stderr,"TouchEngine probe failed: %s\n",e.what()); status=1; }
        // Release instance while callback state is still alive.
        instance.reset(); context.reset(); [queue release]; [device release]; return status;
    }
}
