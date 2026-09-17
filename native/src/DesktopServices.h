#pragma once
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QObject>
#include <QTimer>

class DesktopServices : public QObject {
    Q_OBJECT
  public:
    explicit DesktopServices(QString dataDirectory, QObject *parent = nullptr);
    QString dictionaryPath() const { return m_dictionaryPath; }
    QVariantMap dictionaryInfo() const { return m_dictionary; }
    QVariantMap updateInfo() const { return m_update; }
    void updateDictionary();
    void configure(const QJsonObject &settings);
    void checkUpdates();
    void installUpdate();
    bool setStartup(bool enabled, QString *error);
    bool packaged() const;
  signals:
    void changed();
    void dictionaryChanged();
    void failed(const QString &message);

  private:
    void loadDictionaryMetadata();
    QString m_directory, m_dictionaryPath;
    QVariantMap m_dictionary, m_update;
    QJsonObject m_settings;
    QNetworkAccessManager m_network;
    QTimer m_daily;
    bool m_downloadingDictionary = false, m_checking = false;
};
