#include "lua_app.h"
#include "LittleFS.h"
#include "lua_video.h"
#include "esp_heap_caps.h"
#include <iostream>
#include <stdexcept>

uint32_t testNow = 0;
int testModes[49] = {}, testLevels[49] = {};
SerialDouble Serial;
LittleFSDouble LittleFS;
std::filesystem::path testStorage;
bool testUartOpen = false;
std::deque<uint8_t> testRx;
std::string testTx;
namespace roms { bool available() { return true; } }

void check(bool value, const char* message) {
  if (!value) throw std::runtime_error(message);
}

int main(int argc, char** argv) {
  try {
    check(argc == 2, "storage argument"); testStorage = argv[1];
    TFT_eSPI display; LuaApp app(display); Controls controls;
    auto frame = [&] { testNow += 34; app.update(testNow, controls); check(app.active(), app.error().c_str()); };
    auto matchesDisplay = [&] {
      for (int y = 0; y < 240; ++y) for (int x = 0; x < 320; ++x)
        check(display.pixels[y*320+x] == app.canvas().readPixel(x,y), "LCD matches canvas after partial update");
    };
    check(app.start("damage.opd"), app.error().c_str());
    size_t bytes = display.bytes;
    frame(); matchesDisplay();
    check(display.bytes - bytes == luavideo::frameBytes, "first frame replaces the entire menu");
    bytes = display.bytes;
    frame(); matchesDisplay();
    check(display.bytes - bytes == 512, "moving pixel across tile boundaries sends only two tiles");
    bytes = display.bytes;
    frame(); matchesDisplay();
    check(display.bytes == bytes, "identical final frame sends no SPI data after clear/redraw");
    app.pause(); std::fill(display.pixels.begin(), display.pixels.end(), 0xffff); app.resume();
    frame(); matchesDisplay();
    check(display.bytes - bytes == luavideo::frameBytes, "resume replaces the entire pause menu including unchanged pixels");
    bytes = display.bytes;
    frame(); matchesDisplay();
    check(display.bytes - bytes == luavideo::frameBytes, "fragmented damage falls back to full frame");
    frame(); matchesDisplay(); // Erase the last fragmented image.
    app.stop();

    check(app.start("images.opd"), app.error().c_str());
    frame(); matchesDisplay();
    check(app.canvas().readPixel(0,0) == 0x1234 && app.canvas().readPixel(1,0) == 0xabcd, "negative image clipping uses correct source row and columns");
    check(app.canvas().readPixel(319,239) == 0xf800, "bottom-right image clipping");
    check(app.canvas().readPixel(11,10) == 0x07e0 && app.canvas().readPixel(12,10) == 0x001f, "RGB565 green and blue survive bulk blit");
    size_t reads = testFileReads; bytes = display.bytes;
    frame(); matchesDisplay();
    check(testFileReads == reads, "warm image cache performs no filesystem reads");
    check(display.bytes == bytes, "cached static images perform no LCD transfers");
    app.stop();
    check(app.start("image-eviction.opd"), app.error().c_str());
    frame(); matchesDisplay(); frame(); matchesDisplay();
    check(app.canvas().readPixel(319,239) == 0xf800, "slot and byte-budget evictions reload the correct image");
    app.stop();
    for (const char* name : {"image-header.opd", "image-size.opd", "image-dimensions.opd"}) {
      check(app.start(name), app.error().c_str()); testNow += 34; app.update(testNow, controls);
      check(!app.active() && !app.error().isEmpty(), "malformed cached image closes runtime");
    }
    testGraphicsAllocationFails = true;
    check(app.start("images.opd"), app.error().c_str());
    frame(); matchesDisplay();
    bytes = display.bytes; reads = testFileReads;
    frame(); matchesDisplay();
    check(display.bytes - bytes == luavideo::frameBytes && testFileReads > reads, "allocation failure uses full-frame and streamed-image fallbacks");
    check(app.canvas().readPixel(0,0) == 0x1234 && app.canvas().readPixel(319,239) == 0xf800, "fallback clipping and colors");
    app.stop(); testGraphicsAllocationFails = false;

    // Damage lists must cover every changed pixel, including unrelated distant
    // changes and edge tiles. Reconstruct the LCD across deterministic frames.
    std::vector<uint16_t> current(320*240), previous(320*240);
    uint32_t random = 1; size_t partialBytes = 0;
    for (int step = 0; step < 120; ++step) {
      std::fill(current.begin(), current.end(), 0);
      for (int i = 0; i < 20; ++i) {
        random = random * 1664525u + 1013904223u;
        current[random % current.size()] = uint16_t(random >> 16);
      }
      auto damage = luavideo::findDamage(current.data(), previous.data(), step != 0);
      for (size_t i = 0; i < damage.count; ++i) {
        const auto& r = damage.rects[i];
        check(r.w && r.h && r.x+r.w <= 320 && r.y+r.h <= 240, "damage rectangle stays inside canvas");
        partialBytes += r.w*r.h*2;
        for (int y = r.y; y < r.y+r.h; ++y)
          memcpy(previous.data()+y*320+r.x, current.data()+y*320+r.x, r.w*2);
      }
      check(previous == current, "damage reconstruction covers every changed pixel");
    }
    std::cout << "VIDEO: 120 sparse frames, full=" << 120*luavideo::frameBytes
              << " bytes, partial=" << partialBytes << " bytes\n";
    check(app.start("bouncing-ball.opd"), app.error().c_str());
    for (int i = 0; i < 100; ++i) { testNow += 34; app.update(testNow, controls); }
    check(app.active(), app.error().c_str());
    controls.bDown = true; testNow += 34; app.update(testNow, controls);
    check(app.exiting(), "B requests exit"); app.stop(); controls.bDown = false;

    check(app.start("contract.opd"), app.error().c_str());
    app.update(testNow, controls);
    check(app.canvas().readPixel(1, 1) == 0xF800, "RGB565 image little-endian");
    controls.aDown = true; controls.x = 1;
    testNow += 10; app.update(testNow, controls);
    controls.aDown = false; controls.x = 0;
    testNow += 10; app.update(testNow, controls);
    testNow += 20; app.update(testNow, controls);
    check(app.active(), app.error().c_str());
    testNow += 40; app.update(testNow, controls);
    check(app.exiting(), app.error().c_str()); app.stop();

    check(app.start("robot-ports.opd"), app.error().c_str());
    check(testModes[16] == OUTPUT && testLevels[16] == LOW && testUartOpen, "robot init");
    for (int i = 0; i < 12; ++i) { testNow += 50; app.update(testNow, controls); }
    check(testLevels[16] == HIGH, "nonblocking GPIO timer");
    controls.aDown = true; testNow += 50; app.update(testNow, controls);
    controls.aDown = false; testNow += 50; app.update(testNow, controls);
    check(testTx == "hello\n", "partial UART writes retried");
    testRx = {'a', 0, 255}; testNow += 50; app.update(testNow, controls);
    check(testRx.empty(), "binary UART RX");
    app.pause();
    check(testModes[16] == INPUT && testLevels[16] == LOW && !testUartOpen, "pause releases GPIO/UART");
    app.resume();
    check(testModes[16] == OUTPUT && testLevels[16] == LOW && testUartOpen, "resume reconnects");
    app.stop(); check(testModes[16] == INPUT && !testUartOpen, "stop releases GPIO/UART");

    for (const char* name : {"loop-init.opd", "memory.opd", "bad-error.opd", "long-error.opd", "nul-error.opd", "circular.opd", "deep.opd", "bytecode.opd"}) {
      check(!app.start(name), name); check(!app.active(), "failed init closes Lua state");
      check(!app.error().isEmpty(), "failure includes error");
      check(app.error().length() <= 240, "error bounded before copying to host heap");
    }
    for (const char* name : {"loop-update.opd", "pin-denied.opd", "bad-callback.opd"}) {
      check(app.start(name), app.error().c_str());
      testNow += 40; app.update(testNow, controls);
      check(!app.active() && !app.error().isEmpty(), name);
      check(testModes[16] == INPUT && !testUartOpen, "runtime error releases hardware");
    }
    check(app.start("pause-error.opd"), app.error().c_str()); app.pause();
    check(!app.active() && testModes[16] == INPUT && !testUartOpen, "pause error cleanup");
    check(app.start("shutdown-error.opd"), app.error().c_str()); app.stop();
    check(!app.active() && !app.error().isEmpty() && testModes[16] == INPUT && !testUartOpen, "shutdown error cleanup");
    check(app.start("paused-shutdown.opd"), app.error().c_str()); app.pause(); app.stop();
    check(!app.error().isEmpty() && testModes[16] == INPUT && !testUartOpen, "shutdown invoked while paused but cannot reacquire pins");
    check(app.start("memory-update.opd"), app.error().c_str());
    app.update(testNow, controls);
    check(!app.active() && !app.error().isEmpty(), "OOM in callback is protected");

    opd::Bundle bundle;
    for (const char* name : {"truncated.opd", "traversal.opd", "duplicate.opd", "bad-pin.opd", "bad-uart.opd", "bad-api.opd", "trailing.opd", "missing-entry.opd"}) {
      check(!bundle.open(String("/apps/") + name), name);
      check(!bundle.error().isEmpty(), "bundle rejection has error");
    }
    // Restarting after errors must not retain input, hardware, cache or error.
    for (int i = 0; i < 20; ++i) {
      check(app.start("bouncing-ball.opd"), app.error().c_str());
      app.update(testNow, controls); app.stop();
    }
    std::cout << "PASS: real Lua + production bundle/runtime; partial LCD updates, image cache, low-memory fallbacks, lifecycle, input edges, modules, assets, GPIO/UART, budgets, malformed bundles, restarts\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL: " << error.what() << '\n'; return 1;
  }
}
