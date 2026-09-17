#pragma once
#include "ModelCatalog.h"
#include <QFile>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QPointer>
#include <QProcess>
#include <QTemporaryDir>
#include <QVariantMap>
#include <memory>

class ModelManager : public QObject {
    Q_OBJECT
  public:
    explicit ModelManager(QString root, QObject *parent = nullptr, QJsonObject registry = {});
    ~ModelManager() override;
    QVariantList models(const QString &group) const;
    bool busy() const { return m_active || !m_queue.isEmpty(); }
    void download(const QString &id);
    void cancel(const QString &id = {});
    void remove(const QString &id);
  signals:
    void changed();
    void completed(const QString &id);
    void failed(const QString &message);

  private:
    void startNext();
    void abortActive();
    void next();
    void extractNext();
    void commit();
    void fail(const QString &message);
    ModelCatalog m_catalog;
    QNetworkAccessManager m_network;
    QPointer<QNetworkReply> m_reply;
    QProcess m_tar;
    QFile m_file;
    std::unique_ptr<QTemporaryDir> m_stage;
    QJsonObject m_entry;
    QList<QJsonObject> m_downloads;
    QStringList m_extract;
    QStringList m_queue;
    QMap<QString, QVariantMap> m_finished;
    bool m_active = false;
    QString m_id, m_phase, m_error, m_archive, m_extractOutput;
    int m_index = 0;
    double m_percent = 0;
    qint64 m_received = 0, m_total = 0;
};
