#pragma once
#include <cstdlib>
constexpr int MALLOC_CAP_SPIRAM = 1, MALLOC_CAP_8BIT = 2;
inline bool testGraphicsAllocationFails = false;
inline void* heap_caps_malloc(size_t size, int) { return testGraphicsAllocationFails ? nullptr : malloc(size); }
inline void* heap_caps_realloc(void* pointer, size_t size, int) { return realloc(pointer, size); }
