#pragma once
#include <Arduino.h>
#include <FS.h>
#include <vector>

namespace roms {
constexpr size_t maxRomSize = 2 * 1024 * 1024;
bool begin();
bool available();
String validate(File& file);
std::vector<String> list();
String safeName(const String& uploadedName);
}
