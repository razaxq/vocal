#pragma once
#include <QElapsedTimer>
#include <QJsonObject>
#include <QObject>
#include <QThread>
#include <QVector>
#include <atomic>
#include <functional>

class DebugWriter;

// One session owns one directory. All disk I/O runs outside capture/UI threads.
class SessionDebug : public QObject {
    Q_OBJECT
  public:
    explicit SessionDebug(QString root, QObject *parent = nullptr);
    ~SessionDebug() override;
    void begin(QJsonObject metadata, const QString &dictionary);
    void record(const QString &stage, QJsonObject fields = {});
    void audio(const QVector<float> &samples, int rate);
    void finish(const QString &status, QJsonObject summary = {});
    bool active() const { return m_active; }
    QString root() const { return m_root; }
    QString path() const { return m_path; }
    static QJsonObject safeSettings(QJsonObject settings);
  signals:
    void failed(const QString &message);
  private:
    void post(std::function<void(DebugWriter &)> task, qint64 bytes = 0);
    QString m_root, m_path;
    QThread m_thread;
    DebugWriter *m_writer;
    QElapsedTimer m_clock;
    std::atomic<qint64> m_pending{0};
    qint64 m_sequence = 0;
    bool m_active = false;
};
