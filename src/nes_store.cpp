#include "nes_store.h"
#include "rom_store.h"
#include <LittleFS.h>
#include <algorithm>

bool nesroms::begin() { return roms::available() && (LittleFS.exists("/nes") || LittleFS.mkdir("/nes")); }

String nesroms::validate(File& file) {
  if (!file || file.size() < 16) return "Нужен картридж .nes";
  uint8_t bytes[16];
  file.seek(0);
  if (file.read(bytes, sizeof(bytes)) != sizeof(bytes)) return "Ошибка чтения NES ROM";
  nescartridge::Header header;
  const char* error = nescartridge::parse(bytes, file.size(), header);
  file.seek(0);
  return error ? String(error) : String("");
}

String nesroms::safeName(const String& uploadedName) {
  String source = uploadedName; source.toLowerCase();
  if (!source.endsWith(".nes")) return "";
  String name;
  const int start = max(source.lastIndexOf('/'), source.lastIndexOf('\\')) + 1;
  for (int i = start; i < int(source.length()) - 4 && name.length() < 40; ++i) {
    const char c = source[i];
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_') name += c;
    else if (c == ' ') name += '_';
  }
  return name.isEmpty() ? String("") : name + ".nes";
}

std::vector<String> nesroms::list() {
  std::vector<String> names;
  if (!roms::available()) return names;
  File dir = LittleFS.open("/nes");
  if (!dir) return names;
  File file;
  while ((file = dir.openNextFile())) {
    String name = file.name();
    const int slash = name.lastIndexOf('/');
    if (slash >= 0) name = name.substring(slash + 1);
    if (!file.isDirectory() && name.endsWith(".nes") && names.size() < 32) names.push_back(name);
    file.close();
  }
  std::sort(names.begin(), names.end());
  return names;
}
