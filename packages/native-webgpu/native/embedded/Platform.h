#pragma once
// Small OS boundary for the TD plugins and embedded runtime. Everything that
// differs between macOS and Windows module loading, Python symbol lookup and
// entropy lives here; callers stay platform-neutral.
#include <algorithm>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <iterator>
#include <stdexcept>
#include <string>
#include <string_view>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <bcrypt.h>
#include <psapi.h>
#include <cwctype>
#include <vector>
#pragma comment(lib, "bcrypt.lib")
#else
#include <dlfcn.h>
#ifdef __APPLE__
#include <Security/SecRandom.h>
#endif
#endif

namespace avtools::platform {

#ifdef _WIN32
inline HMODULE moduleFor(const void* address) {
  HMODULE module = nullptr;
  GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                     reinterpret_cast<LPCWSTR>(address), &module);
  return module;
}
#endif

// Full path of the binary (plugin DLL / bundle executable / dylib) containing address.
inline std::filesystem::path modulePath(const void* address) {
#ifdef _WIN32
  HMODULE module = moduleFor(address);
  if (!module) return {};
  std::wstring buffer(MAX_PATH, L'\0');
  for (;;) {
    DWORD n = GetModuleFileNameW(module, buffer.data(), static_cast<DWORD>(buffer.size()));
    if (n == 0) return {};
    if (n < buffer.size()) { buffer.resize(n); return std::filesystem::path(buffer); }
    buffer.resize(buffer.size() * 2);
  }
#else
  Dl_info info{};
  if (!dladdr(address, &info) || !info.dli_fname) return {};
  return std::filesystem::path(info.dli_fname);
#endif
}

#ifdef _WIN32
// Resource IDs written by scripts/build-td-plugin.mjs into the operator DLL.
constexpr int kResourceBlob = 101;  // "AVR1" archive of the Resources directory
constexpr int kResourceHash = 102;  // ASCII sha256 of the blob (cache key)

inline std::string_view moduleResource(HMODULE module, int id) {
  // MAKEINTRESOURCEW, spelled out: Chromium's trimmed <windows.h> omits winuser macros.
  auto integer = [](int value) { return reinterpret_cast<LPCWSTR>(static_cast<ULONG_PTR>(static_cast<WORD>(value))); };
  HRSRC found = FindResourceW(module, integer(id), integer(10) /* RT_RCDATA */);
  HGLOBAL loaded = found ? LoadResource(module, found) : nullptr;
  const void* data = loaded ? LockResource(loaded) : nullptr;
  return data ? std::string_view(static_cast<const char*>(data), SizeofResource(module, found)) : std::string_view{};
}

// Unpack an "AVR1" archive: u32 count, then per entry u32 pathLength, UTF-8
// relative path ('/' separators), u64 size, bytes. Rejects absolute/.. paths.
inline void unpackResources(std::string_view blob, const std::filesystem::path& into) {
  size_t at = 0;
  auto take = [&](size_t n) {
    if (blob.size() - at < n) throw std::runtime_error("Corrupt embedded resources");
    auto part = blob.substr(at, n); at += n; return part;
  };
  auto u32 = [&] { uint32_t v; std::memcpy(&v, take(4).data(), 4); return v; };
  auto u64 = [&] { uint64_t v; std::memcpy(&v, take(8).data(), 8); return v; };
  if (take(4) != "AVR1") throw std::runtime_error("Unknown embedded resource format");
  for (uint32_t i = 0, n = u32(); i < n; ++i) {
    auto name = take(u32());
    if (name.empty() || name.front() == '/' || name.find("..") != std::string_view::npos || name.find(':') != std::string_view::npos)
      throw std::runtime_error("Invalid embedded resource path");
    auto bytes = take(size_t(u64()));
    int wn = MultiByteToWideChar(CP_UTF8, 0, name.data(), int(name.size()), nullptr, 0);
    std::wstring wide(wn, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, name.data(), int(name.size()), wide.data(), wn);
    auto path = into / std::filesystem::path(wide);
    std::filesystem::create_directories(path.parent_path());
    HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr);
    DWORD written = 0;
    bool ok = file != INVALID_HANDLE_VALUE && WriteFile(file, bytes.data(), DWORD(bytes.size()), &written, nullptr) &&
              written == bytes.size();
    if (file != INVALID_HANDLE_VALUE) CloseHandle(file);
    if (!ok) throw std::runtime_error("Cannot write embedded resources");
  }
}

// Narrow strings cross into code that treats them as the ANSI code page. Prefer
// the 8.3 short form of a path that is not plain ASCII (e.g. a non-ASCII user name).
inline std::filesystem::path asciiSafe(const std::filesystem::path& path) {
  const auto& text = path.native();
  if (std::all_of(text.begin(), text.end(), [](wchar_t c) { return c < 128; })) return path;
  wchar_t buffer[MAX_PATH * 2];
  DWORD n = GetShortPathNameW(text.c_str(), buffer, DWORD(std::size(buffer)));
  return n && n < std::size(buffer) ? std::filesystem::path(buffer) : path;
}

// Extract once per content hash; concurrent TOP/CHOP loads and TD processes race
// safely: each writes a private temp directory, then one atomic rename wins.
inline std::filesystem::path extractedResources(HMODULE module, const std::filesystem::path& binary) {
  auto blob = moduleResource(module, kResourceBlob);
  auto hash = moduleResource(module, kResourceHash);
  if (blob.empty() || hash.size() < 16) throw std::runtime_error("Plugin has no embedded resources; rebuild it with build-td-plugin.mjs");
  wchar_t local[MAX_PATH * 2];
  DWORD n = GetEnvironmentVariableW(L"LOCALAPPDATA", local, DWORD(std::size(local)));
  if (!n || n >= std::size(local)) throw std::runtime_error("LOCALAPPDATA is unavailable");
  auto base = asciiSafe(std::filesystem::path(local)) / L"avTools" / L"resources";
  std::filesystem::create_directories(base);
  auto final = base / (binary.stem().native() + L"-" + std::wstring(hash.begin(), hash.begin() + 16));
  if (std::filesystem::exists(final / L".complete")) return final;
  auto temp = base / (final.filename().native() + L".tmp-" + std::to_wstring(GetCurrentProcessId()) + L"-" +
                      std::to_wstring(GetCurrentThreadId()));
  std::error_code ignored;
  std::filesystem::remove_all(temp, ignored);
  std::filesystem::create_directories(temp);
  unpackResources(blob, temp);
  CloseHandle(CreateFileW((temp / L".complete").c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, 0, nullptr));
  if (!MoveFileExW(temp.c_str(), final.c_str(), 0)) {
    std::filesystem::remove_all(temp, ignored);
    if (!std::filesystem::exists(final / L".complete")) {
      // A previous crash left an incomplete directory: replace it.
      std::filesystem::remove_all(final, ignored);
      std::filesystem::create_directories(temp);
      unpackResources(blob, temp);
      CloseHandle(CreateFileW((temp / L".complete").c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, 0, nullptr));
      if (!MoveFileExW(temp.c_str(), final.c_str(), 0) && !std::filesystem::exists(final / L".complete"))
        throw std::runtime_error("Cannot install embedded resources");
      std::filesystem::remove_all(temp, ignored);
    }
  }
  return final;
}
#endif

// Directory of runtime resources (renderer.js/chop.js, fonts, DeclaredParameters.py)
// for the plugin binary containing `address`.
// macOS: <bundle>.plugin/Contents/MacOS/<binary> -> Contents/Resources.
// Windows: a single self-contained DLL. A developer `<Dll>-resources` folder
// beside it wins; otherwise the embedded archive is extracted to
// %LOCALAPPDATA%\avTools\resources\<Dll>-<hash> (see plans/windows-build-plan.md).
inline std::filesystem::path pluginResources(const void* address) {
  auto binary = modulePath(address);
  if (binary.empty()) throw std::runtime_error("Cannot locate plugin binary");
#ifdef _WIN32
  auto beside = binary.parent_path() / (binary.stem().native() + L"-resources");
  if (std::filesystem::is_directory(beside)) return asciiSafe(beside);
  return extractedResources(moduleFor(address), binary);
#else
  return binary.parent_path().parent_path() / "Resources";
#endif
}

// Keep the module containing address loaded for the process lifetime. V8's
// platform and Rayon's worker threads outlive any single operator instance.
inline bool pinModule(const void* address) {
#ifdef _WIN32
  HMODULE module = nullptr;
  return GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
                            reinterpret_cast<LPCWSTR>(address), &module) != 0;
#else
  auto path = modulePath(address);
  return !path.empty() && dlopen(path.c_str(), RTLD_NOW | RTLD_LOCAL | RTLD_NODELETE) != nullptr;
#endif
}

#ifdef _WIN32
// TD hosts one CPython (python311.dll in TD 2025). Find it among loaded modules
// rather than hard-coding a version, so a future TD Python upgrade keeps working.
inline HMODULE pythonModule() {
  static HMODULE cached = [] () -> HMODULE {
    std::vector<HMODULE> modules(512);
    DWORD needed = 0;
    HANDLE process = GetCurrentProcess();
    if (!K32EnumProcessModules(process, modules.data(), static_cast<DWORD>(modules.size() * sizeof(HMODULE)), &needed))
      return nullptr;
    modules.resize(std::min<size_t>(modules.size(), needed / sizeof(HMODULE)));
    for (HMODULE module : modules) {
      wchar_t name[MAX_PATH];
      if (!K32GetModuleBaseNameW(process, module, name, MAX_PATH)) continue;
      std::wstring lower(name);
      for (auto& c : lower) c = static_cast<wchar_t>(std::towlower(c));
      // python3XY.dll (not the python3.dll stable-ABI forwarder, not pythonw).
      if (lower.size() > 11 && lower.rfind(L"python3", 0) == 0 && lower.substr(lower.size() - 4) == L".dll" &&
          GetProcAddress(module, "PyGILState_Ensure"))
        return module;
    }
    return nullptr;
  }();
  return cached;
}
#endif

// Resolve a symbol from the host process's already-loaded Python runtime.
inline void* hostSymbol(const char* name) {
#ifdef _WIN32
  HMODULE python = pythonModule();
  return python ? reinterpret_cast<void*>(GetProcAddress(python, name)) : nullptr;
#else
  return dlsym(RTLD_DEFAULT, name);
#endif
}

inline bool secureRandom(void* out, size_t size) {
#ifdef _WIN32
  return BCryptGenRandom(nullptr, static_cast<PUCHAR>(out), static_cast<ULONG>(size),
                         BCRYPT_USE_SYSTEM_PREFERRED_RNG) == 0;
#elif defined(__APPLE__)
  return SecRandomCopyBytes(kSecRandomDefault, size, out) == errSecSuccess;
#else
#error "secureRandom: unsupported platform"
#endif
}

}  // namespace avtools::platform
