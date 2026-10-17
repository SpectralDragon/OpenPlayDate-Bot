#pragma once
// The current physical console has no wired audio output. The desktop host
// plays canonical WAV assets and reports that capability to Lua explicitly.
namespace openplayaudio {
#ifdef OPENPLAY_DESKTOP
constexpr bool available = true;
void command(const char* action, const char* path = "", bool loop = false);
#else
constexpr bool available = false;
inline void command(const char*, const char* = "", bool = false) {}
#endif
}
