#include "AsyncAudioCapture.h"
#include <QMutex>
#include <QMutexLocker>
#include <QVariantMap>
#include <cmath>

class CaptureMailbox {
  public:
    struct Batch { QVector<float> samples; int rate = 0; };
    struct Warmup { bool enabled = false; QByteArray device; quint64 revision = 0; };
    enum Push { Stale, Buffered, Notify, Overflow };
    void reset(quint64 generation, bool active = false, const QByteArray &device = {}) {
        QMutexLocker lock(&mutex);
        current = generation;
        pending = {};
        notified = false;
        accepting = active;
        requestedDevice = device;
    }
    quint64 requestedSession(const QByteArray &device) {
        QMutexLocker lock(&mutex);
        return accepting && device == requestedDevice ? current : 0;
    }
    void close(quint64 generation) {
        QMutexLocker lock(&mutex);
        if (current == generation)
            accepting = false;
    }
    quint64 setWarmup(bool enabled, const QByteArray &device) {
        QMutexLocker lock(&mutex);
        warmup.enabled = enabled;
        warmup.device = device;
        return ++warmup.revision;
    }
    Warmup warm() {
        QMutexLocker lock(&mutex);
        return warmup;
    }
    bool matches(quint64 generation) {
        QMutexLocker lock(&mutex);
        return generation == current;
    }
    Push push(quint64 generation, const QVector<float> &samples, int rate) {
        QMutexLocker lock(&mutex);
        if (generation != current || samples.isEmpty())
            return Stale;
        // Never silently overwrite old audio if the consumer stops responding.
        if (rate <= 0 || pending.samples.size() + samples.size() > qsizetype(rate) * 120)
            return Overflow;
        pending.rate = rate;
        pending.samples.append(samples);
        if (std::exchange(notified, true))
            return Buffered;
        return Notify;
    }
    Batch take(quint64 generation) {
        QMutexLocker lock(&mutex);
        if (generation != current)
            return {};
        notified = false;
        return std::exchange(pending, {});
    }
  private:
    QMutex mutex;
    quint64 current = 0;
    Batch pending;
    bool notified = false;
    bool accepting = false;
    QByteArray requestedDevice;
    Warmup warmup;
};

class CaptureWorker : public QObject {
    Q_OBJECT
  public:
    CaptureWorker(std::shared_ptr<CaptureMailbox> mailbox, AudioCapture *source)
        : m_mailbox(std::move(mailbox)), m_source(source ? source : new AudioCapture) {
        m_source->setParent(this);
        connect(m_source, &AudioCapture::devicesChanged, this, [this] {
            m_devicesDirty = true;
            warmup(m_mailbox->warm().revision);
            emit devicesChanged();
        });
        connect(m_source, &AudioCapture::failed, this, [this](const QString &message) {
            m_open = false;
            emit failed(m_generation, message);
        });
        connect(m_source, &AudioCapture::frames, this, [this](const QVector<float> &samples, int rate) {
            m_source->takeSamples(); // Only the mailbox retains pending PCM.
            if (m_discard)
                return;
            if (!m_recording) {
                // A trigger may arrive while the warmup device is still opening.
                // Arm from the shared request immediately, including its first packet.
                const auto requested = m_mailbox->requestedSession(m_deviceId);
                if (!requested)
                    return; // Idle warmup audio is discarded, never retained/recognized.
                m_generation = requested;
                m_recording = true;
                m_overflow = false;
            }
            const auto result = m_mailbox->push(m_generation, samples, rate);
            if (result == CaptureMailbox::Notify)
                emit available(m_generation);
            else if (result == CaptureMailbox::Overflow && !m_overflow) {
                m_overflow = true;
                emit failed(m_generation, "录音缓存已满，请结束录音后重试");
            }
        });
    }
    void start(quint64 generation, const QByteArray &deviceId) {
        if (!m_mailbox->matches(generation))
            return;
        if (m_open && !m_devicesDirty && m_deviceId == deviceId) {
            m_generation = generation;
            m_recording = true;
            m_overflow = false;
            return;
        }
        m_recording = false;
        closeDevice();
        m_generation = generation;
        m_overflow = false;
        m_recording = true;
        m_deviceId = deviceId;
        m_devicesDirty = false;
        QString error;
        m_open = m_source->start(deviceId, &error);
        if (!m_mailbox->matches(generation)) {
            m_recording = false;
            if (!keepWarm()) {
                closeDevice();
            }
            return;
        }
        if (!m_open)
            emit failed(generation, error);
    }
    void stop(quint64 generation) {
        if (generation != m_generation)
            return;
        if (keepWarm() && m_open)
            m_source->flush();
        else {
            m_source->stop(); // Includes final device frames before stopped().
            m_open = false;
        }
        m_mailbox->close(generation);
        m_recording = false;
        emit stopped(generation);
        warmup(m_mailbox->warm().revision);
    }
    void warmup(quint64 revision) {
        const auto request = m_mailbox->warm();
        if (request.revision != revision || m_recording)
            return;
        if (!request.enabled) {
            closeDevice();
            return;
        }
        if (m_open && !m_devicesDirty && request.device == m_deviceId)
            return;
        closeDevice();
        m_deviceId = request.device;
        m_devicesDirty = false;
        QString error;
        m_open = m_source->start(m_deviceId, &error);
        if (!keepWarm() && !m_recording) {
            closeDevice();
        }
        // Warmup errors do not create a recording session. A later trigger
        // retries the device and reports a failure through the normal path.
    }
  signals:
    void available(quint64 generation);
    void failed(quint64 generation, const QString &message);
    void stopped(quint64 generation);
    void devicesChanged();
  private:
    std::shared_ptr<CaptureMailbox> m_mailbox;
    AudioCapture *m_source;
    quint64 m_generation = 0;
    bool m_overflow = false;
    bool m_recording = false, m_open = false;
    bool m_discard = false;
    bool m_devicesDirty = false;
    QByteArray m_deviceId;
    void closeDevice() {
        m_discard = true;
        m_source->stop();
        m_discard = false;
        m_open = false;
    }
    bool keepWarm() const {
        const auto request = m_mailbox->warm();
        return request.enabled && !m_devicesDirty && request.device == m_deviceId;
    }
};

AsyncAudioCapture::AsyncAudioCapture(QObject *parent, AudioCapture *source)
    : QObject(parent), m_mailbox(std::make_shared<CaptureMailbox>()), m_thread(new QThread),
      m_worker(new CaptureWorker(m_mailbox, source)) {
    m_worker->moveToThread(m_thread);
    connect(m_thread, &QThread::finished, m_worker, &QObject::deleteLater);
    connect(m_thread, &QThread::finished, m_thread, &QObject::deleteLater);
    connect(m_worker, &CaptureWorker::available, this, &AsyncAudioCapture::deliver);
    connect(m_worker, &CaptureWorker::failed, this, &AsyncAudioCapture::reportFailure);
    connect(m_worker, &CaptureWorker::devicesChanged, this, &AsyncAudioCapture::devicesChanged);
    connect(m_worker, &CaptureWorker::stopped, this, [this](quint64 generation) {
        if (generation != m_generation || !m_active)
            return;
        deliver(generation);
        if (generation != m_generation || !m_active)
            return;
        m_startup.stop();
        m_active = m_stopping = false;
        emit levelChanged(0);
        emit stopped();
    });
    m_startup.setSingleShot(true);
    m_startup.setInterval(8000);
    connect(&m_startup, &QTimer::timeout, this, [this] {
        reportFailure(m_generation, "麦克风启动超时，请检查或切换输入设备");
    });
    m_thread->start();
}
AsyncAudioCapture::~AsyncAudioCapture() {
    m_mailbox->setWarmup(false, {});
    cancel();
    m_thread->quit();
    // A hung device driver must not freeze the application on exit. The thread
    // and worker own their cleanup and are deleted once the OS call returns.
    m_thread->wait(1000);
}
QVariantList AsyncAudioCapture::devices() const {
    QVariantList result{QVariantMap{{"id", ""}, {"name", "System default"}}};
    for (const auto &device : QMediaDevices::audioInputs())
        result.append(QVariantMap{{"id", QString::fromLatin1(device.id().toBase64())}, {"name", device.description()}});
    return result;
}
void AsyncAudioCapture::start(const QByteArray &deviceId) {
    cancel();
    const auto generation = ++m_generation;
    m_mailbox->reset(generation, true, deviceId);
    m_active = true;
    m_stopping = false;
    m_rate = 0;
    m_startup.start();
    QMetaObject::invokeMethod(m_worker, [worker = m_worker, generation, deviceId] {
        worker->start(generation, deviceId);
    }, Qt::QueuedConnection);
}
void AsyncAudioCapture::stop() {
    if (!m_active || m_stopping)
        return;
    m_stopping = true;
    const auto generation = m_generation;
    QMetaObject::invokeMethod(m_worker, [worker = m_worker, generation] { worker->stop(generation); },
                              Qt::QueuedConnection);
}
void AsyncAudioCapture::cancel() {
    const auto generation = m_generation;
    m_mailbox->reset(++m_generation);
    m_active = m_stopping = false;
    m_startup.stop();
    QMetaObject::invokeMethod(m_worker, [worker = m_worker, generation] { worker->stop(generation); },
                              Qt::QueuedConnection);
}
void AsyncAudioCapture::setWarmup(bool enabled, const QByteArray &deviceId) {
    const auto revision = m_mailbox->setWarmup(enabled, deviceId);
    QMetaObject::invokeMethod(m_worker, [worker = m_worker, revision] { worker->warmup(revision); },
                              Qt::QueuedConnection);
}
void AsyncAudioCapture::deliver(quint64 generation) {
    if (generation != m_generation || !m_active)
        return;
    auto batch = m_mailbox->take(generation);
    if (batch.samples.isEmpty())
        return;
    m_startup.stop();
    m_rate = batch.rate;
    double energy = 0;
    for (float sample : batch.samples)
        energy += double(sample) * sample;
    emit levelChanged(qMin(1., std::sqrt(energy / batch.samples.size()) * 6));
    emit frames(batch.samples, batch.rate);
}
void AsyncAudioCapture::reportFailure(quint64 generation, const QString &message) {
    if (generation != m_generation || !m_active)
        return;
    cancel();
    emit levelChanged(0);
    emit failed(message);
}

#include "AsyncAudioCapture.moc"
