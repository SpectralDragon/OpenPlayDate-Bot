#include "network_service.h"
#include "rom_store.h"
#include <WiFi.h>
#include <LittleFS.h>

namespace {
String html(String value) {
  value.replace("&", "&amp;"); value.replace("<", "&lt;");
  value.replace(">", "&gt;"); value.replace("\"", "&quot;"); value.replace("'", "&#39;");
  return value;
}
}

void NetworkService::begin() {
  WiFi.persistent(false);
  WiFi.setHostname("openplay");
  char name[28], key[16], token[40];
  snprintf(name, sizeof(name), "OpenPlay-%04X", uint16_t(ESP.getEfuseMac() >> 32));
  snprintf(key, sizeof(key), "op%06u", unsigned(100000 + esp_random() % 900000));
  snprintf(token, sizeof(token), "%08x%08x%08x", esp_random(), esp_random(), esp_random());
  apName_ = name; apPassword_ = key; token_ = token;
  routes();
  if (settings_.wifiEnabled && !settings_.ssid.isEmpty()) connect();
  else WiFi.mode(WIFI_OFF);
}

void NetworkService::connect() {
  WiFi.mode(portal_ ? WIFI_AP_STA : WIFI_STA);
  WiFi.begin(settings_.ssid.c_str(), settings_.password.c_str());
  connecting_ = true;
  connectAt_ = millis();
}

void NetworkService::setEnabled(bool enabled) {
  settings_.wifiEnabled = enabled;
  settings_.save();
  connecting_ = false;
  if (!enabled) { stopPortal(); WiFi.disconnect(false, true); WiFi.mode(WIFI_OFF); }
  else if (!settings_.ssid.isEmpty()) connect();
}

void NetworkService::forget() {
  settings_.ssid = ""; settings_.password = ""; settings_.save();
  connecting_ = false;
  WiFi.disconnect(false, true);
  WiFi.mode(portal_ ? WIFI_AP_STA : WIFI_OFF);
}

void NetworkService::startPortal() {
  if (portal_) return;
  Serial.printf("PORTAL: starting heap=%u\n", ESP.getFreeHeap());
  settings_.wifiEnabled = true;
  settings_.save();
  if (!WiFi.mode(WIFI_AP_STA)) return;
  Serial.printf("PORTAL: radio ready heap=%u\n", ESP.getFreeHeap());
  if (!WiFi.softAP(apName_.c_str(), apPassword_.c_str())) return;
  WiFi.setTxPower(WIFI_POWER_8_5dBm);
  portal_ = true;
  dns_.start(53, "*", WiFi.softAPIP());
  server_.begin();
}

void NetworkService::stopPortal() {
  if (!portal_) return;
  if (upload_) upload_.close();
  dns_.stop(); server_.stop();
  WiFi.softAPdisconnect(true);
  portal_ = false;
  WiFi.mode(settings_.wifiEnabled && !settings_.ssid.isEmpty() ? WIFI_STA : WIFI_OFF);
}

String NetworkService::status() const {
  if (!settings_.wifiEnabled) return "Wi-Fi выключен";
  if (WiFi.status() == WL_CONNECTED) return WiFi.localIP().toString();
  if (connecting_) return "Подключаемся...";
  if (settings_.ssid.isEmpty()) return "Сеть не выбрана";
  return "Нет подключения";
}

void NetworkService::update(uint32_t now) {
  if (connecting_ && WiFi.status() == WL_CONNECTED) {
    connecting_ = false;
    configTime(0, 0, "pool.ntp.org", "time.google.com");
  }
  if (connecting_ && uint32_t(now - connectAt_) > 20000) {
    connecting_ = false;
    WiFi.disconnect(false);
  }
  if (portal_) { dns_.processNextRequest(); server_.handleClient(); }
}

bool NetworkService::authorized() {
  if (server_.arg("token") == token_) return true;
  server_.send(403, "text/plain; charset=utf-8", "Откройте главную страницу заново");
  return false;
}

void NetworkService::page() {
  String page = R"HTML(<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OpenPlay</title><style>body{font:17px system-ui;background:#15191d;color:#f5f3e9;max-width:560px;margin:32px auto;padding:16px}h1{color:#ffd34d}section{background:#242b30;padding:20px;border-radius:18px;margin:20px 0}label{display:block;margin:14px 0}input,button{font:inherit;box-sizing:border-box;width:100%;padding:12px;border-radius:10px;border:0;margin-top:6px}button{background:#ffd34d;color:#15191d;font-weight:700}small{color:#b8c6ce}li{overflow-wrap:anywhere}</style><h1>OpenPlay</h1><p>Настройки нашей мини-консоли</p>)HTML";
  page += "<p>Wi-Fi: " + html(status()) + "</p><section><h2>Домашняя сеть</h2><form action='/wifi' method='post'><input type='hidden' name='token' value='" + token_ + "'><label>Название сети (2,4 ГГц)<input name='ssid' maxlength='32' required value='" + html(settings_.ssid) + "'></label><label>Пароль<input type='password' name='password' maxlength='63' autocomplete='new-password'></label><button>Подключить</button></form><small>Для открытой сети оставьте пароль пустым.</small></section>";
  page += "<section><h2>Game Boy</h2><p>Добавьте игру .gb, до 2 МБ. Сейчас поддерживается обычный Game Boy, без звука.</p>";
  if (roms::available()) {
    page += "<form action='/rom?token=" + token_ + "' method='post' enctype='multipart/form-data'><label>Файл игры<input type='file' name='rom' accept='.gb' required></label><button>Загрузить игру</button></form><small>Имя файла — латинскими буквами. Дождитесь окончания загрузки, затем вернитесь в меню консоли.</small><ul>";
    for (const String& name : roms::list()) page += "<li>" + html(name) + "</li>";
    page += "</ul><p>Свободно: " + String((LittleFS.totalBytes() - LittleFS.usedBytes()) / 1024) + " КБ</p>";
  } else page += "<p>Хранилище недоступно. Файлы не стирались.</p>";
  page += "</section><p><small>Закрытие настройки на консоли отключит эту точку доступа.</small></p></html>";
  server_.sendHeader("Cache-Control", "no-store");
  server_.send(200, "text/html; charset=utf-8", page);
}

void NetworkService::routes() {
  server_.on("/", HTTP_GET, [this] { page(); });
  server_.on("/wifi", HTTP_POST, [this] {
    if (!authorized()) return;
    String ssid = server_.arg("ssid"), password = server_.arg("password");
    if (ssid.isEmpty() || ssid.length() > 32 || password.length() > 63 ||
        (!password.isEmpty() && password.length() < 8)) {
      server_.send(400, "text/plain; charset=utf-8", "Проверьте имя сети и пароль (не менее 8 символов)"); return;
    }
    settings_.ssid = ssid; settings_.password = password;
    settings_.wifiEnabled = true; settings_.save(); connect();
    server_.send(200, "text/html; charset=utf-8", "<meta charset='utf-8'><p>Подключаемся. Результат появится на экране консоли.</p><a href='/'>Назад</a>");
  });
  server_.on("/rom", HTTP_POST, [this] {
    if (!authorized()) return;
    if (!uploadComplete_ && uploadError_.isEmpty()) uploadError_ = "Файл не был загружен";
    if (!uploadError_.isEmpty()) {
      server_.send(400, "text/plain; charset=utf-8", uploadError_); return;
    }
    server_.send(200, "text/html; charset=utf-8", "<meta charset='utf-8'><p>Игра загружена! Вернитесь в Game Boy на консоли.</p><a href='/'>Назад</a>");
  }, [this] { uploadChunk(); });
  server_.onNotFound([this] {
    if (server_.method() == HTTP_GET) { server_.sendHeader("Location", "http://192.168.4.1/"); server_.send(302); }
    else server_.send(404);
  });
}

void NetworkService::uploadChunk() {
  HTTPUpload& event = server_.upload();
  if (event.status == UPLOAD_FILE_START) {
    if (upload_) upload_.close();
    uploadError_ = ""; uploadBytes_ = 0; uploadComplete_ = false;
    uploadName_ = roms::safeName(event.filename);
    if (server_.arg("token") != token_) uploadError_ = "Нет доступа";
    else if (!roms::available()) uploadError_ = "Хранилище недоступно";
    else if (uploadName_.isEmpty()) uploadError_ = "Нужен .gb с именем латиницей";
    else if (roms::list().size() >= 32 && !LittleFS.exists("/roms/" + uploadName_))
      uploadError_ = "В списке уже 32 игры";
    if (uploadError_.isEmpty()) {
      upload_ = LittleFS.open("/upload.tmp", "w");
      if (!upload_) uploadError_ = "Не удалось создать файл";
    }
  } else if (event.status == UPLOAD_FILE_WRITE && uploadError_.isEmpty()) {
    uploadBytes_ += event.currentSize;
    if (uploadBytes_ > roms::maxRomSize) uploadError_ = "Игра больше 2 МБ";
    else if (upload_.write(event.buf, event.currentSize) != event.currentSize)
      uploadError_ = "Не хватает места в хранилище";
  } else if (event.status == UPLOAD_FILE_END) {
    if (upload_) upload_.close();
    if (uploadError_.isEmpty()) {
      File file = LittleFS.open("/upload.tmp", "r");
      uploadError_ = roms::validate(file); file.close();
      if (uploadError_.isEmpty() && !LittleFS.rename("/upload.tmp", ("/roms/" + uploadName_).c_str()))
        uploadError_ = "Не удалось сохранить игру";
      uploadComplete_ = uploadError_.isEmpty();
    }
    if (!uploadError_.isEmpty() && roms::available()) LittleFS.remove("/upload.tmp");
  } else if (event.status == UPLOAD_FILE_ABORTED) {
    if (upload_) upload_.close();
    uploadError_ = "Загрузка прервана";
    if (roms::available()) LittleFS.remove("/upload.tmp");
  }
}
