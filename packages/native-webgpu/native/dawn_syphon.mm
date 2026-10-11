#ifdef AVTOOLS_EMBEDDED_SYPHON
#include "AvToolsSyphonPrefix.h"
#import <Syphon/SyphonServerDirectory.h>
#endif
#import <Foundation/Foundation.h>
#import <Syphon/SyphonMetalServer.h>
#include <atomic>
#include <memory>
#include <cmath>
#include <pthread.h>
#include "src/dawn/node/binding/GPUDevice.h"
#include "src/dawn/node/binding/GPUTexture.h"
#include "src/dawn/node/interop/Core.h"
#include "src/dawn/native/metal/DeviceMTL.h"
#include "src/dawn/native/metal/QueueMTL.h"
#include "src/dawn/native/metal/TextureMTL.h"

#ifdef AVTOOLS_EMBEDDED_SYPHON
// Give embedded publishers a recognizable identity, independent of the host app.
@interface AVToolsEmbeddedSyphonServer : SyphonMetalServer
@end
@implementation AVToolsEmbeddedSyphonServer
- (NSDictionary*)serverDescription {
    NSMutableDictionary* description = [[super serverDescription] mutableCopy];
    description[SyphonServerDescriptionAppNameKey] = @"avTools Embedded";
    return [description autorelease];
}
@end
#define AVTOOLS_SYPHON_SERVER AVToolsEmbeddedSyphonServer
#else
#define AVTOOLS_SYPHON_SERVER SyphonMetalServer
#endif

namespace {
// Encoded work keeps this state (and server) alive through its completion handler.
// Each channel admits at most three outstanding publications; it drops new ones
// when full, without stalling the JavaScript owner or reading pixels on the CPU.
struct ChannelState {
    SyphonMetalServer* server = nil;
    std::atomic<unsigned> inFlight{0}, completed{0}, failed{0};
    ~ChannelState() { [server stop]; [server release]; }
};
class NativeSyphon : public Napi::ObjectWrap<NativeSyphon> {
  public:
    static Napi::Function Define(Napi::Env env) {
        return DefineClass(env, "NativeSyphon", {
            InstanceMethod("publish", &NativeSyphon::Publish),
            InstanceMethod("stats", &NativeSyphon::Stats),
            InstanceMethod("description", &NativeSyphon::Description),
            InstanceMethod("dispose", &NativeSyphon::Dispose),
        });
    }
    NativeSyphon(const Napi::CallbackInfo& info) : Napi::ObjectWrap<NativeSyphon>(info) {
        auto env = info.Env();
#ifndef AVTOOLS_EMBEDDED_SYPHON
        if (!pthread_main_np()) { Error(env, "Syphon channels must be created on the macOS main thread"); return; }
#endif
        // The embedded host owns a dedicated worker and pumps its Cocoa run loop.
        // Upstream SyphonMetalServer explicitly supports access across threads.
        wgpu::interop::Interface<wgpu::interop::GPUDevice> wrapped;
        if (info.Length() != 3 || !info[1].IsString() || !info[2].IsBoolean() ||
            !wgpu::interop::FromJS(env, info[0], wrapped)) {
            Error(env, "Expected (Dawn GPUDevice, name, privateServer)"); return;
        }
        device_ = wrapped.As<wgpu::binding::GPUDevice>()->GetNativeDevice();
        wgpu::AdapterInfo adapterInfo; device_.GetAdapter().GetInfo(&adapterInfo);
        if (adapterInfo.backendType != wgpu::BackendType::Metal) { Error(env, "Syphon requires a Metal device"); return; }
        auto device = dawn::native::metal::ToBackend(dawn::native::FromAPI(device_.Get()));
        if (device->IsLost()) { Error(env, "Syphon device is lost"); return; }
        auto name = info[1].As<Napi::String>().Utf8Value();
        @autoreleasepool {
            NSString* serverName = [NSString stringWithUTF8String:name.c_str()];
            state_ = std::make_shared<ChannelState>();
            state_->server = [[AVTOOLS_SYPHON_SERVER alloc] initWithName:serverName device:device->GetMTLDevice()
                options:@{SyphonServerOptionIsPrivate: @(info[2].As<Napi::Boolean>().Value())}];
        }
        if (!state_->server) { state_.reset(); Error(env, "Could not create Syphon server"); }
    }
  private:
    static void Error(Napi::Env env, const char* message) { Napi::Error::New(env, message).ThrowAsJavaScriptException(); }
    Napi::Value Publish(const Napi::CallbackInfo& info) {
        auto env = info.Env();
        if (!state_) { Error(env, "Syphon channel disposed"); return env.Undefined(); }
        // Syphon's distributed discovery notifications use the Cocoa run loop.
        // Node's libuv loop alone cannot answer a receiver launched later. Pump
        // without waiting, including on no-client frames, before taking GPU locks.
        @autoreleasepool { CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0, true); }
        wgpu::interop::Interface<wgpu::interop::GPUTexture> wrapped;
        if (info.Length() != 3 || !info[1].IsBoolean() || !info[2].IsObject() ||
            !wgpu::interop::FromJS(env, info[0], wrapped)) {
            Error(env, "Expected (GPUTexture, flipped, region)"); return env.Undefined();
        }
        const wgpu::Texture& texture = *wrapped.As<wgpu::binding::GPUTexture>();
        auto base = dawn::native::FromAPI(texture.Get());
        auto device = dawn::native::metal::ToBackend(dawn::native::FromAPI(device_.Get()));
        auto guard = device->GetGuard();
        if (device->IsLost() || base->GetDevice() != device || base->IsError() || base->IsDestroyed()) {
            Error(env, "Texture must be live and belong to this channel's live device"); return env.Undefined();
        }
        const auto format = base->APIGetFormat();
        if (base->APIGetDimension() != wgpu::TextureDimension::e2D || base->APIGetDepthOrArrayLayers() != 1 ||
            base->GetSampleCount() != 1 || (format != wgpu::TextureFormat::RGBA8Unorm && format != wgpu::TextureFormat::BGRA8Unorm) ||
            !(base->GetUsage() & wgpu::TextureUsage::CopySrc) || !(base->GetUsage() & wgpu::TextureUsage::TextureBinding)) {
            Error(env, "Syphon requires single-sample 2D RGBA8/BGRA8 with COPY_SRC and TEXTURE_BINDING usage"); return env.Undefined();
        }
        auto region = info[2].As<Napi::Object>();
        double values[4]; const char* keys[] = {"x", "y", "width", "height"};
        for (int i = 0; i < 4; ++i) {
            auto value = region.Get(keys[i]);
            if (!value.IsNumber()) { Error(env, "Region requires integer x, y, width, height"); return env.Undefined(); }
            values[i] = value.As<Napi::Number>().DoubleValue();
            if (!std::isfinite(values[i]) || std::floor(values[i]) != values[i]) {
                Error(env, "Region values must be finite integers"); return env.Undefined();
            }
        }
        if (values[0] < 0 || values[1] < 0 || values[2] <= 0 || values[3] <= 0 ||
            values[0] + values[2] > base->APIGetWidth() || values[1] + values[3] > base->APIGetHeight()) {
            Error(env, "Region is outside the source texture"); return env.Undefined();
        }
        @autoreleasepool {
            if (![state_->server hasClients]) { noClients_++; return Napi::Boolean::New(env, false); }
            if (state_->inFlight.load() >= 3) { dropped_++; return Napi::Boolean::New(env, false); }
            auto nativeTexture = dawn::native::metal::ToBackend(base);
            auto queue = dawn::native::metal::ToBackend(device->GetQueue());
            auto context = queue->GetPendingCommandContext();
            if (device->ConsumedError(nativeTexture->EnsureSubresourceContentInitialized(context, base->GetAllSubresources()))) {
                Error(env, "Could not initialize Syphon source texture"); return env.Undefined();
            }
            nativeTexture->SynchronizeTextureBeforeUse(context);
            context->EndBlit();
            auto commands = context->GetCommands();
            auto state = state_;
            [state->server publishFrameTexture:nativeTexture->GetMTLTexture(dawn::native::Aspect::Color)
                onCommandBuffer:commands imageRegion:NSMakeRect(values[0], values[1], values[2], values[3])
                flipped:info[1].As<Napi::Boolean>().Value()];
            state->inFlight++;
            [commands addCompletedHandler:^(id<MTLCommandBuffer> buffer) {
                if (buffer.status == MTLCommandBufferStatusError) state->failed++;
                else state->completed++;
                state->inFlight--;
            }];
            // The same Dawn queue orders rendering -> Syphon copy -> later writes.
            // Metal command buffers retain their encoded textures until completion.
            if (device->ConsumedError(queue->SubmitPendingCommandBuffer())) {
                Error(env, "Could not submit Syphon publication"); return env.Undefined();
            }
            published_++;
        }
        return Napi::Boolean::New(env, true);
    }
    Napi::Value Stats(const Napi::CallbackInfo& info) {
        @autoreleasepool { CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0, true); }
        auto result = Napi::Object::New(info.Env());
        result.Set("hasClients", state_ && [state_->server hasClients]);
        result.Set("inFlight", state_ ? state_->inFlight.load() : 0);
        result.Set("completed", state_ ? state_->completed.load() : 0);
        result.Set("failed", state_ ? state_->failed.load() : 0);
        result.Set("published", published_); result.Set("dropped", dropped_); result.Set("noClients", noClients_);
        return result;
    }
    Napi::Value Description(const Napi::CallbackInfo& info) {
        if (!state_) return info.Env().Null();
        @autoreleasepool {
            NSData* json = [NSJSONSerialization dataWithJSONObject:[state_->server serverDescription] options:0 error:nil];
            return Napi::String::New(info.Env(), (const char*)json.bytes, json.length);
        }
    }
    Napi::Value Dispose(const Napi::CallbackInfo& info) {
        state_.reset(); device_ = nullptr; return info.Env().Undefined();
    }
    wgpu::Device device_;
    std::shared_ptr<ChannelState> state_;
    unsigned published_ = 0, dropped_ = 0, noClients_ = 0;
};
}
void InitializeSyphon(Napi::Env env, Napi::Object exports) {
    exports.Set("NativeSyphon", NativeSyphon::Define(env));
}
