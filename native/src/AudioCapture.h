#pragma once
#include <QAudioDevice>
#include <QAudioSource>
#include <QMediaDevices>
#include <QVector>
#include <memory>
#include <utility>

// Preserves incomplete frames across readyRead boundaries. Recognition receives
// the device's actual sample rate; sherpa performs its band-limited resampling.
class PcmDecoder {
  public:
    explicit PcmDecoder(QAudioFormat format = {}) : m_format(format) {}
    QVector<float> append(const QByteArray &bytes);

  private:
    QAudioFormat m_format;
    QByteArray m_pending;
};
bool hasVoice(const QVector<float> &samples, int sampleRate);

class AudioCapture : public QObject {
    Q_OBJECT
  public:
    explicit AudioCapture(QObject *parent = nullptr);
    bool start(const QByteArray &deviceId, QString *error);
    QVector<float> stop();
    QVector<float> takeSamples() { return std::exchange(m_samples, {}); }
    int sampleRate() const { return m_format.sampleRate(); }
    QVariantList devices() const;
  signals:
    void frames(const QVector<float> &samples, int sampleRate);
    void levelChanged(double level);
    void failed(const QString &message);
    void limitReached();
    void devicesChanged();

  private:
    void drain();
    QMediaDevices m_devices;
    std::unique_ptr<QAudioSource> m_source;
    QIODevice *m_input = nullptr;
    QAudioFormat m_format;
    PcmDecoder m_decoder;
    QVector<float> m_samples;
    bool m_limited = false;
};
