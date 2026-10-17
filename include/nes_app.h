#pragma once
#include <TFT_eSPI.h>
#include "controls.h"

class NesApp {
 public:
  explicit NesApp(TFT_eSPI& display) : display_(display) {}
  bool start(const String& name);
  bool save();
  bool stop();
  void update(const Controls& controls);
  void pause();
  void resume();
  void pulseStart() { startFrames_ = 3; }
  void pulseSelect() { selectFrames_ = 3; }
  bool active() const { return active_; }
  String error() const { return error_; }
  void screenshot();
  void printVideoStatus() const;
 private:
  TFT_eSPI& display_;
  bool active_ = false;
  String error_, name_, savePath_;
  uint32_t frames_ = 0, nextFrame_ = 0, savedAt_ = 0, frameUs_ = 16667;
  uint8_t startFrames_ = 0, selectFrames_ = 0;
};
