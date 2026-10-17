#pragma once
#include <DNSServer.h>
#include <WebServer.h>
#include <FS.h>
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
  bool portalActive() const { return portal_; }
  String status() const;
  String apName() const { return apName_; }
  String apPassword() const { return apPassword_; }
 private:
  DeviceSettings& settings_;
  WebServer server_{80};
  DNSServer dns_;
  bool portal_ = false;
  bool connecting_ = false;
  bool uploadComplete_ = false;
  uint32_t connectAt_ = 0;
  String apName_, apPassword_, token_, uploadName_, uploadError_;
  File upload_;
  size_t uploadBytes_ = 0;
  void connect();
  void routes();
  bool authorized();
  void page();
  void uploadChunk();
};
