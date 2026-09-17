#include "AppController.h"
#include "TextCleanup.h"
#include <QClipboard>
#include <QCoreApplication>
#include <QCursor>
#include <QDateTime>
#include <QDesktopServices>
#include <QDir>
#include <QFile>
#include <QGuiApplication>
#include <QInputMethod>
#include <QJsonArray>
#include <QJsonDocument>
#include <QPermission>
#include <QRegularExpression>
#include <QSaveFile>
#include <QScreen>
#include <QThread>
#include <QUrl>
#include <cmath>
#include <cstring>
#ifdef Q_OS_WIN
#include <windows.h>
#include <psapi.h>
#endif

void AppController::commitInputMethod() {
    QGuiApplication::inputMethod()->commit();
}

AppController::AppController(QString dataDirectory, QString modelDirectory, bool hooks, bool maintenance,
                             QObject *parent)
    : QObject(parent), m_settings(std::move(dataDirectory)), m_catalog(modelDirectory), m_manager(modelDirectory),
      m_platform(createPlatform()), m_triggers(m_platform.get()), m_output(m_platform.get()),
      m_desktop(m_settings.directory()) {
    connect(this, &AppController::modelsChanged, this, &AppController::refreshModelRows);
    refreshModelRows();
    configureTriggers();
    m_uptime.start();
    m_resourceTime.start();
    connect(&m_triggers, &TriggerController::pressed, this, [this] { start(true); });
    connect(&m_triggers, &TriggerController::released, this, &AppController::finish);
    connect(&m_triggers, &TriggerController::cancelled, this, &AppController::cancelRecording);
    connect(&m_audio, &AudioCapture::levelChanged, this, [this](double level) {
        m_level = level;
        emit levelChanged();
    });
    connect(&m_audio, &AudioCapture::frames, this, &AppController::frames);
    connect(&m_audio, &AudioCapture::devicesChanged, this, &AppController::devicesChanged);
    connect(&m_audio, &AudioCapture::failed, this, &AppController::fail);
    connect(&m_audio, &AudioCapture::limitReached, this, &AppController::finish, Qt::QueuedConnection);
    connect(&m_testAudio, &AudioCapture::levelChanged, this, [this](double level) {
        m_testLevel = level;
        emit levelChanged();
    });
    connect(&m_testAudio, &AudioCapture::frames, this, [this] { m_testAudio.takeSamples(); });
    connect(&m_testAudio, &AudioCapture::failed, this, [this](const QString &error) {
        m_error = error;
        m_testing = false;
        m_testAudio.stop();
        emit changed();
    });
    m_idle.setSingleShot(true);
    connect(&m_idle, &QTimer::timeout, this, [this] {
        if (!m_session) {
            m_loadingRoles = true;
            m_offline.stop();
            m_stream.stop();
            m_corrector.stop();
            m_loadingRoles = false;
            m_state = "unloaded";
            emit changed();
            emit modelsChanged();
        }
    });
    m_watchdog.setSingleShot(true);
    connect(&m_watchdog, &QTimer::timeout, this, [this] {
        m_loadingRoles = true;
        m_offline.stop();
        m_stream.stop();
        m_corrector.stop();
        m_loadingRoles = false;
        fail("识别超时，请重新加载模型");
    });
    for (auto *worker : {&m_offline, &m_stream, &m_corrector}) {
        connect(worker, &WorkerProcess::stateChanged, this, [this] {
            emit modelsChanged();
            if (!m_loadingRoles) {
                updateState();
                pump();
            }
        });
    }
    connect(&m_offline, &WorkerProcess::failed, this, [this](const QString &error) {
        if (m_loadingRoles)
            return;
        fail(error);
    });
    connect(&m_stream, &WorkerProcess::failed, this, [this](const QString &error) {
        if (m_loadingRoles)
            return;
        m_error = error;
        if (m_settings.values()["modelId"] == "none") {
            fail(error);
            return;
        }
        for (auto &job : m_jobs)
            job.streamDone = true;
        emit changed();
        pump();
    });
    connect(&m_corrector, &WorkerProcess::failed, this, [this](const QString &error) {
        if (m_loadingRoles)
            return;
        m_error = error;
        if (m_jobs.contains(m_correctionJob)) {
            auto &job = m_jobs[m_correctionJob];
            job.text = cleanupSpeech(job.raw, m_settings.values());
            job.stage = "done";
            m_correctionJob = 0;
        }
        drainJobs();
        emit changed();
        pump();
    });
    connect(&m_offline, &WorkerProcess::event, this, [this](const QJsonObject &event) {
        if (event["type"] == "ready") {
            pump();
            return;
        }
        const int id = event["id"].toInt();
        if (event["type"] == "result" && m_abandonedAudio.contains(id))
            QFile::remove(m_abandonedAudio.take(id));
        if (event["type"] != "result" || id != m_asrJob || !m_jobs.contains(id))
            return;
        auto &job = m_jobs[id];
        job.raw = event["text"].toString();
        job.stage = "correct";
        QFile::remove(job.path);
        m_asrJob = 0;
        m_watchdog.stop();
        pump();
    });
    connect(&m_corrector, &WorkerProcess::event, this, [this](const QJsonObject &event) {
        if (event["type"] == "ready") {
            pump();
            return;
        }
        const int id = event["id"].toInt();
        if (event["type"] != "result" || id != m_correctionJob || !m_jobs.contains(id))
            return;
        auto &job = m_jobs[id];
        job.text = cleanupSpeech(event["text"].toString(), m_settings.values());
        job.stage = "done";
        m_correctionJob = 0;
        drainJobs();
        pump();
    });
    connect(&m_stream, &WorkerProcess::event, this, [this](const QJsonObject &event) {
        const auto type = event["type"].toString();
        if (type == "ready") {
            pump();
            feedStream();
            return;
        }
        const int id = event["id"].toInt();
        if (type == "partial" && m_recording && id == m_segment) {
            m_partial = event["text"].toString();
            if (m_settings.values()["injectMode"] == "live")
                insertText(result());
            emit changed();
        }
        if (type == "result" && m_jobs.contains(id)) {
            auto &job = m_jobs[id];
            job.preview = event["text"].toString();
            job.streamDone = true;
            if (id == m_streamReplayJob)
                m_streamReplayJob = 0;
            pump();
            feedStream();
        }
    });
    connect(&m_manager, &ModelManager::changed, this, &AppController::modelsChanged);
    connect(&m_manager, &ModelManager::failed, this, [this](const QString &error) {
        m_error = error;
        emit changed();
    });
    connect(&m_manager, &ModelManager::completed, this, [this](const QString &id) {
        const auto pending = m_pendingSelection;
        for (auto it = pending.begin(); it != pending.end(); ++it)
            if (it.value() == id && m_catalog.installed(m_catalog.find(id))) {
                m_pendingSelection.remove(it.key());
                if (m_settings.values()[it.key()] == id)
                    loadRole(it.key());
                else
                    setSetting(it.key(), id);
            }
        if (id == "ct-transformer" && m_catalog.installed(m_catalog.find(id)) && !m_session)
            loadRole("modelId");
        emit modelsChanged();
    });
    connect(&m_desktop, &DesktopServices::changed, this, &AppController::maintenanceChanged);
    connect(&m_desktop, &DesktopServices::failed, this, [this](const QString &error) {
        m_error = error;
        emit changed();
    });
    connect(&m_desktop, &DesktopServices::dictionaryChanged, this, [this] {
        const QJsonObject message{{"type", "dictionary:update"}, {"path", m_desktop.dictionaryPath()}};
        m_offline.send(message);
        m_corrector.send(message);
    });
    connect(&m_llm, &LlmService::completed, this, [this](int generation, const QString &source, const QString &text) {
        if (generation != m_generation || !m_session)
            return;
        if (m_result.startsWith(source)) {
            m_result = text + m_result.mid(source.size());
            insertText(m_result);
            emit changed();
        }
        if (m_finishing) {
            m_finishing = false;
            saveHistory();
            m_session = false;
            updateState();
            armIdle();
        } else if (!m_recording && m_jobs.isEmpty())
            completeSession();
    });
    QFile file(QDir(m_settings.directory()).filePath("history.jsonl"));
    if (file.open(QIODevice::ReadOnly))
        while (!file.atEnd()) {
            const auto row = QJsonDocument::fromJson(file.readLine()).object();
            if (row["text"].isString())
                m_history.prepend(row.toVariantMap());
            if (m_history.size() > 200)
                m_history.removeLast();
        }
    if (hooks) {
        QString error;
        if (!m_platform->start(&error))
            m_error = error;
    }
    if (!m_settings.loadError().isEmpty())
        m_error = m_settings.loadError();
    m_tick.setInterval(serviceEnabled() ? 100 : 2000);
    connect(&m_tick, &QTimer::timeout, this, [this] {
        if (m_resourceTime.elapsed() >= 2000)
            sampleResources();
        if (m_recording)
            feedStream();
        if (m_session && updateOverlayPosition())
            emit changed();
    });
    m_tick.start();
    QTimer::singleShot(0, this, [this, maintenance] {
        reloadModel();
        if (maintenance) {
            m_desktop.configure(m_settings.values());
            m_desktop.checkUpdates();
        }
    });
}
AppController::~AppController() {
    m_recording = false;
    m_session = false;
    m_loadingRoles = true;
    for (auto *worker : {&m_offline, &m_stream, &m_corrector}) {
        disconnect(worker, nullptr, this, nullptr);
        worker->stop();
    }
    disconnect(&m_audio, nullptr, this, nullptr);
    disconnect(&m_testAudio, nullptr, this, nullptr);
    disconnect(&m_manager, nullptr, this, nullptr);
    m_manager.cancel();
    m_audio.stop();
    m_testAudio.stop();
    m_llm.cancel();
}
QString AppController::version() const {
    return QCoreApplication::applicationVersion();
}
QVariantList AppController::modelRows(const QString &group, const QString &key, const WorkerProcess &worker) const {
    auto rows = m_manager.models(group);
    for (auto &value : rows) {
        auto row = value.toMap();
        row["selected"] = row["id"].toString() == m_settings.values()[key].toString();
        row["loading"] = row["selected"].toBool() && worker.state() == "loading";
        row["loadError"] = row["selected"].toBool() && worker.state() == "error";
        value = row;
    }
    rows.prepend(QVariantMap{{"id", "none"}, {"name", "none"}, {"selected", m_settings.values()[key] == "none"}});
    return rows;
}
void AppController::refreshModelRows() {
    m_offlineRows.update(modelRows("offline", "modelId", m_offline));
    m_streamRows.update(modelRows("streaming", "streamingModel", m_stream));
    m_correctionRows.update(modelRows("correction", "correctionModel", m_corrector));
    m_punctuationRows.update(m_manager.models("punct"));
}
void AppController::loadRole(const QString &key) {
    if (!serviceEnabled()) {
        updateState();
        return;
    }
    auto *worker = key == "modelId" ? &m_offline : key == "streamingModel" ? &m_stream : &m_corrector;
    m_loadingRoles = true;
    worker->stop();
    const auto id = m_settings.values()[key].toString();
    if ((id != "none" || key == "modelId") && (id == "none" || m_catalog.installed(m_catalog.find(id)))) {
        const auto flag = key == "modelId"          ? "--asr-worker"
                          : key == "streamingModel" ? "--stream-worker"
                                                    : "--correction-worker";
        worker->start(
            {flag, "--model-dir", m_catalog.root(), "--model-id", id, "--dictionary", m_desktop.dictionaryPath()});
    }
    m_loadingRoles = false;
    updateState();
    emit modelsChanged();
}
void AppController::reloadModel() {
    if (m_session)
        return;
    loadRole("modelId");
    loadRole("streamingModel");
    loadRole("correctionModel");
}
void AppController::updateState() {
    if (m_loadingRoles)
        return;
    if (!serviceEnabled())
        m_state = "paused";
    else if (m_recording)
        m_state = "recording";
    else if (m_session)
        m_state = "recognizing";
    else if (m_offline.state() == "loading" || m_stream.state() == "loading")
        m_state = "loading";
    else if (m_offline.ready() && (m_settings.values()["modelId"] != "none" || m_stream.ready())) {
        m_state = "ready";
        armIdle();
    } else
        m_state = "error";
    emit changed();
}
void AppController::armIdle() {
    const int minutes = m_settings.values()["idleUnloadMin"].toInt(10);
    if (serviceEnabled() && minutes > 0 && !m_session)
        m_idle.start(minutes * 60000);
    else
        m_idle.stop();
}
void AppController::setSetting(const QString &key, const QVariant &value) {
    if (key == "serviceEnabled") {
        setServiceEnabled(value.toBool());
        return;
    }
    const auto json = QJsonValue::fromVariant(value);
    if (m_settings.values()[key] == json)
        return;
    const bool model = QStringList{"modelId", "streamingModel", "correctionModel"}.contains(key);
    if (m_session) {
        m_error = "请结束录音后再修改设置";
        emit changed();
        return;
    }
    if (model && value.toString() != "none" && !m_catalog.installed(m_catalog.find(value.toString()))) {
        selectModel(key, value.toString());
        return;
    }
    if (model && ((key == "modelId" && value == "none" && m_settings.values()["streamingModel"] == "none") ||
                  (key == "streamingModel" && value == "none" && m_settings.values()["modelId"] == "none"))) {
        m_error = "请至少保留一个语音识别模型";
        emit changed();
        return;
    }
    QString error;
    if (key == "launchAtLogin" && !m_desktop.setStartup(value.toBool(), &error)) {
        m_error = error;
        emit changed();
        return;
    }
    if (!m_settings.set(key, json, &error)) {
        m_error = error;
        emit changed();
        return;
    }
    configureTriggers();
    emit settingsChanged();
    if (model)
        loadRole(key);
    if (key == "idleUnloadMin")
        armIdle();
    if (key == "dictionaryAutoUpdate" || key == "autoUpdate")
        m_desktop.configure(m_settings.values());
}
void AppController::selectModel(const QString &role, const QString &id) {
    if (m_session) {
        m_error = "请结束录音后再切换模型";
        emit changed();
        return;
    }
    const QString group = role == "modelId"           ? "offline"
                          : role == "streamingModel"  ? "streaming"
                          : role == "correctionModel" ? "correction"
                                                      : "punct";
    bool valid = id == "none" && group != "punct";
    for (const auto &row : m_catalog.models(group))
        valid |= row.toMap()["id"].toString() == id;
    if (!valid)
        return;
    if (id == "none" || m_catalog.installed(m_catalog.find(id))) {
        m_pendingSelection.remove(role);
        if (group != "punct") {
            auto *worker = role == "modelId" ? &m_offline : role == "streamingModel" ? &m_stream : &m_corrector;
            if (m_settings.values()[role] == id && id != "none" &&
                (worker->state() == "error" || worker->state() == "unloaded"))
                loadRole(role);
            else
                setSetting(role, id);
        }
        return;
    }
    m_pendingSelection[role] = id;
    m_manager.download(id);
}
void AppController::deleteModel(const QString &id) {
    if (m_manager.busy()) {
        m_error = "请等待当前模型操作完成";
        emit changed();
        return;
    }
    if (m_session) {
        m_error = "请结束录音后再删除模型";
        emit changed();
        return;
    }
    for (const auto &key : {"modelId", "streamingModel", "correctionModel"})
        if (m_settings.values()[key] == id) {
            m_loadingRoles = true;
            (QString(key) == "modelId"          ? &m_offline
             : QString(key) == "streamingModel" ? &m_stream
                                                : &m_corrector)
                ->stop();
            m_loadingRoles = false;
        }
    if (id == "ct-transformer")
        m_offline.stop();
    m_manager.remove(id);
    updateState();
}
void AppController::cancelDownload(const QString &id) {
    for (auto it = m_pendingSelection.begin(); it != m_pendingSelection.end();) {
        if (id.isEmpty() || it.value() == id)
            it = m_pendingSelection.erase(it);
        else
            ++it;
    }
    m_manager.cancel(id);
}
void AppController::configureTriggers() {
    auto config = m_settings.values();
    if (!serviceEnabled()) {
        config["keyboardEnabled"] = false;
        config["mouseEnabled"] = false;
    }
    m_triggers.configure(config);
}
void AppController::setServiceEnabled(bool enabled) {
    if (enabled == serviceEnabled())
        return;
    QString error;
    if (!m_settings.set("serviceEnabled", enabled, &error)) {
        m_error = error;
        emit changed();
        return;
    }
    if (!enabled) {
        cancelRecording();
        m_testAudio.stop();
        m_testing = false;
        m_level = m_testLevel = 0;
        m_idle.stop();
        m_loadingRoles = true;
        m_offline.stop();
        m_stream.stop();
        m_corrector.stop();
        m_loadingRoles = false;
        for (const auto &path : m_abandonedAudio)
            QFile::remove(path);
        m_abandonedAudio.clear();
        m_tick.setInterval(2000);
        updateState();
        emit levelChanged();
        emit modelsChanged();
        sampleResources();
    } else {
        m_error.clear();
        m_tick.setInterval(100);
        reloadModel();
    }
    configureTriggers();
    emit settingsChanged();
}
bool AppController::updateOverlayPosition() {
    const auto caret = m_settings.values()["followCaret"].toBool(true) ? m_platform->caretRect() : QRect{};
    const auto cursor = caret.isEmpty() ? QCursor::pos() : caret.bottomLeft();
    auto *screen = QGuiApplication::screenAt(cursor);
    if (!screen)
        screen = QGuiApplication::primaryScreen();
    if (screen) {
        const auto area = screen->availableGeometry();
        const bool compact = m_settings.values()["streamingModel"] == "none";
        const int width = compact ? 208 : 420, height = compact ? 64 : 92;
        const auto point = caret.isEmpty() ? QPoint(area.center().x() - width / 2, area.bottom() - height - 96)
                                           : QPoint(caret.left() - width / 2, caret.bottom() + 8);
        const QPoint next(qBound(area.left() + 8, point.x(), qMax(area.left() + 8, area.right() - width - 8)),
                          qBound(area.top() + 8, point.y(), qMax(area.top() + 8, area.bottom() - height - 8)));
        if (next != m_overlayPosition) {
            m_overlayPosition = next;
            return true;
        }
    }
    return false;
}
void AppController::start(bool inject) {
    if (!serviceEnabled() || m_session)
        return;
    if (m_state == "unloaded" || (!m_offline.ready() && m_offline.state() != "loading"))
        reloadModel();
    const auto selected = m_settings.values()["modelId"].toString();
    if (selected != "none" && !m_catalog.installed(m_catalog.find(selected))) {
        m_error = "请先下载语音识别模型";
        emit changed();
        return;
    }
    if (selected == "none" && !m_catalog.installed(m_catalog.find(m_settings.values()["streamingModel"].toString()))) {
        m_error = "请先下载流式模型";
        emit changed();
        return;
    }
    QMicrophonePermission permission;
    if (qApp->checkPermission(permission) == Qt::PermissionStatus::Undetermined) {
        qApp->requestPermission(permission, this, [this](const QPermission &) {
            m_error = "麦克风权限已更新，请重新开始录音";
            emit changed();
        });
        return;
    }
    if (qApp->checkPermission(permission) == Qt::PermissionStatus::Denied) {
        fail("请允许访问麦克风");
        return;
    }
    m_target = inject ? m_platform->target() : 0;
    m_inject = inject;
    m_output.begin(m_target);
    if (m_testing) {
        m_testAudio.stop();
        m_testing = false;
    }
    QString error;
    if (!m_audio.start(QByteArray::fromBase64(m_settings.values()["deviceId"].toString().toLatin1()), &error)) {
        fail(error);
        return;
    }
    m_idle.stop();
    ++m_generation;
    updateOverlayPosition();
    m_session = true;
    m_recording = true;
    m_finishing = false;
    m_result.clear();
    m_partial.clear();
    m_raw.clear();
    m_error.clear();
    m_jobs.clear();
    m_streamBuffer.clear();
    m_streamRate = m_audio.sampleRate();
    m_segment = ++m_request;
    m_streamStarted = false;
    m_segmentMs = 0;
    m_silenceMs = 0;
    m_segments = 0;
    m_lastRolling = 0;
    m_recordTime.start();
    m_watchdog.start(90000);
    feedStream();
    updateState();
}
void AppController::frames(const QVector<float> &samples, int rate) {
    if (!m_recording || samples.isEmpty())
        return;
    if (m_settings.values()["streamingModel"] != "none")
        m_streamBuffer.append(samples);
    double energy = 0;
    for (auto sample : samples)
        energy += double(sample) * sample;
    const double ms = 1000. * samples.size() / rate;
    m_segmentMs += ms;
    if (std::sqrt(energy / samples.size()) > .005)
        m_silenceMs = 0;
    else
        m_silenceMs += ms;
    if (m_segmentMs >= 30000 ||
        (m_segmentMs >= 500 && m_silenceMs >= m_settings.values()["endpointSilenceMs"].toInt(1500))) {
        if (!m_cutPending) {
            m_cutPending = true;
            QTimer::singleShot(0, this, [this] {
                m_cutPending = false;
                if (m_recording)
                    cutSegment(m_audio.takeSamples(), m_audio.sampleRate());
            });
        }
    }
    if (m_streamBuffer.size() > rate * 30) {
        m_error = "流式模型未及时响应";
        m_streamBuffer.clear();
        if (m_settings.values()["modelId"] == "none")
            fail(m_error);
    }
}
void AppController::feedStream() {
    if (!m_session || !m_stream.ready() || m_streamReplayJob)
        return;
    if (!m_streamStarted) {
        m_streamStarted = m_stream.send({{"type", "start"}, {"id", m_segment}});
    }
    if (m_streamStarted && !m_streamBuffer.isEmpty()) {
        const QByteArray bytes(reinterpret_cast<const char *>(m_streamBuffer.constData()), m_streamBuffer.size() * 4);
        if (m_stream.send({{"type", "audio"},
                           {"id", m_segment},
                           {"sampleRate", m_streamRate},
                           {"samples", QString::fromLatin1(bytes.toBase64())}}))
            m_streamBuffer.clear();
    }
}
void AppController::cutSegment(QVector<float> samples, int rate) {
    if (!m_session)
        return;
    feedStream();
    const int id = m_segment;
    const bool streamed = m_streamStarted && m_stream.send({{"type", "finish"}, {"id", id}});
    if (hasVoice(samples, rate)) {
        if (m_jobs.size() >= 8) {
            fail("识别速度跟不上录音，请稍后继续");
            return;
        }
        Job job;
        job.id = id;
        job.rate = rate;
        job.preview = m_partial;
        job.streamQueued = streamed;
        job.streamDone = !streamed && m_settings.values()["modelId"] != "none";
        job.path = m_temp.filePath(QString::number(id) + ".f32");
        QFile file(job.path);
        const auto bytes = samples.size() * qint64(4);
        if (!file.open(QIODevice::WriteOnly) ||
            file.write(reinterpret_cast<const char *>(samples.constData()), bytes) != bytes) {
            fail("无法保存临时录音");
            return;
        }
        file.close();
        m_jobs[id] = job;
    }
    m_partial.clear();
    m_segment = ++m_request;
    m_streamStarted = false;
    m_streamBuffer.clear();
    m_segmentMs = 0;
    m_silenceMs = 0;
    if (m_recording)
        feedStream();
    pump();
    emit changed();
}
void AppController::finish() {
    if (!m_recording)
        return;
    // Drain before lowering the recording flag so the last device frames reach
    // both recognizers. Queued segment cuts see the flag and cannot run twice.
    auto samples = m_audio.stop();
    m_recording = false;
    m_duration = int(m_recordTime.elapsed());
    if (m_duration < m_settings.values()["minHoldMs"].toInt(200)) {
        cancelRecording();
        return;
    }
    cutSegment(std::move(samples), m_audio.sampleRate());
    updateState();
    if (m_jobs.isEmpty())
        completeSession();
}
void AppController::pump() {
    if (!m_session)
        return;
    const auto config = m_settings.values();
    for (auto it = m_jobs.begin(); it != m_jobs.end(); ++it) {
        auto &job = it.value();
        if (config["modelId"] == "none" && !job.streamDone && !job.streamQueued && m_stream.ready() &&
            !m_streamReplayJob) {
            QFile audio(job.path);
            if (!audio.open(QIODevice::ReadOnly)) {
                fail("无法读取待识别录音");
                return;
            }
            const auto bytes = audio.readAll();
            const bool sent = m_stream.send({{"type", "start"}, {"id", job.id}}) &&
                              m_stream.send({{"type", "audio"},
                                             {"id", job.id},
                                             {"sampleRate", job.rate},
                                             {"samples", QString::fromLatin1(bytes.toBase64())}}) &&
                              m_stream.send({{"type", "finish"}, {"id", job.id}});
            if (!sent) {
                fail("流式识别队列已满，请稍后继续");
                return;
            }
            job.streamQueued = true;
            m_streamReplayJob = job.id;
            m_streamStarted = false;
        }
        if (job.stage == "waiting" && !m_asrJob && m_offline.ready()) {
            if (config["modelId"] == "none" && !job.streamDone)
                continue;
            QJsonObject request{{"type", "decode"},
                                {"id", job.id},
                                {"path", job.path},
                                {"sampleRate", job.rate},
                                {"streamText", job.preview},
                                {"hotwords", config["hotwords"]},
                                {"dictionaryEnabled", config["dictionaryEnabled"]}};
            if (m_offline.send(request)) {
                m_asrJob = job.id;
                job.stage = "decoding";
                m_watchdog.start(60000);
            }
        }
        if (job.stage == "correct" && !m_correctionJob) {
            if (config["correctionModel"] == "none" || m_corrector.state() == "error" ||
                m_corrector.state() == "unloaded" || job.raw.isEmpty()) {
                job.text = cleanupSpeech(job.raw, config);
                job.stage = "done";
            } else if (m_corrector.ready() && m_corrector.send({{"type", "correct"},
                                                                {"id", job.id},
                                                                {"text", job.raw},
                                                                {"hotwords", config["hotwords"]},
                                                                {"dictionaryEnabled", config["dictionaryEnabled"]}})) {
                m_correctionJob = job.id;
                job.stage = "correcting";
                m_watchdog.start(60000);
            }
        }
    }
    drainJobs();
}
void AppController::drainJobs() {
    while (!m_jobs.isEmpty() && m_jobs.first().stage == "done") {
        const auto job = m_jobs.take(m_jobs.firstKey());
        QFile::remove(job.path);
        if (!job.text.isEmpty()) {
            m_result += job.text;
            m_raw += job.raw;
            ++m_segments;
            insertText(m_result);
            emit changed();
        }
    }
    if (m_jobs.isEmpty())
        m_watchdog.stop();
    const auto config = m_settings.values();
    if (m_recording && config["llmEnabled"].toBool() && config["consolidationMode"] == "rolling" && !m_llm.busy() &&
        m_result.size() - m_lastRolling >= config["rollingChars"].toInt(300)) {
        m_lastRolling = m_result.size();
        m_llm.consolidate(m_result, config, m_generation);
    }
    if (!m_recording && m_jobs.isEmpty())
        completeSession();
}
void AppController::completeSession() {
    if (!m_session || m_finishing || m_llm.busy())
        return;
    m_watchdog.stop();
    m_partial.clear();
    const auto config = m_settings.values();
    if (config["llmEnabled"].toBool() && config["consolidationMode"] != "off" &&
        m_result.size() >= config["minChars"].toInt(120) && !m_result.isEmpty()) {
        m_finishing = true;
        m_llm.consolidate(m_result, config, m_generation);
        return;
    }
    if (!m_result.isEmpty()) {
        insertText(m_result);
        saveHistory();
    }
    m_session = false;
    updateState();
    armIdle();
}
void AppController::insertText(const QString &text) {
    if (!m_inject || text.isEmpty())
        return;
    auto config = m_settings.values();
    config["triggerOwned"] = m_triggers.keyboardActive();
    QString error;
    if (!m_output.update(text, config, m_settings.values()["maxReplaceChars"].toInt(1500), &error))
        m_error = error;
}
void AppController::cancelRecording() {
    m_recording = false;
    m_audio.stop();
    m_session = false;
    m_finishing = false;
    m_llm.cancel();
    ++m_generation;
    for (const auto &job : m_jobs) {
        if (job.id == m_asrJob)
            m_abandonedAudio[job.id] = job.path;
        else
            QFile::remove(job.path);
    }
    m_jobs.clear();
    m_streamBuffer.clear();
    m_streamReplayJob = 0;
    m_asrJob = 0;
    m_correctionJob = 0;
    m_partial.clear();
    m_watchdog.stop();
    updateState();
    armIdle();
    emit changed();
}
void AppController::fail(const QString &message) {
    cancelRecording();
    m_error = message;
    m_state = "error";
    emit changed();
}
void AppController::toggleRecording() {
    if (m_recording)
        finish();
    else
        start(false);
}
void AppController::transcribeForTest(const QString &path, int rate, int segments, int releaseDelayMs) {
    if (!serviceEnabled() || m_session || !m_offline.ready())
        return;
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly) || file.size() > qint64(rate) * 120 * 4 || file.size() % 4) {
        fail("Invalid pipeline test PCM");
        return;
    }
    const auto bytes = file.readAll();
    QVector<float> samples(bytes.size() / 4);
    memcpy(samples.data(), bytes.constData(), bytes.size());
    m_idle.stop();
    ++m_generation;
    updateOverlayPosition();
    m_session = true;
    m_recording = true;
    m_inject = false;
    m_state = "recording";
    m_result.clear();
    m_raw.clear();
    m_partial.clear();
    m_segments = 0;
    m_duration = samples.size() * 1000 / rate * segments;
    m_streamRate = rate;
    m_segment = ++m_request;
    m_streamStarted = false;
    updateState();
    auto release = [this, samples = std::move(samples), rate, segments] {
        for (int i = 0; i < qBound(1, segments, 4); ++i) {
            if (m_stream.ready()) {
                m_streamBuffer = samples;
                feedStream();
            }
            // Match the real release ordering: audio has stopped while the
            // final segment is queued, before the state becomes recognizing.
            if (i == qBound(1, segments, 4) - 1)
                m_recording = false;
            cutSegment(samples, rate);
        }
        updateState();
    };
    if (releaseDelayMs > 0)
        QTimer::singleShot(releaseDelayMs, this, std::move(release));
    else
        release();
}
void AppController::toggleMicTest() {
    if (!serviceEnabled() || m_session)
        return;
    if (m_testing) {
        m_testAudio.stop();
        m_testing = false;
    } else {
        QString error;
        m_testing =
            m_testAudio.start(QByteArray::fromBase64(m_settings.values()["deviceId"].toString().toLatin1()), &error);
        if (!m_testing)
            m_error = error;
    }
    emit changed();
}
void AppController::saveWords(const QString &key, const QString &text) {
    if (!QStringList{"hotwords", "extraFillers", "clipboardOnlyApps"}.contains(key))
        return;
    QStringList list;
    for (const auto &word : text.split(QRegularExpression("[\\r\\n,，]+"), Qt::SkipEmptyParts)) {
        const auto clean = word.trimmed();
        if (!clean.isEmpty() && !list.contains(clean))
            list.append(clean);
    }
    setSetting(key, list);
}
QString AppController::cleanupPreview(const QString &text) const {
    return cleanupSpeech(text, m_settings.values());
}
void AppController::copyResult() {
    copyText(m_result);
}
void AppController::copyText(const QString &text) {
    QGuiApplication::clipboard()->setText(text);
}
void AppController::openModelDirectory() {
    QDesktopServices::openUrl(QUrl::fromLocalFile(m_catalog.root()));
}
void AppController::saveHistory() {
    if (m_result.isEmpty())
        return;
    const QJsonObject row{{"text", m_result},
                          {"raw", m_raw},
                          {"time", QDateTime::currentDateTime().toString(Qt::ISODate)},
                          {"duration", m_duration},
                          {"segments", m_segments},
                          {"target", m_platform->targetProcess(m_target)}};
    m_history.prepend(row.toVariantMap());
    if (m_history.size() > 200)
        m_history.removeLast();
    writeHistory();
}
void AppController::writeHistory() {
    QSaveFile file(QDir(m_settings.directory()).filePath("history.jsonl"));
    QByteArray bytes;
    for (auto it = m_history.crbegin(); it != m_history.crend(); ++it)
        bytes += QJsonDocument(QJsonObject::fromVariantMap(it->toMap())).toJson(QJsonDocument::Compact) + '\n';
    if (!file.open(QIODevice::WriteOnly) || file.write(bytes) != bytes.size() || !file.commit())
        m_error = "历史记录保存失败";
    emit historyChanged();
}
void AppController::deleteHistory(int index) {
    if (index < 0 || index >= m_history.size())
        return;
    m_history.removeAt(index);
    writeHistory();
}
void AppController::clearHistory() {
    m_history.clear();
    writeHistory();
}
QVariantMap AppController::statistics() const {
    int chars = 0, duration = 0;
    for (const auto &row : m_history) {
        chars += row.toMap()["text"].toString().size();
        duration += row.toMap()["duration"].toInt();
    }
    return {{"count", m_history.size()},
            {"characters", chars},
            {"minutes", qMax(0, qRound(chars / 60. - duration / 60000.))}};
}
void AppController::sampleResources() {
    const auto elapsed = qMax(qint64(1), m_resourceTime.restart());
    QVariantList rows;
    double memory = 0, cpu = 0;
    QMap<qint64, quint64> times;
    const QList<QPair<QString, qint64>> processes{{"主程序", QCoreApplication::applicationPid()},
                                                  {"流式识别", m_stream.pid()},
                                                  {"定稿识别", m_offline.pid()},
                                                  {"同音纠错", m_corrector.pid()}};
    for (const auto &entry : processes) {
        if (!entry.second)
            continue;
        double mb = 0, load = 0;
#ifdef Q_OS_WIN
        HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, FALSE, DWORD(entry.second));
        if (!process)
            continue;
        PROCESS_MEMORY_COUNTERS counters{};
        counters.cb = sizeof(counters);
        if (K32GetProcessMemoryInfo(process, &counters, sizeof(counters)))
            mb = counters.WorkingSetSize / 1048576.;
        FILETIME created, ended, kernel, user;
        if (GetProcessTimes(process, &created, &ended, &kernel, &user)) {
            const quint64 total = (quint64(kernel.dwHighDateTime) << 32) + kernel.dwLowDateTime +
                                  (quint64(user.dwHighDateTime) << 32) + user.dwLowDateTime;
            times[entry.second] = total;
            if (m_cpuTimes.contains(entry.second) && total >= m_cpuTimes[entry.second])
                load = 100. * double(total - m_cpuTimes[entry.second]) /
                       (elapsed * 10000. * qMax(1, QThread::idealThreadCount()));
        }
        CloseHandle(process);
#endif
        // Identify the role, not the process ID: restarting a worker must not
        // recreate a surviving resource row or reset its progress animation.
        rows.append(QVariantMap{
            {"id", entry.first}, {"name", entry.first}, {"memory", mb}, {"cpu", load}, {"pid", entry.second}});
        memory += mb;
        cpu += load;
    }
    qint64 bytes = 0;
    for (const auto &group : {"offline", "streaming", "correction", "punct"})
        for (const auto &entry : m_manager.models(group))
            bytes += entry.toMap()["bytes"].toLongLong();
    m_cpuTimes = times;
    for (auto &entry : rows) {
        auto row = entry.toMap();
        row["share"] = row["memory"].toDouble() / qMax(1., memory);
        entry = row;
    }
    m_resourceRows.update(rows);
    m_resources = {{"memory", memory}, {"cpu", cpu}, {"uptime", m_uptime.elapsed()}, {"modelMB", bytes / 1048576.}};
    emit resourcesChanged();
}
QVariantList AppController::changelog() const {
    QFile file(":/vocal/resources/changelog.json");
    if (!file.open(QIODevice::ReadOnly))
        return {};
    return QJsonDocument::fromJson(file.readAll()).array().toVariantList();
}
