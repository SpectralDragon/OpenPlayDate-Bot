#include "rom_store.h"
#include <LittleFS.h>
#include <esp_partition.h>
#include <algorithm>

namespace { bool mounted = false; }

bool roms::begin() {
  mounted = LittleFS.begin(false);
  if (!mounted) {
    // Format only a completely erased partition. Never erase an existing FS
    // automatically when a mount fails (it could contain games and saves).
    const esp_partition_t* part = esp_partition_find_first(
        ESP_PARTITION_TYPE_DATA, ESP_PARTITION_SUBTYPE_DATA_SPIFFS, nullptr);
    bool erased = part != nullptr;
    uint8_t chunk[256];
    for (size_t offset = 0; erased && offset < part->size; offset += sizeof(chunk)) {
      if (esp_partition_read(part, offset, chunk, sizeof(chunk)) != ESP_OK) {
        erased = false;
        break;
      }
      for (uint8_t value : chunk) if (value != 0xFF) { erased = false; break; }
      if ((offset % 65536) == 0) delay(1);
    }
    if (erased && LittleFS.format()) mounted = LittleFS.begin(false);
  }
  if (mounted) {
    LittleFS.mkdir("/roms");
    LittleFS.mkdir("/saves");
    if (LittleFS.exists("/upload.tmp")) LittleFS.remove("/upload.tmp");
  }
  return mounted;
}

bool roms::available() { return mounted; }

String roms::validate(File& file) {
  if (!file || file.size() < 32768 || file.size() > maxRomSize)
    return "Нужен .gb размером от 32 КБ до 2 МБ";
  uint8_t header[0x150];
  file.seek(0);
  if (file.read(header, sizeof(header)) != sizeof(header)) return "Ошибка чтения файла";
  if (header[0x143] == 0xC0) return "Game Boy Color пока не поддерживается";
  if (header[0x148] > 6 || file.size() != (size_t(32768) << header[0x148]))
    return "Размер ROM не совпадает с заголовком";
  if (header[0x149] > 5) return "Неверный размер памяти картриджа";
  uint8_t sum = 0;
  for (int i = 0x134; i <= 0x14C; ++i) sum = sum - header[i] - 1;
  if (sum != header[0x14D]) return "Повреждён заголовок ROM";
  const uint8_t type = header[0x147];
  if (!(type <= 3 || type == 5 || type == 6 || type == 8 || type == 9 ||
        (type >= 0x0F && type <= 0x13) || (type >= 0x19 && type <= 0x1E)))
    return "Этот тип картриджа пока не поддерживается";
  file.seek(0);
  return "";
}

std::vector<String> roms::list() {
  std::vector<String> names;
  if (!mounted) return names;
  File dir = LittleFS.open("/roms");
  File file;
  while ((file = dir.openNextFile())) {
    String name = file.name();
    const int slash = name.lastIndexOf('/');
    if (slash >= 0) name = name.substring(slash + 1);
    if (!file.isDirectory() && name.endsWith(".gb") && names.size() < 32)
      names.push_back(name);
    file.close();
  }
  std::sort(names.begin(), names.end());
  return names;
}

String roms::safeName(const String& uploadedName) {
  String source = uploadedName;
  source.toLowerCase();
  if (!source.endsWith(".gb")) return "";
  String name;
  const int start = max(source.lastIndexOf('/'), source.lastIndexOf('\\')) + 1;
  for (int i = start; i < int(source.length()) - 3 && name.length() < 40; ++i) {
    char c = source[i];
    if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_') name += c;
    else if (c == ' ') name += '_';
  }
  if (name.isEmpty()) return "";
  return name + ".gb";
}
