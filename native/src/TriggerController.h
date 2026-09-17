#pragma once
#include "Platform.h"
#include <QElapsedTimer>
#include <QJsonObject>
#include <QTimer>

class TriggerController : public QObject {
    Q_OBJECT
  public:
    explicit TriggerController(Platform *platform, QObject *parent = nullptr);
    void configure(const QJsonObject &settings);
    void accept(int input, bool down);
    bool keyboardActive() const { return m_owner == 0; }
  signals:
    void pressed();
    void released();
    void cancelled();

  private:
    bool allowed(bool mouse) const;
    bool mouseHeld() const;
    Platform *m_platform;
    QJsonObject m_settings;
    QTimer m_mouseTimer, m_keyboardTimer;
    bool m_keys[3]{};
    int m_owner = -1;
    QElapsedTimer m_tap, m_debounce;
};
