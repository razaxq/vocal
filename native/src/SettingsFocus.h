#pragma once
#include <QGuiApplication>
#include <QInputMethod>
#include <QMouseEvent>
#include <QQuickItem>
#include <QQuickWindow>

// Observe presses before the target control handles them, without consuming
// the event or disturbing text selection/IME presses inside the active editor.
class SettingsFocus : public QObject {
  public:
    explicit SettingsFocus(QQuickWindow *window) : QObject(window), m_window(window) {
        window->installEventFilter(this);
    }

  protected:
    bool eventFilter(QObject *, QEvent *event) override {
        if (event->type() != QEvent::MouseButtonPress)
            return false;
        const auto *mouse = static_cast<QMouseEvent *>(event);
        auto *editor = m_window->activeFocusItem();
        if (mouse->button() == Qt::LeftButton && editor &&
            (editor->inherits("QQuickTextInput") || editor->inherits("QQuickTextEdit")) &&
            !editor->contains(editor->mapFromScene(mouse->position()))) {
            QGuiApplication::inputMethod()->commit();
            editor->setFocus(false, Qt::MouseFocusReason);
            m_window->contentItem()->forceActiveFocus(Qt::MouseFocusReason);
        }
        return false;
    }

  private:
    QQuickWindow *m_window;
};
