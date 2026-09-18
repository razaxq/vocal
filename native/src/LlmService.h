#pragma once
#include <QJsonObject>
#include <QNetworkAccessManager>
#include <QNetworkReply>
#include <QObject>
#include <QPointer>

class LlmService : public QObject {
    Q_OBJECT
  public:
    explicit LlmService(QObject *parent = nullptr) : QObject(parent) {}
    void consolidate(const QString &text, const QJsonObject &settings, int generation);
    void cancel();
    bool busy() const { return !m_reply.isNull(); }
    static QString guard(const QString &input, QString output);
  signals:
    void diagnostic(int generation, const QJsonObject &event);
    void completed(int generation, const QString &source, const QString &text);

  private:
    QNetworkAccessManager m_network;
    QPointer<QNetworkReply> m_reply;
};
