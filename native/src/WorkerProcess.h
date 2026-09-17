#pragma once
#include <QJsonObject>
#include <QObject>
#include <QProcess>
#include <QTimer>

class WorkerProcess : public QObject {
    Q_OBJECT
  public:
    explicit WorkerProcess(QObject *parent = nullptr);
    ~WorkerProcess() override;
    void start(const QStringList &arguments);
    void stop();
    bool send(const QJsonObject &message);
    bool ready() const { return m_ready; }
    qint64 pid() const { return m_process.processId(); }
    QString state() const { return m_state; }
  signals:
    void event(const QJsonObject &message);
    void stateChanged();
    void failed(const QString &error);

  private:
    void error(const QString &message);
    QProcess m_process;
    QTimer m_startup;
    QByteArray m_buffer, m_stderr;
    bool m_stopping = false, m_ready = false;
    QString m_state = "unloaded";
};
