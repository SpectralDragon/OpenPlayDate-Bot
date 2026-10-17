#pragma once
#include "Arduino.h"
#include <fstream>
#include <filesystem>
#include <memory>
inline size_t testFileReads = 0;
class File {
  std::shared_ptr<std::ifstream> stream_;
  std::filesystem::path path_;
  std::shared_ptr<std::filesystem::directory_iterator> iterator_;
 public:
  File() = default;
  explicit File(std::filesystem::path path) : path_(std::move(path)) {
    if (std::filesystem::is_directory(path_)) iterator_ = std::make_shared<std::filesystem::directory_iterator>(path_);
    else stream_ = std::make_shared<std::ifstream>(path_, std::ios::binary);
  }
  explicit operator bool() const { return iterator_ || (stream_ && stream_->is_open()); }
  size_t size() { return std::filesystem::file_size(path_); }
  size_t position() { return size_t(stream_->tellg()); }
  bool seek(size_t offset) { stream_->clear(); stream_->seekg(offset); return bool(*stream_); }
  size_t read(uint8_t* data, size_t size) { ++testFileReads; stream_->read(reinterpret_cast<char*>(data), size); return size_t(stream_->gcount()); }
  size_t readBytes(char* data, size_t size) { return read(reinterpret_cast<uint8_t*>(data), size); }
  void close() { stream_.reset(); iterator_.reset(); }
  String name() const { return path_.filename().string(); }
  bool isDirectory() const { return bool(iterator_); }
  File openNextFile() {
    if (!iterator_ || *iterator_ == std::filesystem::directory_iterator{}) return File{};
    auto path = (**iterator_).path(); ++*iterator_; return File(path);
  }
};
