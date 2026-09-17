#include "AsyncAudioCapture.h"
#include <QSignalSpy>
#include <QtTest>
#include <atomic>

// Simulates a slow device open and a capture clock independent of GUI events.
class FakeCapture : public AudioCapture {
  public:
    QTimer timer;
    std::atomic<int> produced{0}, opens{0}, closes{0};
    int base = 0;
    FakeCapture() {
        timer.setParent(this);
        timer.setInterval(5);
        timer.setTimerType(Qt::PreciseTimer);
        connect(&timer, &QTimer::timeout, this, [this] { packet(); });
    }
    void packet() {
        const int value = base + ++produced;
        emit frames(QVector<float>(80, float(value)), 16000);
    }
    bool start(const QByteArray &id, QString *error) override {
        ++opens;
        QThread::msleep(id == "slow" || id == "fail" ? 180 : 10);
        if (id == "fail") {
            *error = "mock device failure";
            return false;
        }
        base = id == "slow" ? 10000 : 0;
        produced = 0;
        packet(); // First packet arrives synchronously inside device start().
        timer.start();
        return true;
    }
    QVector<float> stop() override {
        if (timer.isActive()) {
            timer.stop();
            packet(); // Last packet arrives while stop() drains the device.
            ++closes;
        }
        return {};
    }
    int sampleRate() const override { return 16000; }
    void flush() override { if (timer.isActive()) packet(); }
};

class CaptureTests : public QObject {
    Q_OBJECT
  private slots:
    void deviceChangesReopenWarmCaptureAndDoNotInterruptActiveRecording() {
        auto *source = new FakeCapture;
        AsyncAudioCapture capture(nullptr, source);
        QSignalSpy frames(&capture, &AsyncAudioCapture::frames);
        QSignalSpy stopped(&capture, &AsyncAudioCapture::stopped);
        capture.setWarmup(true, {});
        QTRY_VERIFY(source->produced.load() >= 2);
        QMetaObject::invokeMethod(source, [source] { emit source->devicesChanged(); }, Qt::QueuedConnection);
        QTRY_COMPARE(source->opens.load(), 2);
        QTRY_VERIFY(source->produced.load() >= 2);
        QCOMPARE(frames.size(), 0);
        capture.start({});
        QTRY_VERIFY(!frames.isEmpty());
        capture.setWarmup(true, "other-device");
        QTest::qWait(50);
        QCOMPARE(source->opens.load(), 2); // Finish current device before switching.
        capture.stop();
        QTRY_COMPARE(stopped.size(), 1);
        QTRY_COMPARE(source->opens.load(), 3);
        capture.setWarmup(false, {});
        QTRY_COMPARE(source->closes.load(), 3);
    }
    void warmupDiscardsIdleAudioAndReusesDeviceAcrossRecordings() {
        auto *source = new FakeCapture;
        AsyncAudioCapture capture(nullptr, source);
        QVector<float> received;
        connect(&capture, &AsyncAudioCapture::frames, this,
                [&](const QVector<float> &pcm, int) { received += pcm; });
        QSignalSpy stopped(&capture, &AsyncAudioCapture::stopped);
        capture.setWarmup(true, {});
        QTRY_VERIFY(source->produced.load() >= 5);
        QVERIFY(received.isEmpty());
        capture.start({});
        QTRY_VERIFY(!received.isEmpty());
        QVERIFY(received.first() > 1.f); // Idle prefix was discarded.
        capture.stop();
        QTRY_COMPARE(stopped.size(), 1);
        QCOMPARE(source->opens.load(), 1);
        QCOMPARE(source->closes.load(), 0);
        const float last = received.last();
        received.clear();
        QTest::qWait(50);
        QVERIFY(received.isEmpty());
        capture.start({});
        QTRY_VERIFY(!received.isEmpty());
        QVERIFY(received.first() > last + 1);
        QCOMPARE(source->opens.load(), 1);
        capture.cancel();
        capture.setWarmup(false, {});
        QTRY_COMPARE(source->closes.load(), 1);
    }
    void triggerDuringWarmupKeepsTheVeryFirstPacket() {
        auto *source = new FakeCapture;
        AsyncAudioCapture capture(nullptr, source);
        QVector<float> received;
        connect(&capture, &AsyncAudioCapture::frames, this,
                [&](const QVector<float> &pcm, int) { received += pcm; });
        capture.setWarmup(true, "slow");
        QTRY_COMPARE(source->opens.load(), 1);
        capture.start("slow");
        QTRY_VERIFY(!received.isEmpty());
        QCOMPARE(received.first(), 10001.f);
        QCOMPARE(source->opens.load(), 1);
        capture.cancel();
        capture.setWarmup(false, {});
        QTRY_COMPARE(source->closes.load(), 1);
    }
    void disableDuringWarmupClosesTheLateOpenedDevice() {
        auto *source = new FakeCapture;
        AsyncAudioCapture capture(nullptr, source);
        QSignalSpy frames(&capture, &AsyncAudioCapture::frames);
        capture.setWarmup(true, "slow");
        QTRY_COMPARE(source->opens.load(), 1);
        capture.setWarmup(false, {});
        QTRY_COMPARE(source->closes.load(), 1);
        QCOMPARE(frames.size(), 0);
        const int count = source->produced.load();
        QTest::qWait(50);
        QCOMPARE(source->produced.load(), count);
    }
    void slowOpenLeavesGuiResponsiveAndRetainsFirstAndLastPackets() {
        auto *source = new FakeCapture;
        AsyncAudioCapture capture(nullptr, source);
        QVector<float> received;
        connect(&capture, &AsyncAudioCapture::frames, this, [&](const QVector<float> &pcm, int rate) {
            QCOMPARE(rate, 16000);
            received += pcm;
        });
        QSignalSpy stopped(&capture, &AsyncAudioCapture::stopped);
        QSignalSpy failed(&capture, &AsyncAudioCapture::failed);
        capture.start("slow");
        QTRY_VERIFY(source->opens.load() == 1);
        bool heartbeat = false;
        QTimer::singleShot(10, this, [&] { heartbeat = true; });
        QTRY_VERIFY(heartbeat);
        QVERIFY(received.isEmpty()); // Device still opening; GUI handled its timer.
        QTRY_VERIFY(!received.isEmpty());
        capture.stop();
        QTRY_COMPARE(stopped.size(), 1);
        QCOMPARE(failed.size(), 0);
        QCOMPARE(received.size(), source->produced.load() * 80);
        for (qsizetype i = 0; i < received.size(); ++i)
            QCOMPARE(received[i], float(10001 + i / 80));
    }
    void consumerStallDoesNotStopProducerOrLoseAudio() {
        auto *source = new FakeCapture;
        AsyncAudioCapture capture(nullptr, source);
        QVector<float> received;
        connect(&capture, &AsyncAudioCapture::frames, this,
                [&](const QVector<float> &pcm, int) { received += pcm; });
        QSignalSpy stopped(&capture, &AsyncAudioCapture::stopped);
        capture.start({});
        QTRY_VERIFY(!received.isEmpty());
        const int before = source->produced.load();
        QThread::msleep(150); // Deliberately block only the consumer/GUI thread.
        QVERIFY(source->produced.load() > before + 5);
        capture.stop();
        QTRY_COMPARE(stopped.size(), 1);
        QCOMPARE(received.size(), source->produced.load() * 80);
        for (qsizetype i = 0; i < received.size(); ++i)
            QCOMPARE(received[i], float(1 + i / 80));
    }
    void cancelledOpeningCannotLeakAudioOrErrorsIntoNextSession() {
        auto *source = new FakeCapture;
        AsyncAudioCapture capture(nullptr, source);
        QVector<float> received;
        connect(&capture, &AsyncAudioCapture::frames, this,
                [&](const QVector<float> &pcm, int) { received += pcm; });
        QSignalSpy stopped(&capture, &AsyncAudioCapture::stopped);
        QSignalSpy failed(&capture, &AsyncAudioCapture::failed);
        for (const auto &id : {QByteArray("slow"), QByteArray("fail")}) {
            received.clear();
            const int before = source->opens.load();
            capture.start(id);
            QTRY_VERIFY(source->opens.load() > before);
            capture.cancel();
            capture.start({});
            QTRY_VERIFY(!received.isEmpty());
            capture.stop();
            QTRY_COMPARE(stopped.size(), 1);
            stopped.clear();
            QCOMPARE(failed.size(), 0);
            QCOMPARE(received.first(), 1.f);
            QCOMPARE(received.size(), source->produced.load() * 80);
            QVERIFY(*std::max_element(received.begin(), received.end()) < 10000.f);
        }
    }
};
QTEST_GUILESS_MAIN(CaptureTests)
#include "CaptureTests.moc"
