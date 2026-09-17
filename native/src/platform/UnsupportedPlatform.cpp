#include "Platform.h"

// Explicit capability boundary: QML, audio and ASR are portable; global input
// permissions, event taps and AX text injection still need macOS implementation.
class UnsupportedPlatform final : public Platform {
  public:
    bool start(QString *error) override {
        *error = "Global input is currently available on Windows only. Use the record button.";
        return false;
    }
    bool fullscreen() const override { return false; }
    quintptr target() const override { return 0; }
    bool inputSupported() const override { return false; }
    bool inject(quintptr, const QString &, QString *error) override {
        *error = "Copy the result to insert it.";
        return false;
    }
};
std::unique_ptr<Platform> createPlatform() {
    return std::make_unique<UnsupportedPlatform>();
}
