#pragma once
#include "Platform.h"
#include <QJsonObject>
#include <QMimeData>
#include <QTimer>
#include <QElapsedTimer>

class TextOutput : public QObject {
    Q_OBJECT
  public:
    explicit TextOutput(Platform *platform, QObject *parent = nullptr);
    void begin(quintptr target);
    bool update(const QString &text, const QJsonObject &settings, int replaceLimit, QString *error);
    QString inserted() const { return m_inserted; }
    bool busy() const { return m_waiting; }

  signals:
    void failed(const QString &error);
    void idle();
  private:
    void settle();
    void trackInput(const QString &text);
    void finishPending();
    void restoreClipboard();
    bool apply(const QString &text, const QJsonObject &settings, int replaceLimit, QString *error);
    QTimer m_settleTimer;
    QElapsedTimer m_pendingTime;
    bool m_waiting = false, m_hasQueued = false, m_beginQueued = false;
    quintptr m_nextTarget = 0;
    QString m_pendingText, m_queuedText;
    QJsonObject m_queuedSettings;
    int m_queuedLimit = 0;
    bool paste(const QString &text, bool restore, QString *error);
    Platform *m_platform;
    quintptr m_target = 0;
    QString m_inserted;
    quint64 m_clipboardRevision = 0;
    quint64 m_ownedClipboardRevision = 0;
    QTimer m_restoreClipboardTimer;
    std::unique_ptr<QMimeData> m_clipboardBackup;
};
