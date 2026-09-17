#pragma once
#include <QJsonObject>
#include <QObject>
#include <QRect>
#include <memory>

inline bool coversMonitor(const QRect &client, const QRect &monitor, const QString &className) {
    if (QStringList{"Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"}.contains(className))
        return false;
    return !client.isEmpty() && !monitor.isEmpty() && client.left() <= monitor.left() + 1 &&
           client.top() <= monitor.top() + 1 && client.right() >= monitor.right() - 1 &&
           client.bottom() >= monitor.bottom() - 1;
}
class Platform : public QObject {
    Q_OBJECT
  public:
    using QObject::QObject;
    virtual bool start(QString *error) = 0;
    virtual bool fullscreen() const = 0;
    virtual quintptr target() const = 0;
    virtual bool inject(quintptr target, const QString &text, QString *error) = 0;
    virtual bool inputSupported() const = 0;
    virtual void configure(const QJsonObject &) {}
    virtual bool shortcutModifiersMatch() const { return true; }
    virtual QString targetProcess(quintptr) const { return {}; }
    virtual QRect caretRect() const { return {}; }
    virtual bool beginTextInput(quintptr, bool, QString *) { return true; }
    virtual void endTextInput() {}
    virtual bool selectPreviousText(quintptr, const QString &, QString *error) {
        *error = "不支持选择待替换文字";
        return false;
    }
    // Read-only completion check. An unsupported provider still needs a settling interval.
    virtual int textInputApplied(quintptr, const QString &) { return -1; }
    virtual bool erase(quintptr, int, QString *error) {
        *error = "不支持替换文字";
        return false;
    }
    virtual bool paste(quintptr, QString *error) {
        *error = "不支持粘贴";
        return false;
    }
  signals:
    // 0 = right Ctrl, 1 = left mouse, 2 = middle mouse. No event is swallowed.
    void inputChanged(int input, bool down);
    void escapePressed();
};
std::unique_ptr<Platform> createPlatform();
