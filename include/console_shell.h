#pragma once
#include "device_settings.h"
#include "eyes.h"
#include "gameboy_app.h"
#include "nes_app.h"
#include "network_service.h"
#include "lua_app.h"
#include <vector>

class ConsoleShell {
 public:
  ConsoleShell(TFT_eSPI& display, Eyes& eyes)
      : display_(display), eyes_(eyes), canvas_(&display), network_(settings_), game_(display), nes_(display), lua_(display) {}
  bool begin();
  void update(uint32_t now, const Controls& controls);
  void command(char command);
  void invalidate() { dirty_ = true; }
  const char* pageName() const;
  void printStatus() const;
 private:
  enum class Page { Eyes, Home, Settings, Wifi, Portal, Games, Playing, Paused, About, Error, Apps, LuaPlaying, LuaPaused, NesGames, NesPlaying, NesPaused };
  TFT_eSPI& display_;
  Eyes& eyes_;
  TFT_eSprite canvas_;
  DeviceSettings settings_;
  NetworkService network_;
  GameBoyApp game_;
  NesApp nes_;
  LuaApp lua_;
  Page page_ = Page::Eyes;
  Page portalReturn_ = Page::Wifi;
  std::vector<String> games_;
  std::vector<String> apps_;
  String message_;
  int selected_ = 0, direction_ = 0;
  uint32_t repeatAt_ = 0, activityAt_ = 0, refreshAt_ = 0, stickAt_ = 0;
  bool dirty_ = true, waitRelease_ = true, wasStickDown_ = false;
  void show(Page page);
  void sleep();
  void move(int delta);
  void select();
  void back();
  int itemCount() const;
  void render();
  void title(const String& text, const String& subtitle);
  void row(int y, const String& label, const String& detail, bool active, int height = 42);
  void footer(const String& text);
  void screenshot();
  void luaPage(Page success);
};
