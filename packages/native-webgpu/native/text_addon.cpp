#include <node_api.h>
#include "text_engine.h"
#include <cmath>
#include <limits>
#include <memory>
#include <stdexcept>
#include <string>
#include <vector>

namespace {
const napi_type_tag kEngineTag = {0x856c931241254dea, 0xa4915938051ca810};
struct Engine {
    TextEngine* ptr = text_engine_create();
    std::vector<uint8_t> layout = std::vector<uint8_t>(65536);
    ~Engine() { dispose(); }
    void dispose() { if (ptr) text_engine_destroy(ptr); ptr = nullptr; }
};
void check(napi_status status) {
    if (status != napi_ok) throw std::runtime_error("Invalid native text engine argument");
}
uint32_t size32(size_t size) {
    if (size > UINT32_MAX) throw std::range_error("Text engine buffer exceeds 32-bit ABI");
    return static_cast<uint32_t>(size);
}
napi_value property(napi_env env, napi_value obj, const char* key) {
    napi_value value; check(napi_get_named_property(env, obj, key, &value)); return value;
}
std::string string(napi_env env, napi_value value) {
    size_t size; check(napi_get_value_string_utf8(env, value, nullptr, 0, &size));
    std::vector<char> bytes(size + 1);
    check(napi_get_value_string_utf8(env, value, bytes.data(), bytes.size(), &size));
    return {bytes.data(), size};
}
double number(napi_env env, napi_value obj, const char* key) {
    double v; check(napi_get_value_double(env, property(env, obj, key), &v));
    if (!std::isfinite(v) || std::abs(v) > std::numeric_limits<float>::max())
        throw std::range_error(std::string("Invalid text parameter: ") + key);
    return v;
}
uint32_t integer(napi_env env, napi_value obj, const char* key, uint32_t max) {
    double v = number(env, obj, key);
    if (v < 0 || v > max || std::floor(v) != v)
        throw std::range_error(std::string("Invalid integer text parameter: ") + key);
    return static_cast<uint32_t>(v);
}
napi_value undefined(napi_env env) { napi_value v; check(napi_get_undefined(env, &v)); return v; }
void setNumber(napi_env env, napi_value obj, const char* key, double n) {
    napi_value value; check(napi_create_double(env, n, &value));
    check(napi_set_named_property(env, obj, key, value));
}
struct Call { Engine* engine; napi_value argument; };
Call call(napi_env env, napi_callback_info info, bool requireLive = true, size_t expected = 1) {
    size_t argc = 1; napi_value arg, self;
    check(napi_get_cb_info(env, info, &argc, &arg, &self, nullptr));
    if (argc < expected) throw std::invalid_argument("Missing text engine argument");
    bool tagged = false; check(napi_check_object_type_tag(env, self, &kEngineTag, &tagged));
    if (!tagged) throw std::invalid_argument("Invalid text engine receiver");
    Engine* engine; check(napi_unwrap(env, self, reinterpret_cast<void**>(&engine)));
    if (requireLive && !engine->ptr) throw std::runtime_error("Text engine is disposed");
    return {engine, argc ? arg : nullptr};
}
template<napi_value (*F)(napi_env, napi_callback_info)>
napi_value guarded(napi_env env, napi_callback_info info) {
    try { return F(env, info); }
    catch (const std::exception& e) { napi_throw_error(env, nullptr, e.what()); return nullptr; }
}
napi_value construct(napi_env env, napi_callback_info info) {
    napi_value target, self; check(napi_get_new_target(env, info, &target));
    if (!target) throw std::invalid_argument("Use new TextEngine()");
    check(napi_get_cb_info(env, info, nullptr, nullptr, &self, nullptr));
    auto engine = std::make_unique<Engine>();
    if (!engine->ptr) throw std::runtime_error("Could not create Rust text engine");
    check(napi_type_tag_object(env, self, &kEngineTag));
    check(napi_wrap(env, self, engine.get(), [](napi_env, void* p, void*) {
        delete static_cast<Engine*>(p);
    }, nullptr, nullptr));
    engine.release(); return self;
}
napi_value dispose(napi_env env, napi_callback_info info) {
    call(env, info, false, 0).engine->dispose(); return undefined(env);
}
napi_value load(napi_env env, napi_callback_info info) {
    auto c = call(env, info);
    napi_typedarray_type type; size_t length, offset; void* data; napi_value buffer;
    check(napi_get_typedarray_info(env, c.argument, &type, &length, &data, &buffer, &offset));
    if (type != napi_uint8_array) throw std::invalid_argument("Font bytes must be Uint8Array");
    bool ok = length && text_engine_load_font_bytes(c.engine->ptr, static_cast<uint8_t*>(data), size32(length));
    napi_value result; check(napi_get_boolean(env, ok, &result)); return result;
}
napi_value layout(napi_env env, napi_callback_info info) {
    auto c = call(env, info); auto arg = c.argument;
    auto text = string(env, property(env, arg, "text"));
    auto family = string(env, property(env, arg, "family"));
    auto axes = string(env, property(env, arg, "axesJson"));
    float size = number(env, arg, "fontSize"), line = number(env, arg, "lineHeight");
    float width = number(env, arg, "width"), height = number(env, arg, "height");
    auto align = integer(env, arg, "alignH", 2), wrap = integer(env, arg, "wrapMode", 2);
    auto weight = integer(env, arg, "weight", 1000), style = integer(env, arg, "style", 2);
    auto quantization = number(env, arg, "axisQuantization");
    auto disable = integer(env, arg, "disableLigatures", 1);
    auto run = [&] {
        return text_engine_layout_json(c.engine->ptr,
            reinterpret_cast<const uint8_t*>(text.data()), size32(text.size()),
            reinterpret_cast<const uint8_t*>(family.data()), size32(family.size()),
            size, line, width, height, align, wrap, weight, style, quantization,
            reinterpret_cast<const uint8_t*>(axes.data()), size32(axes.size()), disable,
            c.engine->layout.data(), size32(c.engine->layout.size()));
    };
    uint32_t needed = run();
    if (needed > c.engine->layout.size()) { c.engine->layout.resize(needed); needed = run(); }
    if (needed > c.engine->layout.size()) throw std::runtime_error("Text layout size changed unexpectedly");
    napi_value result; check(napi_create_buffer_copy(env, needed, c.engine->layout.data(), nullptr, &result));
    return result;
}
napi_value rasterize(napi_env env, napi_callback_info info) {
    auto c = call(env, info); uint64_t key; bool lossless;
    check(napi_get_value_bigint_uint64(env, c.argument, &key, &lossless));
    if (!lossless) throw std::range_error("Glyph key must be an unsigned 64-bit bigint");
    uint32_t width, height, content; int32_t left, top;
    uint32_t needed = text_engine_rasterize_glyph(c.engine->ptr, key, nullptr, 0,
        &width, &height, &left, &top, &content);
    if (!needed) { napi_value result; check(napi_get_null(env, &result)); return result; }
    void* data; napi_value bytes;
    check(napi_create_buffer(env, needed, &data, &bytes));
    uint32_t written = text_engine_rasterize_glyph(c.engine->ptr, key, static_cast<uint8_t*>(data), needed,
        &width, &height, &left, &top, &content);
    if (written != needed) throw std::runtime_error("Glyph raster size changed unexpectedly");
    napi_value result; check(napi_create_object(env, &result));
    setNumber(env, result, "width", width); setNumber(env, result, "height", height);
    setNumber(env, result, "left", left); setNumber(env, result, "top", top);
    setNumber(env, result, "contentType", content);
    check(napi_set_named_property(env, result, "pixels", bytes)); return result;
}
napi_value init(napi_env env, napi_value exports) {
    napi_property_descriptor props[] = {
        {"dispose", nullptr, guarded<dispose>, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"loadFontBytes", nullptr, guarded<load>, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"layout", nullptr, guarded<layout>, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"rasterizeGlyph", nullptr, guarded<rasterize>, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_value cls;
    if (napi_define_class(env, "TextEngine", NAPI_AUTO_LENGTH, guarded<construct>, nullptr,
        4, props, &cls) != napi_ok) return nullptr;
    if (napi_set_named_property(env, exports, "TextEngine", cls) != napi_ok) return nullptr;
    return exports;
}
}
#ifdef AVTOOLS_EMBEDDED
napi_value InitializeAvToolsText(napi_env env, napi_value exports) { return init(env, exports); }
#else
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
#endif
