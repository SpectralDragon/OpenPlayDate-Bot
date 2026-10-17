#pragma once
#include <Arduino.h>
#include <FS.h>
#include <vector>
#include "nes_cartridge.h"

namespace nesroms {
bool begin();
String validate(File& file);
String safeName(const String& uploadedName);
std::vector<String> list();
}
