#include "gb_video.h"
#include <array>
#include <vector>
#include <random>
#include <iostream>
#include <stdexcept>

void check(bool condition, const char* message) {
  if (!condition) throw std::runtime_error(message);
}

int main() {
  try {
    std::array<std::array<uint8_t, gbvideo::frameBytes>, 3> buffers{};
    gbvideo::Mailbox mailbox;
    mailbox.reset(buffers[0].data(), buffers[1].data(), buffers[2].data());
    check(mailbox.consume() == nullptr, "no uninitialized frame");
    memset(mailbox.writing(), 1, gbvideo::frameBytes);
    check(!mailbox.publish(), "first frame not replaced");
    const uint8_t* reading = mailbox.consume();
    check(reading[0] == 1, "first frame delivered");
    for (int i = 2; i < 10000; ++i) {
      memset(mailbox.writing(), i & 255, gbvideo::frameBytes);
      const bool replaced = mailbox.publish();
      check(replaced == (i != 2), "only pending frames get replaced");
      check(reading[0] == 1 && reading[gbvideo::frameBytes - 1] == 1, "stalled renderer buffer never overwritten");
    }
    check(mailbox.consume()[0] == (9999 & 255), "latest frame delivered without a queue backlog");
    mailbox.publish(); mailbox.discard();
    check(mailbox.consume() == nullptr, "pause discards pending frame");

    gbvideo::Scaler scaler;
    std::vector<uint8_t> frame(gbvideo::frameBytes), previous(gbvideo::frameBytes);
    std::vector<uint16_t> screen(320 * 240, 0);
    std::array<uint16_t, gbvideo::width * gbvideo::stripeRows + 2> stripe{};
    auto apply = [&](bool valid) {
      const auto damage = gbvideo::findDamage(frame.data(), previous.data(), valid);
      check(damage.count <= gbvideo::Damage::maxRects, "damage list bounded");
      uint32_t bytes = 0;
      for (size_t i = 0; i < damage.count; ++i) {
        auto rect = gbvideo::destination(damage.rects[i]);
        check(rect.x + rect.w <= gbvideo::width && rect.y + rect.h <= gbvideo::height, "LCD bounds");
        for (int y = rect.y; y < rect.y + rect.h; y += gbvideo::stripeRows) {
          int rows = std::min(gbvideo::stripeRows, int(rect.y + rect.h - y));
          stripe.fill(0xBEEF);
          scaler.stripe(frame.data(), rect.x, y, rect.w, rows, stripe.data() + 1);
          check(stripe.front() == 0xBEEF && stripe[1 + rect.w * rows] == 0xBEEF, "stripe does not overrun DMA allocation");
          for (int row = 0; row < rows; ++row) for (int x = 0; x < rect.w; ++x) {
            uint16_t wire = stripe[1 + row * rect.w + x];
            screen[(y + row) * 320 + gbvideo::offsetX + rect.x + x] = uint16_t((wire << 8) | (wire >> 8));
          }
          scaler.stripe(frame.data(), rect.x, y, rect.w, rows, stripe.data() + 1, false);
          for (int row = 0; row < rows; ++row) for (int x = 0; x < rect.w; ++x)
            check(stripe[1 + row * rect.w + x] == scaler.pixel(frame.data(), rect.x + x, y + row),
                  "normal SPI writer gets native RGB565, DMA gets wire order");
          bytes += rect.w * rows * 2;
        }
      }
      for (int y = 0; y < 240; ++y) for (int x = 0; x < 320; ++x) {
        uint16_t expected = x >= gbvideo::offsetX && x < gbvideo::offsetX + gbvideo::width
          ? scaler.pixel(frame.data(), x - gbvideo::offsetX, y) : 0;
        check(screen[y * 320 + x] == expected, "partial updates exactly match a full nearest-neighbour frame");
      }
      previous = frame;
      return bytes;
    };
    check(apply(false) == 266 * 240 * 2, "initial full frame");
    check(apply(true) == 0, "unchanged frame sends no pixels");
    frame.back() = 3;
    check(apply(true) < 500, "single changed tile avoids full-frame bandwidth");
    for (size_t i = 0; i < frame.size(); ++i) frame[i] = i & 3;
    apply(true);
    // Force fragmented tile changes; bounded fallback still gives a correct LCD.
    for (int y = 0; y < 144; y += 8) for (int x = 0; x < 160; x += 8)
      if (((x + y) / 8) & 1) frame[y * 160 + x] ^= 1;
    check(gbvideo::findDamage(frame.data(), previous.data(), true).count == 1, "fragmented frame falls back to one window");
    apply(true);
    std::mt19937 random(42);
    uint64_t sparseBytes = 0;
    for (int iteration = 0; iteration < 250; ++iteration) {
      // Local 8x8 sprite changes including scaling boundaries and screen edges.
      int x = random() % 153, y = random() % 137;
      for (int row = 0; row < 8; ++row) for (int col = 0; col < 8; ++col)
        frame[(y + row) * 160 + x + col] = random() & 3;
      sparseBytes += apply(true);
    }
    apply(false); // Resume after a menu must redraw even unchanged source data.
    check(sparseBytes / 250 < 2000, "local animation bandwidth stays below 2 KiB per update");
    std::cout << "PASS: triple buffering, latest frame, stall/pause, exact scaling and RGB565 order, partial damage, full fallback, unchanged frames, DMA bounds; local animation avg="
              << sparseBytes / 250 << " bytes (full frame=127680)\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "FAIL: " << error.what() << '\n'; return 1;
  }
}
