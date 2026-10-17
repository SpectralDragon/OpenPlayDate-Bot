// libstdc++ supplies the C99 limits absent from this toolchain's C++ limits.h.
#include <climits>
extern "C" {
#include <lua.h>
#include <lauxlib.h>
#include <lualib.h>
}
#include "lua_app.h"
#include "lua_video.h"
#include "lua_audio.h"
#include "ui_text.h"
#include <esp_heap_caps.h>
#include <algorithm>
#include <cstring>

namespace {
constexpr size_t memoryLimit = 512 * 1024;
constexpr size_t imageCacheLimit = 256 * 1024;
enum Operation {
  Clear, Color, Pixel, Line, Rect, FillRect, Circle, FillCircle, Text, Image, Rgb,
  Down, Pressed, Released, Axis, Millis, Exit, Log, ReadAsset, Require,
  GpioMode, GpioRead, GpioWrite, UartOpen, UartRead, UartWrite, UartAvailable,
  AudioPlay, AudioStop
};
struct Binding { const char* name; Operation op; };
const Binding graphics[] = {{"clear", Clear}, {"color", Color}, {"pixel", Pixel}, {"line", Line},
  {"rect", Rect}, {"fillRect", FillRect}, {"circle", Circle}, {"fillCircle", FillCircle},
  {"text", Text}, {"image", Image}, {"rgb", Rgb}};
const Binding input[] = {{"down", Down}, {"pressed", Pressed}, {"released", Released}, {"axis", Axis}};
const Binding systemApi[] = {{"millis", Millis}, {"exit", Exit}, {"log", Log}};
const Binding assets[] = {{"read", ReadAsset}};
const Binding audio[] = {{"play", AudioPlay}, {"stop", AudioStop}};
const Binding gpio[] = {{"mode", GpioMode}, {"read", GpioRead}, {"write", GpioWrite}};
const Binding uart[] = {{"open", UartOpen}, {"read", UartRead}, {"write", UartWrite}, {"available", UartAvailable}};
// int32 arguments are narrowed only after validation, avoiding wrapped coordinates.
int integer(lua_State* state, int index, int low, int high) {
  lua_Integer value = luaL_checkinteger(state, index);
  luaL_argcheck(state, value >= low && value <= high, index, "out of range");
  return int(value);
}
int coordinate(lua_State* state, int index) { return integer(state, index, -1024, 1024); }
int button(lua_State* state) {
  const char* names[] = {"a", "b", "stick", "left", "right", "up", "down", nullptr};
  return 1 << luaL_checkoption(state, 1, nullptr, names);
}
}

void* LuaApp::allocate(void* user, void* pointer, size_t oldSize, size_t newSize) {
  auto& app = *static_cast<LuaApp*>(user);
  if (!pointer) oldSize = 0; // Lua uses osize as a type tag for new objects.
  if (!newSize) { free(pointer); app.memory_ -= oldSize; return nullptr; }
  if (newSize > memoryLimit || app.memory_ - oldSize > memoryLimit - newSize) return nullptr;
  void* result = heap_caps_realloc(pointer, newSize, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
  if (result) app.memory_ = app.memory_ - oldSize + newSize;
  return result;
}

void LuaApp::beginBudget() {
  callbackAt_ = millis(); instructions_ = 0; logBytes_ = 0;
  lua_sethook(state_, hook, LUA_MASKCOUNT, 1000);
}

void LuaApp::hook(lua_State* state, lua_Debug*) {
  auto* app = *static_cast<LuaApp**>(lua_getextraspace(state));
  app->instructions_ += 1000;
  if (app->instructions_ >= 200000 || uint32_t(millis() - app->callbackAt_) >= 40)
    luaL_error(state, "callback budget exceeded; return from update each frame");
}

int LuaApp::loadScript(lua_State* state, const opd::Entry& entry) {
  struct Reader {
    opd::Bundle* bundle;
    const opd::Entry* entry;
    size_t offset;
    char buffer[512];
    bool failed;
  } reader{&bundle_, &entry, 0, {}, false};
  char chunk[opd::maxPath + 2];
  snprintf(chunk, sizeof(chunk), "@%s", entry.path.c_str());
  int result = lua_load(state, [](lua_State*, void* user, size_t* size) -> const char* {
    auto& r = *static_cast<Reader*>(user);
    *size = std::min(sizeof(r.buffer), size_t(r.entry->size) - r.offset);
    if (!*size) return nullptr;
    if (!r.bundle->read(*r.entry, r.offset, r.buffer, *size)) {
      r.failed = true; *size = 0; return nullptr;
    }
    r.offset += *size;
    return r.buffer;
  }, &reader, chunk, "t");
  if (reader.failed) return luaL_error(state, "bundle read failed");
  if (result != LUA_OK) return lua_error(state);
  return 1;
}

int LuaApp::boot(lua_State* state) {
  auto* app = static_cast<LuaApp*>(lua_touserdata(state, 1));
  const luaL_Reg libraries[] = {{"_G", luaopen_base}, {LUA_TABLIBNAME, luaopen_table},
    {LUA_STRLIBNAME, luaopen_string}, {LUA_MATHLIBNAME, luaopen_math}, {LUA_UTF8LIBNAME, luaopen_utf8}, {nullptr, nullptr}};
  for (const luaL_Reg* lib = libraries; lib->name; ++lib) {
    luaL_requiref(state, lib->name, lib->func, 1); lua_pop(state, 1);
  }
  // No host filesystem, native modules, bytecode, coroutines or protected calls
  // that could swallow the instruction-budget exception and loop forever.
  // Metatables can install __gc/__close callbacks that run while hooks are
  // disabled in Lua's cleanup paths. Keep those paths host-owned in API 1.
  for (const char* name : {"load", "loadfile", "dofile", "pcall", "xpcall", "print", "setmetatable", "getmetatable"}) {
    lua_pushnil(state); lua_setglobal(state, name);
  }
  lua_newtable(state);
  auto bind = [state, app](const char* name, const Binding* bindings, size_t count) {
    lua_newtable(state);
    for (size_t i = 0; i < count; ++i) {
      lua_pushlightuserdata(state, app); lua_pushinteger(state, bindings[i].op);
      lua_pushcclosure(state, api, 2); lua_setfield(state, -2, bindings[i].name);
    }
    lua_setfield(state, -2, name);
  };
  bind("graphics", graphics, sizeof(graphics) / sizeof(*graphics));
  bind("input", input, sizeof(input) / sizeof(*input));
  bind("system", systemApi, sizeof(systemApi) / sizeof(*systemApi));
  bind("assets", assets, sizeof(assets) / sizeof(*assets));
  bind("audio", audio, sizeof(audio) / sizeof(*audio));
  lua_getfield(state,-1,"audio"); lua_pushboolean(state,openplayaudio::available); lua_setfield(state,-2,"available"); lua_pop(state,1);
  if (app->bundle_.manifest().kind == "robot") {
    bind("gpio", gpio, sizeof(gpio) / sizeof(*gpio));
    bind("uart", uart, sizeof(uart) / sizeof(*uart));
  }
  lua_pushinteger(state, 1); lua_setfield(state, -2, "apiVersion");
  lua_pushinteger(state, 320); lua_setfield(state, -2, "width");
  lua_pushinteger(state, 240); lua_setfield(state, -2, "height");
  lua_setglobal(state, "opd");
  lua_pushlightuserdata(state, app); lua_pushinteger(state, Require);
  lua_pushcclosure(state, api, 2); lua_setglobal(state, "require");
  app->loadScript(state, *app->bundle_.find(app->bundle_.manifest().entry));
  lua_call(state, 0, 1);
  if (!lua_istable(state, -1)) return luaL_error(state, "entry must return an application table");
  app->appRef_ = luaL_ref(state, LUA_REGISTRYINDEX);
  return 0;
}

bool LuaApp::start(const String& name) {
  stop(); error_ = ""; exit_ = false; paused_ = false;
  video_ = VideoStats{};
  sampleAt_ = millis(); sampleFrames_ = sampleDisplayed_ = 0;
  down_ = pressed_ = released_ = 0;
  memset(pinModes_, -1, sizeof(pinModes_));
  if (opd::safeName(name).isEmpty()) { error_ = "Неверное имя .opd"; return false; }
  if (!bundle_.open("/apps/" + name)) { error_ = bundle_.error(); return false; }
  canvas_.setColorDepth(16); canvas_.setAttribute(PSRAM_ENABLE, true);
  if (!canvas_.createSprite(320, 240)) { error_ = "Не хватает памяти экрана"; bundle_.close(); return false; }
  canvas_.fillSprite(TFT_BLACK); canvas_.setTextColor(TFT_WHITE, TFT_BLACK);
  // Optional: retain the original full-frame path if PSRAM is exhausted.
  presented_ = static_cast<uint16_t*>(heap_caps_malloc(luavideo::frameBytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  presentedValid_ = false;
  state_ = lua_newstate(allocate, this);
  if (!state_) { error_ = "Не хватает памяти Lua"; stop(); return false; }
  *static_cast<LuaApp**>(lua_getextraspace(state_)) = this;
  beginBudget();
  lua_pushcfunction(state_, boot); lua_pushlightuserdata(state_, this);
  if (lua_pcall(state_, 1, 0, 0) != LUA_OK) { fail(); return false; }
  if (!invoke("init")) return false;
  nextFrame_ = lastFrame_ = millis();
  sampleAt_ = lastFrame_;
  return true;
}

void LuaApp::releaseHardware() {
  if (uartOpen_) { uart_.end(); uartOpen_ = false; }
  for (int pin : bundle_.manifest().gpio) {
    if (pinModes_[pin] == OUTPUT) digitalWrite(pin, LOW);
    if (pinModes_[pin] != -1) pinMode(pin, INPUT);
    pinModes_[pin] = -1;
  }
  if (bundle_.manifest().uartTx >= 0) {
    pinMode(bundle_.manifest().uartTx, INPUT); pinMode(bundle_.manifest().uartRx, INPUT);
  }
}

void LuaApp::releaseGraphics() {
  free(presented_); presented_ = nullptr; presentedValid_ = false;
  for (auto& image : images_) { free(image.pixels); image = CachedImage{}; }
  imageBytes_ = 0; imageUse_ = 0;
  canvas_.deleteSprite();
}

void LuaApp::present() {
  if (!presented_) {
    canvas_.pushSprite(0, 0); ++video_.displayed; video_.bytes += luavideo::frameBytes;
    return;
  }
  const auto* frame = static_cast<const uint16_t*>(canvas_.getPointer());
  const auto damage = luavideo::findDamage(frame, presented_, presentedValid_);
  if (damage.count) display_.startWrite();
  for (size_t i = 0; i < damage.count; ++i) {
    const auto& r = damage.rects[i];
    // Use the same TFT_eSPI sprite writer and byte order as full frames.
    canvas_.pushSprite(r.x, r.y, r.x, r.y, r.w, r.h);
    video_.bytes += r.w * r.h * sizeof(uint16_t);
    for (int y = r.y; y < r.y + r.h; ++y)
      memcpy(presented_ + y * luavideo::width + r.x,
             frame + y * luavideo::width + r.x, r.w * sizeof(uint16_t));
  }
  if (damage.count) { display_.endWrite(); ++video_.displayed; }
  presentedValid_ = true;
}

void LuaApp::drawImage(lua_State* state, const opd::Entry& entry, int x, int y) {
  auto paint = [this,x,y](CachedImage& image) {
    const bool swap = canvas_.getSwapBytes(); canvas_.setSwapBytes(false);
    if (!image.masked) canvas_.pushImage(x,y,image.width,image.height,image.pixels);
    else {
      const uint8_t* mask = reinterpret_cast<const uint8_t*>(image.pixels + size_t(image.width)*image.height);
      for (int iy=std::max(0,-y); iy<std::min(int(image.height),240-y); ++iy) {
        int ix=std::max(0,-x), end=std::min(int(image.width),320-x);
        auto visible = [&](int column) { size_t bit=size_t(iy)*image.width+column; return mask[bit>>3] & (1<<(bit&7)); };
        while (ix<end) {
          while(ix<end && !visible(ix)) ++ix;
          int start=ix; while(ix<end && visible(ix)) ++ix;
          if(ix>start) canvas_.pushImage(x+start,y+iy,ix-start,1,image.pixels+size_t(iy)*image.width+start);
        }
      }
    }
    canvas_.setSwapBytes(swap);
  };
  ++imageUse_;
  for (auto& image : images_) {
    if (image.entry != &entry) continue;
    ++video_.cacheHits;
    image.used = imageUse_;
    paint(image);
    return;
  }
  ++video_.cacheMisses;
  uint8_t header[8];
  if (!bundle_.read(entry, 0, header, sizeof(header)) || (memcmp(header, "OPI1", 4) && memcmp(header, "OPI2", 4)))
    luaL_error(state, "expected OPI1 or OPI2 image");
  const int width = header[4] | (header[5] << 8), height = header[6] | (header[7] << 8);
  const bool masked=header[3]=='2';
  const size_t pixels = size_t(width)*height, pixelBytes=pixels*2, bytes=pixelBytes+(masked?(pixels+7)/8:0);
  if (!width || !height || width > 320 || height > 240 || entry.size != 8 + bytes)
    luaL_error(state, "invalid image dimensions");
  if (x >= 320 || y >= 240 || x + width <= 0 || y + height <= 0) return;

  auto oldest = [this]() -> CachedImage& {
    CachedImage* result = &images_[0];
    for (auto& image : images_) {
      if (!image.pixels) return image;
      if (uint32_t(imageUse_ - image.used) > uint32_t(imageUse_ - result->used)) result = &image;
    }
    return *result;
  };
  auto evict = [this](CachedImage& image) {
    const size_t count=size_t(image.width)*image.height;
    imageBytes_ -= count*2+(image.masked?(count+7)/8:0);
    free(image.pixels); image = CachedImage{};
  };
  while (imageBytes_ + bytes > imageCacheLimit) {
    // All slots are occupied or there is a byte budget to reclaim. Ignore
    // empty slots when selecting an eviction victim.
    CachedImage* victim = nullptr;
    for (auto& image : images_)
      if (image.pixels && (!victim || uint32_t(imageUse_ - image.used) > uint32_t(imageUse_ - victim->used))) victim = &image;
    evict(*victim);
  }
  auto& image = oldest();
  if (image.pixels) evict(image);
  image.pixels = static_cast<uint16_t*>(heap_caps_malloc(bytes, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT));
  if (image.pixels) {
    image.width = width; image.height = height; image.masked=masked; imageBytes_ += bytes;
    if (!bundle_.read(entry, 8, image.pixels, bytes)) luaL_error(state, "image read failed");
    // Convert once on load; repeated draws become clipped row memcpy calls.
    for (size_t i = 0; i < pixels; ++i) {
      const uint16_t color = image.pixels[i];
      image.pixels[i] = uint16_t((color << 8) | (color >> 8));
    }
    image.entry = &entry; image.used = imageUse_;
    paint(image);
    return;
  }
  if(masked) luaL_error(state,"not enough memory for transparent image");
  // Low-memory fallback still blits rows in bulk and only reads visible rows.
  uint16_t row[320];
  const int first = std::max(0, -y), end = std::min(height, 240 - y);
  for (int iy = first; iy < end; ++iy) {
    if (!bundle_.read(entry, 8 + iy * width * 2, row, width * 2)) luaL_error(state, "image read failed");
    const bool swap = canvas_.getSwapBytes(); canvas_.setSwapBytes(true);
    canvas_.pushImage(x, y + iy, width, 1, row);
    canvas_.setSwapBytes(swap);
  }
}

void LuaApp::fail() {
  openplayaudio::command("stop");
  // Do not copy an unbounded Lua error into the ESP32's internal heap, or
  // allocate a Lua string outside pcall when the error object is a number.
  char message[241]; size_t length = 0;
  const char* text = lua_type(state_, -1) == LUA_TSTRING ? lua_tolstring(state_, -1, &length) : nullptr;
  length = std::min(length, sizeof(message) - 1);
  for (size_t i = 0; i < length; ++i) message[i] = text[i] ? text[i] : ' ';
  message[length] = 0;
  error_ = length ? message : "Ошибка Lua";
  Serial.printf("LUA ERROR: %s\n", error_.c_str());
  // A failing shutdown must not prevent hardware cleanup.
  releaseHardware(); lua_close(state_); state_ = nullptr; appRef_ = LUA_NOREF;
  releaseGraphics(); bundle_.close();
}

int LuaApp::dispatch(lua_State* state) {
  auto* app = static_cast<LuaApp*>(lua_touserdata(state, 1));
  const char* callback = static_cast<const char*>(lua_touserdata(state, 2));
  lua_rawgeti(state, LUA_REGISTRYINDEX, app->appRef_);
  lua_pushstring(state, callback); lua_rawget(state, -2);
  if (lua_isnil(state, -1)) return 0;
  if (!lua_isfunction(state, -1)) return luaL_error(state, "%s must be a function", callback);
  if (!strcmp(callback, "update")) { lua_pushvalue(state, 3); lua_call(state, 1, 0); }
  else lua_call(state, 0, 0);
  return 0;
}

bool LuaApp::invoke(const char* callback, float dt) {
  if (!state_) return false;
  beginBudget();
  lua_pushcfunction(state_, dispatch); lua_pushlightuserdata(state_, this);
  lua_pushlightuserdata(state_, const_cast<char*>(callback)); lua_pushnumber(state_, dt);
  if (lua_pcall(state_, 3, 0, 0) != LUA_OK) { fail(); return false; }
  return true;
}

void LuaApp::update(uint32_t now, const Controls& controls) {
  if (!state_ || paused_ || exit_) return;
  uint8_t current = (controls.aDown ? 1 : 0) | (controls.bDown ? 2 : 0) | (controls.stickDown ? 4 : 0) |
    (controls.x < -0.55f ? 8 : 0) | (controls.x > 0.55f ? 16 : 0) |
    (controls.y < -0.55f ? 32 : 0) | (controls.y > 0.55f ? 64 : 0);
  pressed_ |= current & ~down_; released_ |= down_ & ~current; down_ = current;
  axisX_ = controls.x; axisY_ = controls.y;
  if (int32_t(now - nextFrame_) < 0) return;
  float dt = std::min(uint32_t(now - lastFrame_), uint32_t(250)) / 1000.0f;
  lastFrame_ = now; nextFrame_ = now + 1000 / bundle_.manifest().fps;
  const uint32_t callbackAt = micros();
  if (!invoke("update", dt) || exit_) return;
  if (!invoke("draw") || exit_) return;
  video_.callbackUs += uint32_t(micros() - callbackAt);
  const uint32_t presentAt = micros();
  present();
  video_.presentUs += uint32_t(micros() - presentAt); ++video_.frames;
  pressed_ = released_ = 0;
}

void LuaApp::pause() {
  if (!state_ || paused_) return;
  invoke("pause"); releaseHardware(); paused_ = true;
  openplayaudio::command("pause");
}

void LuaApp::resume() {
  if (!state_ || !paused_) return;
  paused_ = false; down_ = pressed_ = released_ = 0;
  presentedValid_ = false; // The system pause menu overwrote the LCD.
  nextFrame_ = lastFrame_ = millis(); invoke("resume");
  openplayaudio::command("resume");
  sampleAt_ = millis(); sampleFrames_ = video_.frames; sampleDisplayed_ = video_.displayed;
}

void LuaApp::printVideoStatus() const {
  if (!state_) return;
  const uint32_t now = millis(), elapsed = now - sampleAt_;
  Serial.printf("LUA_VIDEO: frames=%u displayed=%u target_fps=%u fps=%.1f lcd_fps=%.1f callback_us=%u present_us=%u bytes=%llu cache_hits=%u cache_misses=%u cache_bytes=%u partial=%d\n",
                video_.frames, video_.displayed, unsigned(bundle_.manifest().fps),
                elapsed ? (video_.frames - sampleFrames_) * 1000.0f / elapsed : 0.0f,
                elapsed ? (video_.displayed - sampleDisplayed_) * 1000.0f / elapsed : 0.0f,
                unsigned(video_.frames ? video_.callbackUs / video_.frames : 0),
                unsigned(video_.frames ? video_.presentUs / video_.frames : 0),
                static_cast<unsigned long long>(video_.bytes), video_.cacheHits, video_.cacheMisses,
                unsigned(imageBytes_), presented_ != nullptr);
  sampleAt_ = now; sampleFrames_ = video_.frames; sampleDisplayed_ = video_.displayed;
}

void LuaApp::stop() {
  if (state_) {
    // Paused programs no longer own pins; don't reacquire them during shutdown.
    invoke("shutdown");
    releaseHardware();
    if (state_) lua_close(state_);
  }
  state_ = nullptr; appRef_ = LUA_NOREF; memory_ = 0;
  openplayaudio::command("stop");
  releaseGraphics(); bundle_.close();
}

int LuaApp::api(lua_State* state) {
  auto& app = *static_cast<LuaApp*>(lua_touserdata(state, lua_upvalueindex(1)));
  Operation op = static_cast<Operation>(lua_tointeger(state, lua_upvalueindex(2)));
  auto& canvas = app.canvas_;
  // The color is kept in the sprite's text foreground and applies to primitives.
  uint16_t color = canvas.textcolor;
  switch (op) {
    case Clear: canvas.fillSprite(lua_isnoneornil(state, 1) ? TFT_BLACK : integer(state, 1, 0, 65535)); break;
    case Color: canvas.setTextColor(integer(state, 1, 0, 65535)); break;
    case Rgb: {
      int r = integer(state, 1, 0, 255), g = integer(state, 2, 0, 255), b = integer(state, 3, 0, 255);
      lua_pushinteger(state, ((r & 248) << 8) | ((g & 252) << 3) | (b >> 3)); return 1;
    }
    case Pixel: canvas.drawPixel(coordinate(state, 1), coordinate(state, 2), color); break;
    case Line: canvas.drawLine(coordinate(state, 1), coordinate(state, 2), coordinate(state, 3), coordinate(state, 4), color); break;
    case Rect: case FillRect: {
      int x = coordinate(state, 1), y = coordinate(state, 2), w = integer(state, 3, 0, 1024), h = integer(state, 4, 0, 1024);
      if (op == Rect) canvas.drawRect(x, y, w, h, color); else canvas.fillRect(x, y, w, h, color);
      break;
    }
    case Circle: case FillCircle: {
      int x = coordinate(state, 1), y = coordinate(state, 2), r = integer(state, 3, 0, 512);
      if (op == Circle) canvas.drawCircle(x, y, r, color); else canvas.fillCircle(x, y, r, color);
      break;
    }
    case Text: {
      size_t length; const char* text = luaL_checklstring(state, 1, &length);
      luaL_argcheck(state, length <= 256 && !memchr(text, 0, length), 1, "text too long or contains NUL");
      int x = coordinate(state, 2), y = coordinate(state, 3);
      uiText(canvas, text, x, y, color, lua_toboolean(state, 4));
      break;
    }
    case Image: case ReadAsset: {
      const char* path = luaL_checkstring(state, 1);
      const opd::Entry* entry = app.bundle_.find(path);
      if (!entry || !strncmp(path, "../", 3)) return luaL_error(state, "asset not found: %s", path);
      if (op == ReadAsset) {
        if (entry->size > opd::maxScriptSize) return luaL_error(state, "asset read limit is 64 KiB");
        luaL_Buffer buffer; char* data = luaL_buffinitsize(state, &buffer, entry->size);
        if (!app.bundle_.read(*entry, 0, data, entry->size)) return luaL_error(state, "asset read failed");
        luaL_pushresultsize(&buffer, entry->size); return 1;
      }
      int x = coordinate(state, 2), y = coordinate(state, 3);
      app.drawImage(state, *entry, x, y);
      break;
    }
    case Down: lua_pushboolean(state, app.down_ & button(state)); return 1;
    case Pressed: lua_pushboolean(state, app.pressed_ & button(state)); return 1;
    case Released: lua_pushboolean(state, app.released_ & button(state)); return 1;
    case Axis: {
      const char* names[] = {"x", "y", nullptr};
      lua_pushnumber(state, luaL_checkoption(state, 1, nullptr, names) == 0 ? app.axisX_ : app.axisY_); return 1;
    }
    case Millis: lua_pushinteger(state, millis()); return 1;
    case AudioPlay: {
      const char* path=luaL_checkstring(state,1); const auto* entry=app.bundle_.find(path);
      uint8_t header[44];
      if(!entry || entry->size<46 || entry->size>1323044 || !app.bundle_.read(*entry,0,header,44)) return luaL_error(state,"expected imported PCM WAV sound");
      auto u16=[&](int i) { return uint16_t(header[i]) | (uint16_t(header[i+1])<<8); };
      auto u32=[&](int i) { return uint32_t(header[i]) | (uint32_t(header[i+1])<<8) | (uint32_t(header[i+2])<<16) | (uint32_t(header[i+3])<<24); };
      if(memcmp(header,"RIFF",4) || memcmp(header+8,"WAVEfmt ",8) || memcmp(header+36,"data",4) || u32(4)!=entry->size-8 || u32(16)!=16 || u16(20)!=1 || u16(22)!=1 || u32(24)!=22050 || u32(28)!=44100 || u16(32)!=2 || u16(34)!=16 || u32(40)!=entry->size-44 || (entry->size-44)%2)
        return luaL_error(state,"expected imported PCM WAV sound");
      if(app.paused_) return luaL_error(state,"audio unavailable while paused");
      openplayaudio::command("play",path,lua_toboolean(state,2));lua_pushboolean(state,openplayaudio::available);return 1;
    }
    case AudioStop: openplayaudio::command("stop"); break;
    case Exit: app.exit_ = true; break;
    case Log: {
      size_t length; const char* text = luaL_checklstring(state, 1, &length);
      if (length > 256 || app.logBytes_ + length > 512) return luaL_error(state, "log budget exceeded");
      app.logBytes_ += length;
      // USB logging must never stall a frame waiting for a disconnected host.
      if (Serial.availableForWrite() >= int(length + 1)) { Serial.write(reinterpret_cast<const uint8_t*>(text), length); Serial.write('\n'); }
      break;
    }
    case Require: {
      size_t length; const char* module = luaL_checklstring(state, 1, &length);
      if (!length || length > opd::maxPath - 4) return luaL_error(state, "invalid module name");
      char path[opd::maxPath + 1];
      for (size_t i = 0; i < length; ++i) {
        char c = module[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.'))
          return luaL_error(state, "invalid module name");
        path[i] = c == '.' ? '/' : c;
      }
      memcpy(path + length, ".lua", 5);
      const opd::Entry* entry = app.bundle_.find(path);
      if (!entry) return luaL_error(state, "module not found: %s", module);
      luaL_getsubtable(state, LUA_REGISTRYINDEX, "opd.modules");
      lua_getfield(state, -1, module);
      if (lua_islightuserdata(state, -1)) return luaL_error(state, "circular require: %s", module);
      if (!lua_isnil(state, -1)) return 1;
      lua_pop(state, 1); lua_pushlightuserdata(state, &app); lua_setfield(state, -2, module);
      app.loadScript(state, *entry); lua_call(state, 0, 1);
      if (lua_isnil(state, -1)) { lua_pop(state, 1); lua_pushboolean(state, true); }
      lua_pushvalue(state, -1); lua_setfield(state, -3, module); return 1;
    }
    case GpioMode: case GpioRead: case GpioWrite: {
      int pin = integer(state, 1, 0, 48);
      const auto& allowed = app.bundle_.manifest().gpio;
      if (std::find(allowed.begin(), allowed.end(), pin) == allowed.end()) return luaL_error(state, "GPIO not declared in manifest");
      if (app.paused_) return luaL_error(state, "hardware unavailable while paused");
      if (op == GpioMode) {
        const char* modes[] = {"input", "input_pullup", "input_pulldown", "output", nullptr};
        const int values[] = {INPUT, INPUT_PULLUP, INPUT_PULLDOWN, OUTPUT};
        int mode = values[luaL_checkoption(state, 2, nullptr, modes)];
        if (mode == OUTPUT) digitalWrite(pin, LOW);
        pinMode(pin, mode); app.pinModes_[pin] = mode;
      } else if (app.pinModes_[pin] == -1) return luaL_error(state, "call gpio.mode first");
      else if (op == GpioRead) { lua_pushboolean(state, digitalRead(pin)); return 1; }
      else {
        if (app.pinModes_[pin] != OUTPUT) return luaL_error(state, "GPIO is not an output");
        luaL_checktype(state, 2, LUA_TBOOLEAN); digitalWrite(pin, lua_toboolean(state, 2) ? HIGH : LOW);
      }
      break;
    }
    case UartOpen: case UartRead: case UartWrite: case UartAvailable: {
      const auto& manifest = app.bundle_.manifest();
      if (manifest.uartTx < 0 || app.paused_) return luaL_error(state, "UART not available");
      if (op == UartOpen) {
        if (!app.uartOpen_) { app.uart_.begin(manifest.uartBaud, SERIAL_8N1, manifest.uartRx, manifest.uartTx); app.uartOpen_ = true; }
      } else if (!app.uartOpen_) return luaL_error(state, "call uart.open first");
      else if (op == UartAvailable) { lua_pushinteger(state, app.uart_.available()); return 1; }
      else if (op == UartRead) {
        int size = integer(state, 1, 1, 256); char bytes[256]; int count = 0;
        while (count < size && app.uart_.available()) { int value = app.uart_.read(); if (value < 0) break; bytes[count++] = char(value); }
        lua_pushlstring(state, bytes, count); return 1;
      } else {
        size_t size; const char* bytes = luaL_checklstring(state, 1, &size);
        if (size > 256) return luaL_error(state, "UART write limit is 256 bytes");
        size_t count = std::min(size, size_t(std::max(0, app.uart_.availableForWrite())));
        lua_pushinteger(state, count ? app.uart_.write(reinterpret_cast<const uint8_t*>(bytes), count) : 0); return 1;
      }
      break;
    }
  }
  return 0;
}
