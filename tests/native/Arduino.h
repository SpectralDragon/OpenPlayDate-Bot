#pragma once
// Host-only hardware doubles. Production headers never include this directory.
#include <algorithm>
#include <cstdint>
#include <cstddef>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <string>
#include <utility>
#include <vector>

class String {
  std::string value_;
 public:
  String() = default;
  String(const char* value) : value_(value ? value : "") {}
  String(const std::string& value) : value_(value) {}
  bool isEmpty() const { return value_.empty(); }
  size_t length() const { return value_.size(); }
  const char* c_str() const { return value_.c_str(); }
  char operator[](size_t i) const { return value_[i]; }
  bool endsWith(const char* tail) const { return value_.size() >= strlen(tail) && value_.compare(value_.size() - strlen(tail), strlen(tail), tail) == 0; }
  String substring(size_t start, size_t end = std::string::npos) const { return value_.substr(std::min(start, value_.size()), end == std::string::npos ? end : end - start); }
  int lastIndexOf(char c) const { auto index = value_.rfind(c); return index == std::string::npos ? -1 : int(index); }
  String& operator+=(char c) { value_ += c; return *this; }
  auto begin() const -> std::string::const_iterator { return value_.begin(); }
  auto end() const -> std::string::const_iterator { return value_.end(); }
  friend bool operator==(const String& a, const String& b) { return a.value_ == b.value_; }
  friend bool operator!=(const String& a, const String& b) { return !(a == b); }
  friend bool operator<(const String& a, const String& b) { return a.value_ < b.value_; }
  friend String operator+(const String& a, const String& b) { return a.value_ + b.value_; }
};
constexpr int INPUT = 1, OUTPUT = 3, INPUT_PULLUP = 5, INPUT_PULLDOWN = 9, LOW = 0, HIGH = 1;
extern uint32_t testNow;
extern int testModes[49], testLevels[49];
inline uint32_t millis() { return testNow; }
inline uint32_t micros() { return testNow * 1000; }
inline void pinMode(int pin, int mode) {
  testModes[pin] = mode;
#ifdef OPENPLAY_DESKTOP
  if (mode == INPUT_PULLUP) testLevels[pin] = HIGH;
  if (mode == INPUT_PULLDOWN) testLevels[pin] = LOW;
#endif
}
inline void digitalWrite(int pin, int level) { testLevels[pin] = level; }
inline int digitalRead(int pin) { return testLevels[pin]; }
#ifdef OPENPLAY_DESKTOP
void desktopSerial(const uint8_t*, size_t);
#endif
struct SerialDouble {
  template<class... Args> void printf(const char*, Args...) {}
  int availableForWrite() { return 1024; }
  size_t write(const uint8_t* bytes, size_t length) {
#ifdef OPENPLAY_DESKTOP
    desktopSerial(bytes, length);
#endif
    return length;
  }
  size_t write(char value) { return write(reinterpret_cast<const uint8_t*>(&value), 1); }
};
extern SerialDouble Serial;
