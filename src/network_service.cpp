#include "network_service.h"
#include "rom_store.h"
#include "nes_store.h"
#include "opd_bundle.h"
#include <WiFi.h>
#include <LittleFS.h>
#include <esp_wifi.h>
#include <ArduinoJson.h>

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
  // Stay responsive to LAN discovery/uploads between Lua frames.
  WiFi.setSleep(false);
  // The USB breadboard powers the LCD too. Use the same moderate power as
  // the portal when associating; full Wi-Fi TX power caused supply resets.
  // WiFi.mode() starts the driver synchronously, but Arduino's STA_STARTED
  // event bit may still be pending. Its setTxPower() wrapper can therefore
  // silently reject this early call. Apply the limit to the driver directly.
  const esp_err_t power = esp_wifi_set_max_tx_power(WIFI_POWER_8_5dBm);
  if (power != ESP_OK) Serial.printf("NETWORK: TX power limit failed: %d\n", power);
  WiFi.begin(settings_.ssid.c_str(), settings_.password.c_str());
  connecting_ = true;
  connectAt_ = millis();
}

void NetworkService::pauseForGame() {
  stopPortal(); stopServices(); connecting_ = false; pausedForGame_ = true;
  // Keep NVS settings and the initialized network interfaces. Deinitializing
  // and immediately reinitializing Wi-Fi can race Arduino's event callbacks.
  radioStopped_ = WiFi.getMode() != WIFI_OFF && esp_wifi_stop() == ESP_OK;
}

void NetworkService::resumeAfterGame() {
  if (!pausedForGame_) return;
  pausedForGame_ = false;
  if (radioStopped_) { esp_wifi_start(); radioStopped_ = false; }
  if (settings_.wifiEnabled && !settings_.ssid.isEmpty()) connect();
}

void NetworkService::setEnabled(bool enabled) {
  settings_.wifiEnabled = enabled;
  settings_.save();
  connecting_ = false;
  if (!enabled) { stopPortal(); stopServices(); WiFi.disconnect(false, true); WiFi.mode(WIFI_OFF); }
  else if (!settings_.ssid.isEmpty()) connect();
}

void NetworkService::forget() {
  settings_.ssid = ""; settings_.password = ""; settings_.save();
  connecting_ = false;
  WiFi.disconnect(false, true);
  WiFi.mode(portal_ ? WIFI_AP_STA : WIFI_OFF);
  if (!portal_) stopServices();
}

void NetworkService::startPortal() {
  if (portal_) return;
  Serial.printf("PORTAL: starting heap=%u\n", ESP.getFreeHeap());
  settings_.wifiEnabled = true;
  settings_.save();
  if (!WiFi.mode(WIFI_AP_STA)) return;
  WiFi.setSleep(false);
  esp_wifi_set_max_tx_power(WIFI_POWER_8_5dBm);
  Serial.printf("PORTAL: radio ready heap=%u\n", ESP.getFreeHeap());
  if (!WiFi.softAP(apName_.c_str(), apPassword_.c_str())) return;
  portal_ = true;
  dns_.start(53, "*", WiFi.softAPIP());
  services();
}

void NetworkService::stopPortal() {
  if (!portal_) return;
  dns_.stop();
  WiFi.softAPdisconnect(true);
  portal_ = false;
  WiFi.mode(settings_.wifiEnabled && !settings_.ssid.isEmpty() ? WIFI_STA : WIFI_OFF);
  if (WiFi.status() != WL_CONNECTED) stopServices();
}

void NetworkService::services() {
  if (!serverActive_) { server_.begin(); serverActive_ = true; }
  if (!discoveryActive_) discoveryActive_ = discovery_.begin(42420) == 1;
}

void NetworkService::stopServices() {
  if (upload_) upload_.close();
  if (serverActive_) server_.stop();
  if (discoveryActive_) discovery_.stop();
  serverActive_ = discoveryActive_ = false;
  uploadComplete_ = false;
  if (roms::available()) LittleFS.remove("/upload.tmp");
}

String NetworkService::studioInfo(bool session) const {
  DynamicJsonDocument doc(768);
  char id[20]; snprintf(id, sizeof(id), "%012llx", ESP.getEfuseMac());
  doc["product"] = "OpenPlay"; doc["protocol"] = 1;
  doc["id"] = id; doc["name"] = apName_; doc["port"] = 80;
  doc["api"] = 1; doc["maxBundle"] = opd::maxBundleSize;
  doc["storage"] = roms::available();
  doc["imageVersion"] = 2; doc["audio"] = false;
  if (session) doc["token"] = token_;
  String json; serializeJson(doc, json); return json;
}

void NetworkService::discover() {
  // One bounded datagram per loop; discovery never broadcasts credentials.
  const int size = discovery_.parsePacket();
  if (!size) return;
  char request[32]; int count = discovery_.read(request, sizeof(request));
  discovery_.flush();
  constexpr char query[] = "OPENPLAY_DISCOVER_V1";
  if (count != sizeof(query)-1 || size != count || memcmp(request, query, count)) return;
  ++discoveryRequests_;
  const String json = studioInfo();
  discovery_.beginPacket(discovery_.remoteIP(), discovery_.remotePort());
  discovery_.write(reinterpret_cast<const uint8_t*>(json.c_str()), json.length());
  discovery_.endPacket();
}

String NetworkService::status() const {
  if (pausedForGame_) return "Пауза на время игры";
  if (!settings_.wifiEnabled) return "Wi-Fi выключен";
  if (WiFi.status() == WL_CONNECTED) return WiFi.localIP().toString();
  if (connecting_) return "Подключаемся...";
  if (settings_.ssid.isEmpty()) return "Сеть не выбрана";
  return "Нет подключения";
}

void NetworkService::printStatus() const {
  Serial.printf("LAN: http=%d discovery=%d rssi=%d queries=%u sessions=%u\n",
                serverActive_, discoveryActive_, WiFi.RSSI(), discoveryRequests_, studioRequests_);
}

void NetworkService::update(uint32_t now) {
  if (pausedForGame_) return;
  if (connecting_ && WiFi.status() == WL_CONNECTED) {
    connecting_ = false;
    configTime(0, 0, "pool.ntp.org", "time.google.com");
  }
  if (connecting_ && uint32_t(now - connectAt_) > 20000) {
    connecting_ = false;
    WiFi.disconnect(false);
  }
  if (portal_ || (settings_.wifiEnabled && WiFi.status() == WL_CONNECTED)) {
    services();
    if (portal_) dns_.processNextRequest();
    if (discoveryActive_) discover();
    server_.handleClient();
  } else if (serverActive_) stopServices();
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
  page += "</section><section><h2>NES / Денди</h2><p>Игры .nes (iNES 1.0), до 2 МБ. Один игрок, без звука.</p>";
  if (roms::available()) {
    page += "<form action='/nes?token=" + token_ + "' method='post' enctype='multipart/form-data'><label>Файл игры<input type='file' name='rom' accept='.nes' required></label><button>Загрузить игру NES</button></form><small>После загрузки откройте NES / Денди на консоли. Поддерживаются картриджи типов 0, 1, 2, 3, 4, 7, 9, 10, 11 и 66.</small><ul>";
    for (const String& name : nesroms::list()) page += "<li>" + html(name) + "</li>";
    page += "</ul>";
  } else page += "<p>Хранилище недоступно.</p>";
  page += "</section><section><h2>Lua-программы</h2><p>Свои игры и программы для робота: .opd, до 2 МБ.</p>";
  if (roms::available()) {
    page += "<form action='/opd?token=" + token_ + "' method='post' enctype='multipart/form-data'><label>Файл программы<input type='file' name='opd' accept='.opd' required></label><button>Загрузить программу</button></form><small>После загрузки откройте Lua-программы на консоли.</small><ul>";
    for (const String& name : opd::list()) page += "<li>" + html(name) + "</li>";
    page += "</ul>";
  } else page += "<p>Хранилище недоступно.</p>";
  page += "</section><p><small>Закрытие настройки на консоли отключит эту точку доступа.</small></p></html>";
  server_.sendHeader("Cache-Control", "no-store");
  server_.send(200, "text/html; charset=utf-8", page);
}

void NetworkService::routes() {
  const char* headers[] = {"X-OpenPlay-Studio", "Origin"}; server_.collectHeaders(headers, 2);
  server_.on("/api/info", HTTP_GET, [this] {
    server_.sendHeader("Cache-Control", "no-store");
    server_.send(200, "application/json", studioInfo());
  });
  server_.on("/api/studio", HTTP_GET, [this] {
    // A custom header keeps a browser on another origin from obtaining the token.
    if (server_.header("X-OpenPlay-Studio") != "1" || !server_.header("Origin").isEmpty()) {
      server_.send(403, "application/json", "{\"ok\":false,\"error\":\"Studio header required\"}"); return;
    }
    ++studioRequests_;
    server_.sendHeader("Cache-Control", "no-store");
    server_.send(200, "application/json", studioInfo(true));
  });
  server_.on("/api/apps", HTTP_POST, [this] {
    if (!authorized()) return;
    bool completed = uploadComplete_ && uploadBundle_ && studioUpload_; uploadComplete_ = false;
    if (!completed && uploadError_.isEmpty()) uploadError_ = "Файл не был загружен";
    if (!uploadError_.isEmpty()) {
      DynamicJsonDocument doc(512); doc["ok"] = false; doc["error"] = uploadError_;
      String json; serializeJson(doc,json); server_.send(400,"application/json",json); return;
    }
    const String error = launchStudio_ ? launchStudio_(uploadName_) : String("Запуск из Studio недоступен");
    DynamicJsonDocument doc(768); doc["ok"] = error.isEmpty(); doc["file"] = uploadName_;
    doc["bytes"] = uploadBytes_; doc["running"] = error.isEmpty();
    if (!error.isEmpty()) doc["error"] = error;
    String json; serializeJson(doc,json); server_.send(error.isEmpty() ? 200 : 422,"application/json",json);
  }, [this] { uploadChunk(true, true); });
  server_.on("/", HTTP_GET, [this] {
    if (portal_) page();
    else server_.send(200,"text/html; charset=utf-8","<meta charset='utf-8'><h1>OpenPlay</h1><p>Консоль доступна в OpenPlay Studio. Настройка Wi-Fi открывается из меню консоли.</p>");
  });
  server_.on("/wifi", HTTP_POST, [this] {
    if (!portal_) { server_.send(403); return; }
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
    if (!portal_) { server_.send(403); return; }
    if (!authorized()) return;
    bool completed = uploadComplete_ && !uploadBundle_ && !uploadNes_;
    uploadComplete_ = false;
    if (!completed && uploadError_.isEmpty()) uploadError_ = "Файл не был загружен";
    if (!uploadError_.isEmpty()) {
      server_.send(400, "text/plain; charset=utf-8", uploadError_); return;
    }
    server_.send(200, "text/html; charset=utf-8", "<meta charset='utf-8'><p>Игра загружена! Вернитесь в Game Boy на консоли.</p><a href='/'>Назад</a>");
  }, [this] { uploadChunk(); });
  server_.on("/nes", HTTP_POST, [this] {
    if (!portal_) { server_.send(403); return; }
    if (!authorized()) return;
    const bool completed = uploadComplete_ && uploadNes_ && !uploadBundle_;
    uploadComplete_ = false;
    if (!completed && uploadError_.isEmpty()) uploadError_ = "Файл не был загружен";
    if (!uploadError_.isEmpty()) {
      server_.send(400, "text/plain; charset=utf-8", uploadError_); return;
    }
    server_.send(200, "text/html; charset=utf-8", "<meta charset='utf-8'><p>Игра загружена! Откройте NES / Денди на консоли.</p><a href='/'>Назад</a>");
  }, [this] { uploadChunk(false, false, true); });
  server_.on("/opd", HTTP_POST, [this] {
    if (!portal_) { server_.send(403); return; }
    if (!authorized()) return;
    bool completed = uploadComplete_ && uploadBundle_;
    uploadComplete_ = false;
    if (!completed && uploadError_.isEmpty()) uploadError_ = "Файл не был загружен";
    if (!uploadError_.isEmpty()) { server_.send(400, "text/plain; charset=utf-8", uploadError_); return; }
    server_.send(200, "text/html; charset=utf-8", "<meta charset='utf-8'><p>Программа загружена! Откройте Lua-программы на консоли.</p><a href='/'>Назад</a>");
  }, [this] { uploadChunk(true); });
  server_.onNotFound([this] {
    if (server_.method() == HTTP_GET) { server_.sendHeader("Location", "http://192.168.4.1/"); server_.send(302); }
    else server_.send(404);
  });
}

void NetworkService::uploadChunk(bool bundle, bool studio, bool nes) {
  const String directory = bundle ? "/apps/" : nes ? "/nes/" : "/roms/";
  HTTPUpload& event = server_.upload();
  if (event.status == UPLOAD_FILE_START) {
    if (upload_) upload_.close();
    uploadError_ = ""; uploadBytes_ = 0; uploadComplete_ = false;
    uploadBundle_ = bundle; studioUpload_ = studio; uploadNes_ = nes;
    uploadName_ = bundle ? opd::safeName(event.filename) : nes ? nesroms::safeName(event.filename) : roms::safeName(event.filename);
    if ((!studio && !portal_) || server_.arg("token") != token_ ||
        (studio && (server_.header("X-OpenPlay-Studio") != "1" || !server_.header("Origin").isEmpty()))) uploadError_ = "Нет доступа";
    else if (!roms::available()) uploadError_ = "Хранилище недоступно";
    else if (uploadName_.isEmpty()) uploadError_ = bundle ? "Нужен .opd с именем a-z, 0-9, - или _" : nes ? "Нужен .nes с именем латиницей" : "Нужен .gb с именем латиницей";
    else if (nes && !nesroms::begin()) uploadError_ = "Не удалось открыть хранилище NES";
    else if ((bundle ? opd::list().size() : nes ? nesroms::list().size() : roms::list().size()) >= 32 &&
             !LittleFS.exists(directory + uploadName_))
      uploadError_ = "В списке уже 32 файла";
    if (studio && uploadError_.isEmpty() && (!prepareStudio_ || !prepareStudio_()))
      uploadError_ = "Закройте игру на консоли перед загрузкой";
    if (uploadError_.isEmpty()) {
      upload_ = LittleFS.open("/upload.tmp", "w");
      if (!upload_) uploadError_ = "Не удалось создать файл";
    }
  } else if (event.status == UPLOAD_FILE_WRITE && uploadError_.isEmpty()) {
    uploadBytes_ += event.currentSize;
    if (uploadBytes_ > (bundle ? opd::maxBundleSize : roms::maxRomSize)) uploadError_ = "Файл больше 2 МБ";
    else if (upload_.write(event.buf, event.currentSize) != event.currentSize)
      uploadError_ = "Не хватает места в хранилище";
  } else if (event.status == UPLOAD_FILE_END) {
    if (upload_) upload_.close();
    if (uploadError_.isEmpty()) {
      if (bundle) {
        opd::Bundle candidate;
        if (!candidate.open("/upload.tmp")) uploadError_ = candidate.error();
        candidate.close();
      } else {
        File file = LittleFS.open("/upload.tmp", "r");
        uploadError_ = nes ? nesroms::validate(file) : roms::validate(file); file.close();
      }
      if (uploadError_.isEmpty() && !LittleFS.rename("/upload.tmp", (directory + uploadName_).c_str()))
        uploadError_ = "Не удалось сохранить файл";
      uploadComplete_ = uploadError_.isEmpty();
    }
    if (!uploadError_.isEmpty() && roms::available()) LittleFS.remove("/upload.tmp");
  } else if (event.status == UPLOAD_FILE_ABORTED) {
    if (upload_) upload_.close();
    uploadError_ = "Загрузка прервана";
    if (roms::available()) LittleFS.remove("/upload.tmp");
  }
}
