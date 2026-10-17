#include "lua_app.h"
#include "LittleFS.h"
#include <ArduinoJson.h>
#include <iostream>
#include <sstream>
#ifdef _WIN32
#include <fcntl.h>
#include <io.h>
#endif

uint32_t testNow = 0;
int testModes[49] = {}, testLevels[49] = {};
SerialDouble Serial;
LittleFSDouble LittleFS;
std::filesystem::path testStorage;
bool testUartOpen = false;
std::deque<uint8_t> testRx;
std::string testTx;
namespace roms { bool available() { return true; } }

void packet(char type, const void* bytes, uint32_t size) {
  std::cout.put(type);
  for (int i=0;i<4;++i) std::cout.put(char(size >> (8*i)));
  std::cout.write(static_cast<const char*>(bytes), size); std::cout.flush();
}
void event(const char* type, const char* message = "") {
  DynamicJsonDocument doc(2048); doc["type"]=type; doc["message"]=message;
  std::string json; serializeJson(doc,json); packet('J',json.data(),uint32_t(json.size()));
}
// Enabled only for the desktop target; tests keep their silent Serial double.
void desktopSerial(const uint8_t* bytes, size_t size) {
  if (size == 1 && *bytes == '\n') return;
  std::string text(reinterpret_cast<const char*>(bytes),size); event("log",text.c_str());
}
void hardware() {
  DynamicJsonDocument doc(4096); doc["type"]="hardware";
  auto pins=doc.createNestedArray("pins");
  for (int pin : {1,2,16,17,18,21}) {
    auto p=pins.createNestedObject(); p["pin"]=pin; p["mode"]=testModes[pin]; p["level"]=testLevels[pin];
  }
  doc["uartOpen"]=testUartOpen; doc["tx"]=testTx; testTx.clear();
  std::string json; serializeJson(doc,json); packet('J',json.data(),uint32_t(json.size()));
}
#ifdef _WIN32
int wmain(int argc, wchar_t** argv) {
  _setmode(_fileno(stdout),_O_BINARY); _setmode(_fileno(stdin),_O_BINARY);
#else
int main(int argc, char** argv) {
#endif
  if (argc != 3) return 2;
  try {
#ifdef _WIN32
    testStorage = argv[1];
    std::string name = std::filesystem::path(argv[2]).u8string();
#else
    testStorage = std::filesystem::u8path(argv[1]);
    std::string name = argv[2];
#endif
    TFT_eSPI display; LuaApp app(display); Controls controls;
    if (!app.start(name.c_str())) { event("error", app.error().c_str()); return 1; }
    event("ready", app.name().c_str());
    std::string line;
    while (std::getline(std::cin,line)) {
      std::istringstream input(line); std::string command; input >> command;
      if (command == "stop") { app.stop(); event("stopped"); break; }
      if (command == "pause") { app.pause(); hardware(); event("paused"); }
      if (command == "resume") { app.resume(); event("resumed"); }
      if (command == "gpio") { int pin,level; if (input>>pin>>level && pin>=0 && pin<49 && testModes[pin]!=OUTPUT) testLevels[pin]=level?1:0; }
      if (command == "uart") { int value; while (input>>value && testRx.size()<1024) testRx.push_back(uint8_t(value)); }
      if (command == "frame" || command == "input") {
        uint32_t now; int mask; if (!(input>>now>>mask)) continue;
        testNow=now; controls.aDown=mask&1; controls.bDown=mask&2; controls.stickDown=mask&4;
        controls.x=((mask&16)?1.f:0.f)-((mask&8)?1.f:0.f);
        controls.y=((mask&64)?1.f:0.f)-((mask&32)?1.f:0.f);
        app.update(testNow,controls);
        if (command == "frame" && app.active() && !app.exiting()) { packet('F',app.canvas().pixels(),320*240*2); hardware(); }
      }
      if (!app.error().isEmpty()) { event("error",app.error().c_str()); break; }
      if (app.exiting()) { app.stop(); event("exit"); break; }
    }
    app.stop();
  } catch (const std::exception& e) { event("error",e.what()); return 1; }
}
