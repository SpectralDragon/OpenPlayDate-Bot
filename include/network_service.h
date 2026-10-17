#pragma once
#include <DNSServer.h>
#include <WebServer.h>
#include <FS.h>
#include <WiFiUdp.h>
#include <functional>
#include "device_settings.h"

class NetworkService {
 public:
  explicit NetworkService(DeviceSettings& settings) : settings_(settings) {}
  void begin();
  void update(uint32_t now);
  void startPortal();
  void stopPortal();
  void setEnabled(bool enabled);
  void forget();
  void pauseForGame();
  void resumeAfterGame();
  bool portalActive() const { return portal_; }
  String status() const;
  void printStatus() const;
  String apName() const { return apName_; }
  String apPassword() const { return apPassword_; }
  void setStudioCallbacks(std::function<bool()> prepare, std::function<String(const String&)> launch) {
    prepareStudio_ = std::move(prepare); launchStudio_ = std::move(launch);
  }
 private:
  DeviceSettings& settings_;
  WebServer server_{80};
  DNSServer dns_;
  WiFiUDP discovery_;
  bool serverActive_ = false, discoveryActive_ = false;
  bool portal_ = false;
  bool connecting_ = false;
  bool pausedForGame_ = false, radioStopped_ = false;
  bool uploadComplete_ = false;
  bool uploadBundle_ = false;
  uint32_t connectAt_ = 0;
  uint32_t discoveryRequests_ = 0, studioRequests_ = 0;
  String apName_, apPassword_, token_, uploadName_, uploadError_;
  File upload_;
  size_t uploadBytes_ = 0;
  bool studioUpload_ = false;
  std::function<bool()> prepareStudio_;
  std::function<String(const String&)> launchStudio_;
  void services();
  void stopServices();
  void discover();
  String studioInfo(bool session = false) const;
  void connect();
  void routes();
  bool authorized();
  void page();
  void uploadChunk(bool bundle = false, bool studio = false);
};
