#pragma once

// TFT_eSPI discovers tft_setup.h in the project include path automatically.
// A regular include also lets PlatformIO track changes and rebuild the driver.
// ST7789 geometry matches all four physical corners of our panel.
// The colour test showed inverted colours and red/blue swapped.
// Controller ID is unreadable; this is the selected compatible profile.
#ifdef ROBOT_TFT_ILI9488
#define ILI9488_DRIVER
#elif defined(ROBOT_TFT_ILI9341)
#define ILI9341_DRIVER
#else
#define ST7789_DRIVER
#define TFT_WIDTH 240
#define TFT_HEIGHT 320
#define TFT_INVERSION_OFF
#endif
// TFT_eSPI 2.5.43 otherwise resolves SPI_PORT to FSPI=0 on Arduino 2.0.17,
// producing a StoreProhibited panic in begin_tft_write(). SPI3 uses our pins.
// Upstream report: https://github.com/Bodmer/TFT_eSPI/issues/3925
#define USE_HSPI_PORT
// Arduino's HSPI API requires a valid input pin. GPIO13 also supports the
// optional SDO connection used by the display-id controller diagnostic.
#define TFT_MISO 13
#define TFT_MOSI 11
#define TFT_SCLK 12
#define TFT_CS 10
#define TFT_DC 9
#define TFT_RST 14
// Conservative speed for the first build on breadboard/jumper wires.
#ifdef ROBOT_DISPLAY_SLOW_SPI
#define SPI_FREQUENCY 1000000
#elif defined(ROBOT_DISPLAY_SPI_HZ)
#define SPI_FREQUENCY ROBOT_DISPLAY_SPI_HZ
#else
#define SPI_FREQUENCY 10000000
#endif
#define LOAD_GLCD
#define LOAD_FONT2
#define TFT_RGB_ORDER TFT_BGR
// Backlight LED is wired directly to 3V3; there is no backlight GPIO.
