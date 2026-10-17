#include "opd_bundle.h"
#include "rom_store.h"
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <algorithm>
#include <memory>
#include <new>

namespace {
bool identifier(const String& value, size_t limit) {
  if (value.isEmpty() || value.length() > limit) return false;
  for (char c : value)
    if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_')) return false;
  return true;
}
uint32_t le32(const uint8_t* b) {
  return uint32_t(b[0]) | (uint32_t(b[1]) << 8) | (uint32_t(b[2]) << 16) | (uint32_t(b[3]) << 24);
}
}

bool opd::availablePin(int pin) {
  return pin == 1 || pin == 2 || pin == 16 || pin == 17 || pin == 18 || pin == 21;
}

bool opd::safePath(const String& path) {
  if (path.isEmpty() || path.length() > maxPath || path[0] == '/' || path.endsWith("/")) return false;
  String part;
  for (char c : path) {
    if (c == '/') {
      if (part.isEmpty() || part == "." || part == "..") return false;
      part = "";
    } else {
      if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') ||
            (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.')) return false;
      part += c;
    }
  }
  return part != "." && part != "..";
}

String opd::safeName(const String& name) {
  if (!name.endsWith(".opd") || !identifier(name.substring(0, name.length() - 4), 40)) return "";
  return name;
}

std::vector<String> opd::list() {
  std::vector<String> names;
  if (!roms::available()) return names;
  File dir = LittleFS.open("/apps");
  File file;
  while ((file = dir.openNextFile())) {
    String name = file.name();
    name = name.substring(name.lastIndexOf('/') + 1);
    if (!file.isDirectory() && !safeName(name).isEmpty() && names.size() < 32) names.push_back(name);
    file.close();
  }
  std::sort(names.begin(), names.end());
  return names;
}

void opd::Bundle::close() {
  file_.close(); entries_.clear(); manifest_ = Manifest{};
}

bool opd::Bundle::fail(const char* error) { error_ = error; close(); return false; }

const opd::Entry* opd::Bundle::find(const String& path) const {
  for (const auto& entry : entries_) if (entry.path == path) return &entry;
  return nullptr;
}

bool opd::Bundle::read(const Entry& entry, size_t offset, void* data, size_t size) {
  if (!file_ || offset > entry.size || size > entry.size - offset) return false;
  return file_.seek(entry.offset + offset) && file_.read(static_cast<uint8_t*>(data), size) == size;
}

bool opd::Bundle::open(const String& path) {
  close(); error_ = "";
  file_ = LittleFS.open(path, "r");
  if (!file_ || file_.size() < 12 || file_.size() > maxBundleSize) return fail("Неверный размер .opd");
  uint8_t header[12];
  if (file_.read(header, 12) != 12 || memcmp(header, "OPD1", 4)) return fail("Нужен бандл OPD1");
  const uint32_t manifestSize = le32(header + 4), count = le32(header + 8);
  if (!manifestSize || manifestSize > 4096 || !count || count > maxFiles || manifestSize > file_.size() - 12)
    return fail("Неверный заголовок .opd");
  std::unique_ptr<char[]> json(new (std::nothrow) char[manifestSize + 1]);
  if (!json) return fail("Не хватает памяти манифеста");
  if (file_.readBytes(json.get(), manifestSize) != manifestSize) return fail("Не прочитан манифест");
  json[manifestSize] = 0;
  DynamicJsonDocument doc(8192);
  if (deserializeJson(doc, json.get(), manifestSize) || !doc.is<JsonObject>()) return fail("Неверный JSON манифеста");
  if (!doc["api"].is<int>() || doc["api"].as<int>() != 1) return fail("Неизвестная версия API");
  if (!doc["id"].is<const char*>() || !doc["name"].is<const char*>() ||
      !doc["kind"].is<const char*>() || !doc["entry"].is<const char*>()) return fail("Неполный манифест");
  manifest_.id = doc["id"].as<const char*>(); manifest_.name = doc["name"].as<const char*>();
  manifest_.kind = doc["kind"].as<const char*>(); manifest_.entry = doc["entry"].as<const char*>();
  if (!identifier(manifest_.id, 40) || manifest_.name.isEmpty() || manifest_.name.length() > 80 ||
      (manifest_.kind != "game" && manifest_.kind != "robot") || !safePath(manifest_.entry) ||
      !manifest_.entry.endsWith(".lua")) return fail("Неверные поля манифеста");
  for (char c : manifest_.name) if (uint8_t(c) < 32) return fail("Неверное название программы");
  if (!doc["fps"].isNull() && (!doc["fps"].is<int>() || doc["fps"].as<int>() < 1 || doc["fps"].as<int>() > 60))
    return fail("Частота кадров: от 1 до 60");
  manifest_.fps = doc["fps"] | 30;
  JsonVariant permissions = doc["permissions"];
  if (!permissions.isNull() && !permissions.is<JsonObject>()) return fail("Неверные разрешения");
  if (permissions.is<JsonObject>()) {
    for (JsonPair field : permissions.as<JsonObject>())
      if (strcmp(field.key().c_str(), "gpio") && strcmp(field.key().c_str(), "uart")) return fail("Неизвестное разрешение");
  }
  JsonVariant gpio = permissions["gpio"];
  if (!gpio.isNull() && (!gpio.is<JsonArray>() || gpio.size() > 6)) return fail("Неверный список GPIO");
  for (JsonVariant value : gpio.as<JsonArray>()) {
    if (!value.is<int>() || !availablePin(value.as<int>())) return fail("Этот GPIO недоступен");
    int pin = value.as<int>();
    if (std::find(manifest_.gpio.begin(), manifest_.gpio.end(), pin) != manifest_.gpio.end()) return fail("Повтор GPIO");
    manifest_.gpio.push_back(pin);
  }
  JsonVariant uart = permissions["uart"];
  if (!uart.isNull()) {
    if (!uart.is<JsonObject>() || !uart["port"].is<int>() || uart["port"].as<int>() != 1 ||
        !uart["tx"].is<int>() || !uart["rx"].is<int>() || !uart["baud"].is<int>()) return fail("Неверный UART");
    manifest_.uartTx = uart["tx"].as<int>(); manifest_.uartRx = uart["rx"].as<int>();
    int baud = uart["baud"].as<int>();
    if (baud < 300 || baud > 115200 || !availablePin(manifest_.uartTx) || !availablePin(manifest_.uartRx) ||
        manifest_.uartTx == manifest_.uartRx ||
        std::find(manifest_.gpio.begin(), manifest_.gpio.end(), manifest_.uartTx) != manifest_.gpio.end() ||
        std::find(manifest_.gpio.begin(), manifest_.gpio.end(), manifest_.uartRx) != manifest_.gpio.end())
      return fail("Конфликт портов или скорости UART");
    manifest_.uartBaud = baud;
  }
  if (manifest_.kind != "robot" && (!manifest_.gpio.empty() || manifest_.uartTx >= 0))
    return fail("Порты доступны только robot-программам");
  // Index in place: assets are never extracted into the filesystem.
  for (uint32_t i = 0; i < count; ++i) {
    uint8_t record[6];
    if (file_.read(record, 6) != 6) return fail("Обрезана таблица файлов");
    uint16_t length = record[0] | (uint16_t(record[1]) << 8);
    uint32_t size = le32(record + 2);
    if (!length || length > maxPath || size > maxBundleSize) return fail("Неверная запись файла");
    char name[maxPath + 1];
    if (file_.readBytes(name, length) != length || memchr(name, 0, length)) return fail("Неверное имя файла");
    name[length] = 0;
    String nameString(name);
    if (!safePath(nameString) || find(nameString)) return fail("Повтор или неверный путь файла");
    if (file_.position() > file_.size() || size > file_.size() - file_.position()) return fail("Обрезан файл бандла");
    if (nameString.endsWith(".lua") && (!size || size > maxScriptSize)) return fail("Lua-файл: от 1 байта до 64 КБ");
    entries_.push_back({nameString, uint32_t(file_.position()), size});
    if (!file_.seek(file_.position() + size)) return fail("Ошибка чтения бандла");
  }
  if (file_.position() != file_.size() || !find(manifest_.entry)) return fail("Нет entry или лишние данные");
  return true;
}
