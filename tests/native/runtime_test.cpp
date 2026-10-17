#include "lua_app.h"
#include "LittleFS.h"
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
    std::cout << "PASS: real Lua + production bundle/runtime; lifecycle, input edges, modules, assets, image, GPIO/UART, budgets, malformed bundles, restarts\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL: " << error.what() << '\n'; return 1;
  }
}
