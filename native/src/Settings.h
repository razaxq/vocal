#pragma once
#include <QJsonObject>
#include <QString>

class Settings {
  public:
    explicit Settings(QString directory);
    QJsonObject values() const { return m_values; }
    bool set(const QString &key, const QJsonValue &value, QString *error = nullptr);
    QString directory() const { return m_directory; }
    QString loadError() const { return m_error; }

  private:
    QString m_directory, m_error;
    QJsonObject m_values;
};
