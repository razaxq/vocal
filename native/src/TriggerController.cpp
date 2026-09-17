#include "TriggerController.h"
TriggerController::TriggerController(Platform *platform, QObject *parent) : QObject(parent), m_platform(platform) {
    m_mouseTimer.setSingleShot(true);
    m_keyboardTimer.setSingleShot(true);
    m_keyboardTimer.setTimerType(Qt::PreciseTimer);
    m_keyboardTimer.setInterval(10);
    connect(&m_keyboardTimer, &QTimer::timeout, this, [this] {
        if (!m_keys[0])
            return;
        const auto mode = m_settings["keyboardMode"].toString("hold");
        if (m_owner == 0 && mode != "hold") {
            m_owner = -1;
            m_debounce.start();
            m_tap.invalidate();
            emit released();
        } else if (m_owner < 0 && allowed(false) && m_platform->shortcutModifiersMatch()) {
            if (mode == "doubleTap") {
                if (!m_tap.isValid() || m_tap.elapsed() > m_settings["doubleTapWindowMs"].toInt(350)) {
                    m_tap.start();
                    return;
                }
                m_tap.invalidate();
            }
            m_owner = 0;
            m_mouseTimer.stop();
            emit pressed();
        }
    });
    connect(platform, &Platform::inputChanged, this, &TriggerController::accept);
    connect(platform, &Platform::escapePressed, this, [this] {
        m_keyboardTimer.stop();
        m_tap.invalidate();
        if (m_owner == 0) {
            m_owner = -1;
            m_debounce.start();
            emit cancelled();
        }
    });
    connect(&m_mouseTimer, &QTimer::timeout, this, [this] {
        if (m_owner < 0 && mouseHeld() && allowed(true)) {
            m_owner = 1;
            emit pressed();
        }
    });
}
void TriggerController::configure(const QJsonObject &settings) {
    m_mouseTimer.stop();
    m_keyboardTimer.stop();
    if (m_owner >= 0) {
        m_owner = -1;
        emit released();
    }
    m_settings = settings;
    m_platform->configure(settings);
    m_tap.invalidate();
}
bool TriggerController::allowed(bool mouse) const {
    return (!m_debounce.isValid() || m_debounce.elapsed() >= m_settings["debounceMs"].toInt(300)) &&
           m_settings[mouse ? "mouseEnabled" : "keyboardEnabled"].toBool() &&
           (m_settings[mouse ? "mouseInFullscreen" : "keyboardInFullscreen"].toBool() || !m_platform->fullscreen());
}
bool TriggerController::mouseHeld() const {
    const auto button = m_settings["mouseButton"].toString();
    return button == "left" ? m_keys[1] : button == "leftMiddle" ? m_keys[1] && m_keys[2] : m_keys[2];
}
void TriggerController::accept(int input, bool down) {
    if (input < 0 || input > 2 || m_keys[input] == down)
        return;
    const bool wasHeld = mouseHeld();
    m_keys[input] = down;
    if (input == 0) {
        const auto mode = m_settings["keyboardMode"].toString("hold");
        if (!down)
            m_keyboardTimer.stop();
        if (m_owner == 0 && mode == "hold" && !down) {
            m_owner = -1;
            m_debounce.start();
            m_tap.invalidate();
            emit released();
        } else if (down && ((m_owner == 0 && mode != "hold") ||
                            (m_owner < 0 && allowed(false) && m_platform->shortcutModifiersMatch()))) {
            // Ignore a contact bounce or accidental tap shorter than 10 ms.
            // Auto-repeat events do not restart this timer.
            m_keyboardTimer.start();
        }
    } else {
        if (!mouseHeld()) {
            m_mouseTimer.stop();
            if (m_owner == 1) {
                m_owner = -1;
                m_debounce.start();
                emit released();
            }
        } else if (!wasHeld && m_owner < 0 && allowed(true)) {
            m_mouseTimer.start(m_settings["mouseHoldDelayMs"].toInt(1000));
        }
    }
}
