#include "AudioCapture.h"
#include <QVariantMap>
#include <cmath>
#include <cstring>

QVector<float> PcmDecoder::append(const QByteArray &bytes) {
    m_pending.append(bytes);
    QVector<float> result;
    const int frameBytes = m_format.bytesPerFrame();
    const int width = m_format.bytesPerSample();
    if (frameBytes <= 0 || width <= 0)
        return result;
    const auto frames = m_pending.size() / frameBytes;
    result.reserve(frames);
    for (qsizetype i = 0; i < frames; ++i) {
        float sum = 0;
        for (int ch = 0; ch < m_format.channelCount(); ++ch) {
            const char *p = m_pending.constData() + i * frameBytes + ch * width;
            float value = 0;
            switch (m_format.sampleFormat()) {
            case QAudioFormat::UInt8:
                value = (static_cast<unsigned char>(*p) - 128) / 128.f;
                break;
            case QAudioFormat::Int16: {
                qint16 n;
                memcpy(&n, p, 2);
                value = n / 32768.f;
                break;
            }
            case QAudioFormat::Int32: {
                qint32 n;
                memcpy(&n, p, 4);
                value = n / 2147483648.f;
                break;
            }
            case QAudioFormat::Float:
                memcpy(&value, p, 4);
                break;
            default:
                break;
            }
            sum += std::isfinite(value) ? qBound(-1.f, value, 1.f) : 0.f;
        }
        result.append(sum / m_format.channelCount());
    }
    m_pending.remove(0, frames * frameBytes);
    return result;
}
bool hasVoice(const QVector<float> &samples, int sampleRate) {
    if (sampleRate <= 0 || samples.size() < sampleRate / 5)
        return false;
    const int frame = qMax(1, sampleRate / 50);
    int active = 0, count = 0;
    for (qsizetype start = 0; start + frame <= samples.size(); start += frame) {
        double energy = 0;
        for (int i = 0; i < frame; ++i)
            energy += double(samples[start + i]) * samples[start + i];
        active += std::sqrt(energy / frame) > .005;
        ++count;
    }
    return count && double(active) / count >= .04;
}
AudioCapture::AudioCapture(QObject *parent) : QObject(parent), m_devices(this) {
    connect(&m_devices, &QMediaDevices::audioInputsChanged, this, &AudioCapture::devicesChanged);
}
QVariantList AudioCapture::devices() const {
    QVariantList result{QVariantMap{{"id", ""}, {"name", "System default"}}};
    for (const auto &device : QMediaDevices::audioInputs())
        result.append(QVariantMap{{"id", QString::fromLatin1(device.id().toBase64())}, {"name", device.description()}});
    return result;
}
bool AudioCapture::start(const QByteArray &deviceId, QString *error) {
    stop();
    auto device = QMediaDevices::defaultAudioInput();
    if (!deviceId.isEmpty()) {
        device = {};
        for (const auto &candidate : QMediaDevices::audioInputs())
            if (candidate.id() == deviceId)
                device = candidate;
    }
    if (device.isNull()) {
        *error = "Microphone unavailable. Select another input device.";
        return false;
    }
    m_format = device.preferredFormat();
#ifndef Q_OS_WIN
    QAudioFormat desired;
    desired.setSampleRate(16000);
    desired.setChannelCount(1);
    desired.setSampleFormat(QAudioFormat::Float);
    if (device.isFormatSupported(desired))
        m_format = desired;
#endif
    // Use the Windows device's native format. Resampling before the first
    // packet adds startup work; the recognizer already accepts the actual rate.
    m_decoder = PcmDecoder(m_format);
    m_samples.clear();
    m_limited = false;
    m_source = std::make_unique<QAudioSource>(device, m_format);
    m_source->setBufferSize(m_format.bytesForDuration(40000));
    connect(
        m_source.get(), &QAudioSource::stateChanged, m_source.get(),
        [this](QAudio::State) {
            if (m_source && m_source->error() != QAudio::NoError && m_source->error() != QAudio::UnderrunError)
                emit failed("Microphone capture failed. Check the input device and microphone permission.");
        },
        Qt::QueuedConnection);
    m_input = m_source->start();
    if (!m_input || m_source->error() != QAudio::NoError) {
        *error = "Cannot open microphone. Check microphone permission.";
        stop();
        return false;
    }
    m_bufferDurationMs = m_format.durationForBytes(m_source->bufferSize()) / 1000;
    connect(m_input, &QIODevice::readyRead, this, &AudioCapture::drain);
    // A backend may already have data by the time readyRead is connected.
    drain();
    return true;
}
void AudioCapture::drain() {
    if (!m_input)
        return;
    const auto decoded = m_decoder.append(m_input->readAll());
    const auto remaining = qsizetype(m_format.sampleRate()) * 120 - m_samples.size();
    m_samples.append(decoded.first(qMin(remaining, decoded.size())));
    double energy = 0;
    for (auto sample : decoded)
        energy += double(sample) * sample;
    emit levelChanged(decoded.isEmpty() ? 0 : qMin(1., std::sqrt(energy / decoded.size()) * 6));
    emit frames(decoded, m_format.sampleRate());
    if (m_samples.size() >= qsizetype(m_format.sampleRate()) * 120 && !m_limited) {
        m_limited = true;
        emit limitReached();
    }
}
QVector<float> AudioCapture::stop() {
    if (m_source) {
        disconnect(m_source.get(), nullptr, this, nullptr);
        if (m_input) {
            disconnect(m_input, nullptr, this, nullptr);
            drain();
        }
        m_source->stop();
        m_input = nullptr;
        m_source.reset();
    }
    emit levelChanged(0);
    return std::exchange(m_samples, {});
}
