#pragma once
#include <TFT_eSPI.h>
#include "controls.h"

class GameBoyApp {
 public:
  explicit GameBoyApp(TFT_eSPI& display) : display_(display) {}
  bool start(const String& name);
  bool stop();
  bool save();
  void update(const Controls& controls);
  void pulseStart() { startFrames_ = 3; }
  void pulseSelect() { selectFrames_ = 3; }
  void resume();
  void pause();
  void screenshot();
  void printVideoStatus() const;
  String error() const { return error_; }
  bool active() const { return active_; }
  uint32_t frames() const { return frames_; }
 private:
  TFT_eSPI& display_;
  bool active_ = false;
  String savePath_, error_;
  uint32_t nextFrame_ = 0, savedAt_ = 0, frames_ = 0;
  uint64_t emulationUs_ = 0;
  mutable uint32_t sampleAt_ = 0, sampleFrames_ = 0, sampleDisplayed_ = 0;
  uint8_t startFrames_ = 0, selectFrames_ = 0;
};
