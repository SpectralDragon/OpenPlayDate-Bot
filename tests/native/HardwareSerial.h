#pragma once
#include "Arduino.h"
#include <deque>
constexpr int SERIAL_8N1 = 0;
extern bool testUartOpen;
extern std::deque<uint8_t> testRx;
extern std::string testTx;
class HardwareSerial {
 public:
  explicit HardwareSerial(int) {}
  void begin(uint32_t, int, int, int) { testUartOpen = true; }
  void end() { testUartOpen = false; }
  int available() { return int(testRx.size()); }
  int read() { if (testRx.empty()) return -1; int value = testRx.front(); testRx.pop_front(); return value; }
  int availableForWrite() { return 4; }
  size_t write(const uint8_t* bytes, size_t size) { testTx.append(reinterpret_cast<const char*>(bytes), size); return size; }
};
