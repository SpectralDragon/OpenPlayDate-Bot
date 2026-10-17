#pragma once
#include "controls.h"
#include "opd_bundle.h"
#include <TFT_eSPI.h>
#include <HardwareSerial.h>
struct lua_State;
struct lua_Debug;

class LuaApp {
 public:
  explicit LuaApp(TFT_eSPI& display) : display_(display), canvas_(&display) {}
  bool start(const String& name);
  void update(uint32_t now, const Controls& controls);
  void pause();
  void resume();
  void stop();
  void printVideoStatus() const;
  bool active() const { return state_ != nullptr; }
  bool exiting() const { return exit_; }
  const String& error() const { return error_; }
  const String& name() const { return bundle_.manifest().name; }
  TFT_eSprite& canvas() { return canvas_; }
 private:
  opd::Bundle bundle_;
  TFT_eSPI& display_;
  TFT_eSprite canvas_;
  uint16_t* presented_ = nullptr;
  bool presentedValid_ = false;
  struct CachedImage {
    const opd::Entry* entry = nullptr;
    uint16_t* pixels = nullptr;
    uint16_t width = 0, height = 0;
    bool masked = false;
    uint32_t used = 0;
  };
  CachedImage images_[8] = {};
  size_t imageBytes_ = 0;
  uint32_t imageUse_ = 0;
  struct VideoStats {
    uint32_t frames = 0, displayed = 0, cacheHits = 0, cacheMisses = 0;
    uint64_t bytes = 0, callbackUs = 0, presentUs = 0;
  } video_;
  mutable uint32_t sampleAt_ = 0, sampleFrames_ = 0, sampleDisplayed_ = 0;
  HardwareSerial uart_{1};
  lua_State* state_ = nullptr;
  String error_;
  int appRef_ = -2;
  size_t memory_ = 0;
  uint32_t nextFrame_ = 0, lastFrame_ = 0, callbackAt_ = 0, instructions_ = 0;
  uint8_t down_ = 0, pressed_ = 0, released_ = 0;
  float axisX_ = 0, axisY_ = 0;
  bool paused_ = false, exit_ = false, uartOpen_ = false;
  int8_t pinModes_[49] = {};
  uint16_t logBytes_ = 0;
  void releaseHardware();
  void releaseGraphics();
  void present();
  void drawImage(lua_State* state, const opd::Entry& entry, int x, int y);
  void fail();
  bool invoke(const char* callback, float dt = 0);
  void beginBudget();
  int loadScript(lua_State* state, const opd::Entry& entry);
  static void* allocate(void* user, void* pointer, size_t oldSize, size_t newSize);
  static void hook(lua_State* state, lua_Debug* debug);
  static int boot(lua_State* state);
  static int dispatch(lua_State* state);
  static int api(lua_State* state);
};
