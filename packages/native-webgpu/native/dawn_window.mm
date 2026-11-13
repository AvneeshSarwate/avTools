#import <Cocoa/Cocoa.h>
#import <QuartzCore/CAMetalLayer.h>
#include <pthread.h>
#include <cmath>
#include <vector>
#include "src/dawn/node/binding/GPUDevice.h"
#include "src/dawn/node/binding/GPUTexture.h"
#include "src/dawn/node/interop/Core.h"

extern "C" {
void* create_window(uint32_t, uint32_t, const uint8_t*, uint32_t);
uintptr_t get_raw_window_handle(void*);
void set_window_deferred_close(void*, uint32_t);
uint32_t window_should_close(void*);
uint32_t poll_events(void*, uint8_t*, uint32_t);
void get_window_size(void*, uint32_t*, uint32_t*);
void resize_window(void*, uint32_t, uint32_t);
void destroy_window(void*);
}

namespace {
class NativeWindow : public Napi::ObjectWrap<NativeWindow> {
  public:
    static Napi::Function Define(Napi::Env env) {
        return DefineClass(env, "NativeWindow", {
            InstanceMethod("poll", &NativeWindow::Poll),
            InstanceMethod("acquire", &NativeWindow::Acquire),
            InstanceMethod("present", &NativeWindow::Present),
            InstanceMethod("discard", &NativeWindow::Discard),
            InstanceMethod("resize", &NativeWindow::Resize),
            InstanceMethod("setVisible", &NativeWindow::SetVisible),
            InstanceMethod("setMinimized", &NativeWindow::SetMinimized),
            InstanceMethod("dispose", &NativeWindow::Dispose),
        });
    }
    NativeWindow(const Napi::CallbackInfo& info) : Napi::ObjectWrap<NativeWindow>(info) {
        auto env = info.Env();
        if (!Main(env)) return;
        wgpu::interop::Interface<wgpu::interop::GPUDevice> device;
        if (info.Length() != 2 || !info[1].IsObject() || !wgpu::interop::FromJS(env, info[0], device)) {
            Error(env, "Expected (Dawn GPUDevice, {width, height, title})"); return;
        }
        device_ = device.As<wgpu::binding::GPUDevice>()->GetNativeDevice();
        auto options = info[1].As<Napi::Object>();
        auto w = options.Get("width"), h = options.Get("height"), title = options.Get("title");
        if (!Dimension(w) || !Dimension(h) || !title.IsString()) {
            Error(env, "Window dimensions must be positive integers <= 16384 and title a string"); return;
        }
        auto name = title.As<Napi::String>().Utf8Value();
        window_ = create_window(w.As<Napi::Number>().Uint32Value(), h.As<Napi::Number>().Uint32Value(),
            reinterpret_cast<const uint8_t*>(name.data()), name.size());
        if (!window_) { Error(env, "Could not create native window"); return; }
        set_window_deferred_close(window_, 1);
        view_ = [(NSView*)get_raw_window_handle(window_) retain];
        if (!view_ || ![[view_ layer] isKindOfClass:[CAMetalLayer class]]) {
            Close(); Error(env, "Native window did not provide a CAMetalLayer"); return;
        }
        layer_ = [(CAMetalLayer*)[view_ layer] retain];
        layer_.allowsNextDrawableTimeout = YES;
        adapter_ = device_.GetAdapter(); instance_ = adapter_.GetInstance();
        CreateSurface();
        wgpu::SurfaceCapabilities caps;
        if (surface_.GetCapabilities(adapter_, &caps) != wgpu::Status::Success) {
            Close(); Error(env, "Adapter cannot present to this native surface"); return;
        }
        for (auto candidate : {wgpu::TextureFormat::BGRA8Unorm, wgpu::TextureFormat::RGBA8Unorm}) {
            for (size_t i = 0; i < caps.formatCount; ++i) if (caps.formats[i] == candidate) format_ = candidate;
            if (format_ != wgpu::TextureFormat::Undefined) break;
        }
        if (format_ == wgpu::TextureFormat::Undefined || !(caps.usages & wgpu::TextureUsage::RenderAttachment)) {
            Close(); Error(env, "Surface requires a supported RGBA8/BGRA8 render attachment"); return;
        }
        for (size_t i = 0; i < caps.presentModeCount; ++i)
            if (caps.presentModes[i] == wgpu::PresentMode::Mailbox) presentMode_ = wgpu::PresentMode::Mailbox;
        alphaMode_ = caps.alphaModeCount ? caps.alphaModes[0] : wgpu::CompositeAlphaMode::Auto;
    }
    ~NativeWindow() override { Close(); }
  private:
    static void Error(Napi::Env env, const char* message) { Napi::Error::New(env, message).ThrowAsJavaScriptException(); }
    static bool Main(Napi::Env env) {
        if (pthread_main_np()) return true;
        Error(env, "Native windows must be owned by the macOS main thread"); return false;
    }
    static bool Dimension(Napi::Value value) {
        if (!value.IsNumber()) return false;
        auto n = value.As<Napi::Number>().DoubleValue(); return n >= 1 && n <= 16384 && std::floor(n) == n;
    }
    void CreateSurface() {
        wgpu::SurfaceSourceMetalLayer metal; metal.layer = layer_;
        wgpu::SurfaceDescriptor desc; desc.nextInChain = &metal;
        surface_ = instance_.CreateSurface(&desc); configured_ = false;
    }
    void DropFrame() { frameObject_.Reset(); frame_ = nullptr; }
    void Close() {
        DropFrame();
        if (surface_ && configured_) surface_.Unconfigure();
        surface_ = nullptr; configured_ = false;
        [layer_ release]; layer_ = nil;
        [view_ release]; view_ = nil;
        if (window_) destroy_window(window_);
        window_ = nullptr;
        device_ = nullptr; adapter_ = nullptr; instance_ = nullptr;
    }
    Napi::Value Poll(const Napi::CallbackInfo& info) {
        auto env = info.Env(); if (!Main(env)) return env.Undefined();
        if (!window_) return Napi::String::New(env, "[]");
        std::vector<uint8_t> bytes(1024 * 1024);
        auto length = poll_events(window_, bytes.data(), bytes.size());
        if (window_should_close(window_)) Close();
        return Napi::String::New(env, length ? reinterpret_cast<const char*>(bytes.data()) : "[]", length ? length : 2);
    }
    Napi::Value Acquire(const Napi::CallbackInfo& info) {
        auto env = info.Env(); if (!Main(env)) return env.Undefined();
        if (!window_ || window_should_close(window_)) return env.Null();
        if (frame_) return frameObject_.Value();
        NSWindow* window = [view_ window];
        if (getenv("AVTOOLS_WINDOW_DEBUG") && debugFrames_++ < 3)
            fprintf(stderr, "window visible=%d minimized=%d occlusion=%lu size=%gx%g\n", [window isVisible], [window isMiniaturized], (unsigned long)[window occlusionState], layer_.bounds.size.width, layer_.bounds.size.height);
        if (!window || ![window isVisible] || [window isMiniaturized] ||
            !([window occlusionState] & NSWindowOcclusionStateVisible)) return env.Null();
        uint32_t w = 0, h = 0; get_window_size(window_, &w, &h);
        if (!w || !h) return env.Null();
        if (!configured_ || w != width_ || h != height_) {
            if (configured_) surface_.Unconfigure();
            wgpu::SurfaceConfiguration config;
            config.device = device_; config.format = format_; config.width = w; config.height = h;
            config.presentMode = presentMode_; config.alphaMode = alphaMode_;
            surface_.Configure(&config); configured_ = true; width_ = w; height_ = h;
        }
        wgpu::SurfaceTexture acquired; surface_.GetCurrentTexture(&acquired);
        switch (acquired.status) {
            case wgpu::SurfaceGetCurrentTextureStatus::SuccessOptimal:
            case wgpu::SurfaceGetCurrentTextureStatus::SuccessSuboptimal: break;
            case wgpu::SurfaceGetCurrentTextureStatus::Timeout: return env.Null();
            case wgpu::SurfaceGetCurrentTextureStatus::Outdated:
                surface_.Unconfigure(); configured_ = false; return env.Null();
            case wgpu::SurfaceGetCurrentTextureStatus::Lost:
                surface_.Unconfigure(); CreateSurface(); return env.Null();
            default: Error(env, "Native surface acquisition failed (check device loss)"); return env.Null();
        }
        frame_ = acquired.texture;
        wgpu::TextureDescriptor desc; desc.size = {width_, height_, 1}; desc.format = format_;
        desc.usage = wgpu::TextureUsage::RenderAttachment;
        auto texture = wgpu::interop::GPUTexture::Create<wgpu::binding::GPUTexture>(env, device_, desc, frame_);
        auto result = Napi::Object::New(env); result.Set("texture", static_cast<const Napi::Value&>(texture));
        result.Set("width", width_); result.Set("height", height_);
        result.Set("format", format_ == wgpu::TextureFormat::BGRA8Unorm ? "bgra8unorm" : "rgba8unorm");
        frameObject_ = Napi::Persistent(result); return result;
    }
    Napi::Value Present(const Napi::CallbackInfo& info) {
        auto env = info.Env(); if (!Main(env)) return env.Undefined();
        if (frame_) {
            auto status = surface_.Present(); DropFrame();
            if (status != wgpu::Status::Success) Error(env, "Native surface presentation failed");
        }
        return env.Undefined();
    }
    Napi::Value Discard(const Napi::CallbackInfo& info) {
        if (!Main(info.Env())) return info.Env().Undefined();
        DropFrame(); if (surface_ && configured_) surface_.Unconfigure(); configured_ = false;
        return info.Env().Undefined();
    }
    Napi::Value Resize(const Napi::CallbackInfo& info) {
        auto env = info.Env(); if (!Main(env)) return env.Undefined();
        if (info.Length() != 2 || !Dimension(info[0]) || !Dimension(info[1])) {
            Error(env, "Resize dimensions must be positive integers <= 16384"); return env.Undefined();
        }
        if (window_) resize_window(window_, info[0].As<Napi::Number>().Uint32Value(), info[1].As<Napi::Number>().Uint32Value());
        return env.Undefined();
    }
    Napi::Value SetVisible(const Napi::CallbackInfo& info) {
        auto env = info.Env(); if (!Main(env)) return env.Undefined();
        if (info.Length() != 1 || !info[0].IsBoolean()) { Error(env, "Expected visible boolean"); return env.Undefined(); }
        if (view_) { if (info[0].As<Napi::Boolean>().Value()) [[view_ window] orderFront:nil]; else [[view_ window] orderOut:nil]; }
        return env.Undefined();
    }
    Napi::Value SetMinimized(const Napi::CallbackInfo& info) {
        auto env = info.Env(); if (!Main(env)) return env.Undefined();
        if (info.Length() != 1 || !info[0].IsBoolean()) { Error(env, "Expected minimized boolean"); return env.Undefined(); }
        if (view_) { if (info[0].As<Napi::Boolean>().Value()) [[view_ window] miniaturize:nil]; else [[view_ window] deminiaturize:nil]; }
        return env.Undefined();
    }
    Napi::Value Dispose(const Napi::CallbackInfo& info) {
        if (Main(info.Env())) Close(); return info.Env().Undefined();
    }
    void* window_ = nullptr;
    NSView* view_ = nil;
    CAMetalLayer* layer_ = nil;
    wgpu::Device device_;
    wgpu::Adapter adapter_;
    wgpu::Instance instance_;
    wgpu::Surface surface_;
    wgpu::Texture frame_;
    Napi::ObjectReference frameObject_;
    wgpu::TextureFormat format_ = wgpu::TextureFormat::Undefined;
    wgpu::PresentMode presentMode_ = wgpu::PresentMode::Fifo;
    wgpu::CompositeAlphaMode alphaMode_ = wgpu::CompositeAlphaMode::Auto;
    uint32_t width_ = 0, height_ = 0;
    bool configured_ = false;
    unsigned debugFrames_ = 0;
};
}
void InitializeSyphon(Napi::Env env, Napi::Object exports);
void InitializeAvTools(Napi::Env env, Napi::Object exports) {
    InitializeSyphon(env, exports);
    exports.Set("NativeWindow", NativeWindow::Define(env));
}
