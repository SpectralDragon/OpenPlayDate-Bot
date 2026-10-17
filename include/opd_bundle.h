#pragma once
#include <Arduino.h>
#include <FS.h>
#include <vector>

namespace opd {
constexpr size_t maxBundleSize = 2 * 1024 * 1024;
constexpr size_t maxScriptSize = 64 * 1024;
constexpr size_t maxFiles = 64;
constexpr size_t maxPath = 96;
// Board policy: excludes screen, buttons, USB, boot straps, flash/PSRAM,
// debug and UART0. Add pins only after checking the physical board wiring.
bool availablePin(int pin);
bool safePath(const String& path);
String safeName(const String& name);
std::vector<String> list();

struct Entry { String path; uint32_t offset; uint32_t size; };
struct Manifest {
  String id, name, kind, entry;
  uint8_t fps = 30;
  std::vector<int> gpio;
  int uartTx = -1, uartRx = -1;
  uint32_t uartBaud = 115200;
};

class Bundle {
 public:
  bool open(const String& path);
  void close();
  const Entry* find(const String& path) const;
  bool read(const Entry& entry, size_t offset, void* data, size_t size);
  const Manifest& manifest() const { return manifest_; }
  const String& error() const { return error_; }
 private:
  File file_;
  Manifest manifest_;
  std::vector<Entry> entries_;
  String error_;
  bool fail(const char* error);
};
}
