#pragma once
#include "FS.h"
extern std::filesystem::path testStorage;
struct LittleFSDouble {
  File open(const String& path, const char* = "r") { return File(testStorage / std::string(path.c_str()).substr(1)); }
};
extern LittleFSDouble LittleFS;
