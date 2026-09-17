#pragma once
#include <QCoreApplication>
#include <QElapsedTimer>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QQuickItem>
#include <QQuickWindow>
#include <QScreen>
#include <QTimer>
#include <QVariantAnimation>
#include <QWheelEvent>
#include <algorithm>
#include <memory>

// Opt-in development measurement. No global input, audio, or network requests.
inline void profileSettingsWindow(QQuickWindow *window, const QString &output, bool wheel = false) {
    auto *scroll = window->findChild<QObject *>("settingsScroll");
    auto *content = scroll ? qvariant_cast<QQuickItem *>(scroll->property("contentItem")) : nullptr;
    if (!content) {
        QCoreApplication::exit(8);
        return;
    }
    struct Samples {
        QElapsedTimer clock;
        QVector<double> frames, ticks;
        qint64 frameAt = 0, tickAt = 0;
        bool outsideBounds = false;
    };
    auto samples = std::make_shared<Samples>();
    samples->clock.start();
    auto connection = QObject::connect(
        window, &QQuickWindow::frameSwapped, window,
        [samples] {
            const auto now = samples->clock.nsecsElapsed();
            if (samples->frameAt)
                samples->frames.append((now - samples->frameAt) / 1e6);
            samples->frameAt = now;
        },
        Qt::QueuedConnection);
    auto *timer = new QTimer(window);
    timer->setTimerType(Qt::PreciseTimer);
    timer->setInterval(8);
    QObject::connect(timer, &QTimer::timeout, window, [samples, content] {
        const auto now = samples->clock.nsecsElapsed();
        if (samples->tickAt)
            samples->ticks.append((now - samples->tickAt) / 1e6);
        samples->tickAt = now;
        const auto y = content->property("contentY").toDouble();
        const auto end = qMax(0., content->property("contentHeight").toDouble() - content->height());
        samples->outsideBounds |= y < -0.5 || y > end + 0.5;
    });
    auto *animation = new QVariantAnimation(window);
    auto *wheelTimer = new QTimer(window);
    auto wheelCount = std::make_shared<int>(0);
    wheelTimer->setInterval(100);
    QObject::connect(wheelTimer, &QTimer::timeout, window, [=] {
        const QPointF local(window->width() - 120, window->height() / 2);
        const QPointF global(window->mapToGlobal(local.toPoint()));
        const int step = (*wheelCount)++;
        const int direction = step < 2 ? 12000 : step > 53 ? -12000 : (step / 20) % 2 ? 120 : -120;
        QWheelEvent event(local, global, {}, QPoint(0, direction), Qt::NoButton, Qt::NoModifier, Qt::NoScrollPhase,
                          false);
        QCoreApplication::sendEvent(window, &event);
    });
    animation->setStartValue(0.);
    animation->setEndValue(qMin(1600., qMax(0., content->property("contentHeight").toDouble() - content->height())));
    animation->setDuration(6000);
    QObject::connect(animation, &QVariantAnimation::valueChanged, content, [content, wheel](const QVariant &value) {
        if (!wheel)
            content->setProperty("contentY", value);
    });
    QObject::connect(animation, &QVariantAnimation::finished, window, [=] {
        timer->stop();
        wheelTimer->stop();
        QObject::disconnect(connection);
        auto percentile = [](QVector<double> values, double fraction) {
            if (values.isEmpty())
                return 0.;
            std::sort(values.begin(), values.end());
            return values[qMin(values.size() - 1, qsizetype(values.size() * fraction))];
        };
        double total = 0;
        int slow = 0;
        for (double value : samples->frames) {
            total += value;
            slow += value > 33.4;
        }
        QJsonObject result{{"mode", wheel ? "mouse-wheel" : "continuous"},
                           {"frames", samples->frames.size()},
                           {"fps", total > 0 ? 1000. * samples->frames.size() / total : 0},
                           {"frameP95Ms", percentile(samples->frames, .95)},
                           {"frameMaxMs", percentile(samples->frames, 1)},
                           {"framesOver33Ms", slow},
                           {"guiTickP95Ms", percentile(samples->ticks, .95)},
                           {"guiTickMaxMs", percentile(samples->ticks, 1)},
                           {"screenHz", window->screen()->refreshRate()},
                           {"finalScrollY", content->property("contentY").toDouble()},
                           {"outsideBounds", samples->outsideBounds},
                           {"graphicsApi", int(window->rendererInterface()->graphicsApi())}};
        QFile file(output);
        const auto bytes = QJsonDocument(result).toJson();
        const bool saved = file.open(QIODevice::WriteOnly) && file.write(bytes) == bytes.size();
        qInfo().noquote() << bytes;
        QCoreApplication::exit(saved && !samples->outsideBounds ? 0 : 9);
    });
    timer->start();
    if (wheel)
        wheelTimer->start();
    animation->start();
}
