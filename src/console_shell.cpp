#include "console_shell.h"
#include "rom_store.h"
#include "ui_text.h"
#include <WiFi.h>

bool ConsoleShell::begin() {
  settings_.begin();
  canvas_.setColorDepth(16);
  canvas_.setAttribute(PSRAM_ENABLE, true);
  if (!canvas_.createSprite(320, 240)) return false;
  const bool storage = roms::begin();
  Serial.printf("STORAGE: ready=%d\n", storage);
  network_.begin();
  eyes_.setTheme(settings_.theme);
  activityAt_ = millis();
  display_.fillScreen(TFT_BLACK);
  return true;
}

const char* ConsoleShell::pageName() const {
  const char* pages[] = {"eyes", "home", "settings", "wifi", "portal", "games", "playing", "paused", "about", "error"};
  return pages[static_cast<int>(page_)];
}

void ConsoleShell::printStatus() const {
  Serial.printf("SHELL: page=%s selected=%d theme=%u idle_ms=%u storage=%d game_frames=%u\n",
                pageName(), selected_, settings_.theme, settings_.idleMs(), roms::available(), game_.frames());
}

void ConsoleShell::show(Page page) {
  page_ = page; selected_ = 0; direction_ = 0;
  activityAt_ = millis(); refreshAt_ = 0; dirty_ = true;
  waitRelease_ = true; wasStickDown_ = false;
  if (page == Page::Games) games_ = roms::list();
  Serial.printf("SHELL: %s\n", pageName());
}

void ConsoleShell::sleep() {
  network_.stopPortal();
  eyes_.setTheme(settings_.theme);
  display_.fillScreen(TFT_BLACK);
  show(Page::Eyes);
}

int ConsoleShell::itemCount() const {
  switch (page_) {
    case Page::Home: return 3;
    case Page::Settings: return 4;
    case Page::Wifi: return 3;
    case Page::Games: return games_.size() + 1;
    case Page::Paused: return 4;
    default: return 0;
  }
}

void ConsoleShell::move(int delta) {
  const int count = itemCount();
  if (count) { selected_ = (selected_ + delta + count) % count; dirty_ = true; activityAt_ = millis(); }
}

void ConsoleShell::select() {
  activityAt_ = millis();
  switch (page_) {
    case Page::Eyes: show(Page::Home); break;
    case Page::Home:
      if (selected_ == 0) show(Page::Games);
      else if (selected_ == 1) show(Page::Settings);
      else sleep();
      break;
    case Page::Settings:
      if (selected_ == 0) show(Page::Wifi);
      else if (selected_ == 1) { settings_.theme = (settings_.theme + 1) % 3; settings_.save(); dirty_ = true; }
      else if (selected_ == 2) { settings_.idle = (settings_.idle + 1) % 4; settings_.save(); dirty_ = true; }
      else show(Page::About);
      break;
    case Page::Wifi:
      if (selected_ == 0) {
        portalReturn_ = Page::Wifi; network_.startPortal();
        if (network_.portalActive()) show(Page::Portal);
        else { message_ = "Не удалось включить точку доступа"; show(Page::Error); }
      } else if (selected_ == 1) { network_.setEnabled(!settings_.wifiEnabled); dirty_ = true; }
      else { network_.forget(); dirty_ = true; }
      break;
    case Page::Games:
      if (selected_ == int(games_.size())) {
        portalReturn_ = Page::Games; network_.startPortal();
        if (network_.portalActive()) show(Page::Portal);
        else { message_ = "Не удалось включить точку доступа"; show(Page::Error); }
      } else {
        network_.stopPortal();
        if (game_.start(games_[selected_])) show(Page::Playing);
        else { message_ = game_.error(); show(Page::Error); }
      }
      break;
    case Page::Paused:
      if (selected_ == 3) {
        if (game_.stop()) show(Page::Games);
        else { message_ = game_.error(); show(Page::Error); }
      } else {
        if (selected_ == 1) game_.pulseStart();
        if (selected_ == 2) game_.pulseSelect();
        game_.resume(); show(Page::Playing);
      }
      break;
    case Page::Error: back(); break;
    default: break;
  }
}

void ConsoleShell::back() {
  if (page_ == Page::Home) sleep();
  else if (page_ == Page::Portal) { network_.stopPortal(); show(portalReturn_); }
  else if (page_ == Page::Wifi || page_ == Page::About) show(Page::Settings);
  else if (page_ == Page::Settings || page_ == Page::Games) show(Page::Home);
  else if (page_ == Page::Playing) { game_.save(); show(Page::Paused); }
  else if (page_ == Page::Paused) { game_.resume(); show(Page::Playing); }
  else if (page_ == Page::Error) {
    if (game_.active() && !game_.stop()) { message_ = game_.error(); dirty_ = true; }
    else show(Page::Home);
  }
}

void ConsoleShell::update(uint32_t now, const Controls& controls) {
  network_.update(now);
  if (waitRelease_) {
    if (!controls.aDown && !controls.bDown && !controls.stickDown) waitRelease_ = false;
  } else if (page_ == Page::Eyes) {
    if (controls.nextMood || controls.nextColor || controls.blink) show(Page::Home);
  } else if (page_ == Page::Playing) {
    if (controls.stickDown && !wasStickDown_) stickAt_ = now;
    if (controls.stickDown && uint32_t(now - stickAt_) >= 700) {
      game_.save(); show(Page::Paused);
    } else if (!controls.stickDown && wasStickDown_) game_.pulseStart();
    wasStickDown_ = controls.stickDown;
  } else {
    int direction = controls.y > 0.55f ? 1 : controls.y < -0.55f ? -1 : 0;
    if (direction == 0 && fabsf(controls.x) > 0.65f) direction = controls.x > 0 ? 1 : -1;
    if (direction != direction_) {
      direction_ = direction;
      if (direction) { move(direction); repeatAt_ = now + 350; }
    } else if (direction && int32_t(now - repeatAt_) >= 0) {
      move(direction); repeatAt_ = now + 180;
    }
    if (controls.nextColor) back();
    else if (controls.nextMood || controls.blink) select();
  }

  if (page_ == Page::Eyes) {
    Controls faceControls = controls;
    faceControls.nextMood = faceControls.nextColor = faceControls.blink = false;
    eyes_.update(now, faceControls);
    return;
  }
  if (page_ == Page::Playing) {
    Controls gameControls = controls;
    if (waitRelease_) gameControls.aDown = gameControls.bDown = gameControls.stickDown = false;
    game_.update(gameControls);
    if (!game_.error().isEmpty()) { message_ = game_.error(); show(Page::Error); }
    return;
  }
  if (controls.aDown || controls.bDown || controls.stickDown ||
      fabsf(controls.x) > 0.3f || fabsf(controls.y) > 0.3f) activityAt_ = now;
  if (settings_.idleMs() && page_ != Page::Portal && page_ != Page::Paused && page_ != Page::Error &&
      uint32_t(now - activityAt_) >= settings_.idleMs()) { sleep(); return; }
  if ((page_ == Page::Wifi || page_ == Page::Portal) && uint32_t(now - refreshAt_) >= 2000) {
    dirty_ = true; refreshAt_ = now;
  }
  if (dirty_) { render(); dirty_ = false; }
}

void ConsoleShell::title(const String& text, const String& subtitle) {
  const auto p = settings_.palette();
  canvas_.fillSprite(p.background);
  uiText(canvas_, text, 14, 6, p.foreground, true, 282);
  uiText(canvas_, subtitle, 15, 35, p.muted);
  canvas_.fillCircle(300, 20, 4, WiFi.status() == WL_CONNECTED ? 0x77D3 : p.muted);
}

void ConsoleShell::row(int y, const String& label, const String& detail, bool active, int height) {
  const auto p = settings_.palette();
  canvas_.fillRoundRect(12, y, 296, height, 9, active ? p.accent : p.panel);
  const uint16_t color = active ? p.ink : p.foreground;
  canvas_.fillCircle(25, y + height / 2, 3, color);
  uiText(canvas_, label, 37, y + (detail.isEmpty() ? (height - 19) / 2 : 3), color);
  if (!detail.isEmpty()) uiText(canvas_, detail, 37, y + 22, active ? p.ink : p.muted);
}

void ConsoleShell::footer(const String& text) {
  const auto p = settings_.palette();
  canvas_.drawFastHLine(14, 217, 292, p.panel);
  uiText(canvas_, text, 15, 219, p.muted);
}

void ConsoleShell::render() {
  const auto p = settings_.palette();
  switch (page_) {
    case Page::Home:
      title("OpenPlay", "Маленькая консоль. Большие истории.");
      row(62, "Game Boy", "Коллекция игр", selected_ == 0, 47);
      row(113, "Настройки", "Wi-Fi, тема и ожидание", selected_ == 1, 47);
      row(164, "Глазки", "Вернуться в режим ожидания", selected_ == 2, 47);
      footer("A: открыть    B: глазки");
      break;
    case Page::Settings: {
      title("Настройки", "Устроим всё по-своему");
      const char* idleNames[] = {"30 сек", "1 мин", "2 мин", "Никогда"};
      row(62, "Wi-Fi", "", selected_ == 0, 34);
      row(100, String("Тема: ") + settings_.themeName(), "", selected_ == 1, 34);
      row(138, String("Глазки через: ") + idleNames[settings_.idle], "", selected_ == 2, 34);
      row(176, "О консоли", "", selected_ == 3, 34);
      footer("A: выбрать / изменить    B: назад");
      break;
    }
    case Page::Wifi:
      title("Wi-Fi", network_.status());
      row(65, "Настроить с телефона", "", selected_ == 0);
      row(113, settings_.wifiEnabled ? "Выключить Wi-Fi" : "Включить Wi-Fi", "", selected_ == 1);
      row(161, "Забыть сеть", "", selected_ == 2);
      footer("A: выбрать    B: назад");
      break;
    case Page::Portal:
      title("Подключим телефон", "Открой Wi-Fi на телефоне");
      uiText(canvas_, network_.apName(), 16, 68, p.accent, true);
      uiText(canvas_, "Пароль: " + network_.apPassword(), 16, 101, p.foreground);
      uiText(canvas_, "Затем открой в браузере:", 16, 131, p.muted);
      uiText(canvas_, "192.168.4.1", 16, 151, p.accent, true);
      uiText(canvas_, network_.status(), 16, 187, p.foreground);
      footer("B: закончить настройку");
      break;
    case Page::Games: {
      title("Game Boy", String("Игр: ") + games_.size() + "    .gb / без звука");
      if (games_.empty()) {
        uiText(canvas_, "Пока здесь нет игр", 16, 76, p.foreground, true);
        uiText(canvas_, "Добавим первую с телефона?", 16, 111, p.muted);
        row(157, "Добавить игры", "Через Wi-Fi и браузер", true, 48);
      } else {
        const int start = max(0, selected_ - 2);
        for (int i = start; i < min(start + 3, itemCount()); ++i)
          row(63 + (i - start) * 49, i < int(games_.size()) ? games_[i] : "Добавить игры", "", i == selected_);
      }
      footer("A: запустить    B: главное меню");
      break;
    }
    case Page::Paused: {
      title("Пауза", "Game Boy");
      const char* items[] = {"Продолжить", "Нажать START", "Нажать SELECT", "Сохранить и выйти"};
      for (int i = 0; i < 4; ++i) row(62 + i * 38, items[i], "", selected_ == i, 34);
      footer("A: выбрать    B: продолжить");
      break;
    }
    case Page::About:
      title("Наша консоль", "OpenPlay OS 0.1");
      uiText(canvas_, "ESP32-S3 / 16 МБ Flash / 8 МБ RAM", 15, 68, p.foreground);
      uiText(canvas_, "Экран: 320 x 240", 15, 96, p.foreground);
      uiText(canvas_, "Меню, глазки, Wi-Fi и Game Boy", 15, 124, p.foreground);
      uiText(canvas_, "Часы и новые программы - позже", 15, 152, p.muted);
      uiText(canvas_, "Ядро Game Boy: Peanut-GB / MIT", 15, 180, p.muted);
      footer("B: назад");
      break;
    case Page::Error:
      title("Не получилось", "Можно вернуться и попробовать ещё");
      uiText(canvas_, message_, 15, 83, p.foreground);
      uiText(canvas_, "Файлы игры не стирались.", 15, 126, p.muted);
      footer("A / B: вернуться");
      break;
    default: return;
  }
  canvas_.pushSprite(0, 0);
}

void ConsoleShell::screenshot() {
  if (page_ == Page::Playing) { game_.screenshot(); return; }
  if (page_ == Page::Eyes) { Serial.println("SCREEN: eyes; use m for menu"); return; }
  if (dirty_) { render(); dirty_ = false; }
  Serial.print("P6\n320 240\n255\n");
  uint8_t row[960];
  for (int y = 0; y < 240; ++y) {
    for (int x = 0; x < 320; ++x) {
      const uint16_t c = canvas_.readPixel(x, y);
      row[x * 3] = ((c >> 11) & 31) * 255 / 31;
      row[x * 3 + 1] = ((c >> 5) & 63) * 255 / 63;
      row[x * 3 + 2] = (c & 31) * 255 / 31;
    }
    Serial.write(row, sizeof(row));
  }
}

void ConsoleShell::command(char command) {
  // Service controls for USB diagnostics; normal navigation uses physical inputs.
  if (command == 'v') { screenshot(); return; }
  if (command == 'm') {
    if (game_.active()) { game_.save(); show(Page::Paused); }
    else { network_.stopPortal(); show(Page::Home); }
  } else if (command == 'z' && !game_.active()) sleep();
  else if (command == 'a') select();
  else if (command == 'b') back();
  else if (command == 'j') move(1);
  else if (command == 'k') move(-1);
}
