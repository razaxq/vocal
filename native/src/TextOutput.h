#pragma once
#include "Platform.h"
#include <QJsonObject>

class TextOutput : public QObject {
    Q_OBJECT
  public:
    explicit TextOutput(Platform *platform, QObject *parent = nullptr);
    void begin(quintptr target);
    bool update(const QString &text, const QJsonObject &settings, int replaceLimit, QString *error);
    QString inserted() const { return m_inserted; }

  private:
    bool paste(const QString &text, bool restore, QString *error);
    Platform *m_platform;
    quintptr m_target = 0;
    QString m_inserted;
    quint64 m_clipboardRevision = 0;
};
