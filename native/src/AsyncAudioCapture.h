#pragma once
#include "AudioCapture.h"
#include <QThread>
#include <QTimer>

class CaptureMailbox;
class CaptureWorker;

// The device and its polling loop live outside the GUI thread. PCM is held in
// our bounded mailbox until the controller can consume it, independently of ASR.
class AsyncAudioCapture : public QObject {
    Q_OBJECT
  public:
    explicit AsyncAudioCapture(QObject *parent = nullptr, AudioCapture *source = nullptr);
    ~AsyncAudioCapture() override;
    void start(const QByteArray &deviceId);
    void stop(); // Drain the device and mailbox, then emit stopped().
    void cancel(); // Discard this generation; late callbacks cannot enter the next session.
    void setWarmup(bool enabled, const QByteArray &deviceId);
    int sampleRate() const { return m_rate; }
    QVariantList devices() const;
  signals:
    void frames(const QVector<float> &samples, int sampleRate);
    void levelChanged(double level);
    void failed(const QString &message);
    void stopped();
    void devicesChanged();
  private:
    void deliver(quint64 generation);
    void reportFailure(quint64 generation, const QString &message);
    std::shared_ptr<CaptureMailbox> m_mailbox;
    QThread *m_thread;
    CaptureWorker *m_worker;
    QTimer m_startup;
    quint64 m_generation = 0;
    int m_rate = 0;
    bool m_active = false, m_stopping = false;
};
