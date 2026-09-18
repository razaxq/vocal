#pragma once
#include "AudioCapture.h"
#include "AsyncAudioCapture.h"
#include "AudioSegmenter.h"
#include <functional>
#include "DesktopServices.h"
#include "LlmService.h"
#include "ModelManager.h"
#include "ModelRows.h"
#include "NativeRelease.h"
#include "Settings.h"
#include "SessionDebug.h"
#include <QSet>
#include "TextOutput.h"
#include "TriggerController.h"
#include "WorkerProcess.h"
#include <QElapsedTimer>
#include <QMap>
#include <QTemporaryDir>
#include <QtQml/qqmlregistration.h>

class AppController : public QObject {
    Q_OBJECT
    QML_ELEMENT
    QML_UNCREATABLE("Created by the C++ application")
    Q_PROPERTY(QVariantMap settings READ settings NOTIFY settingsChanged)
    Q_PROPERTY(QVariantMap settingErrors READ settingErrors NOTIFY settingErrorsChanged)
    Q_PROPERTY(QAbstractItemModel *models READ models CONSTANT)
    Q_PROPERTY(QAbstractItemModel *streamingModels READ streamingModels CONSTANT)
    Q_PROPERTY(QAbstractItemModel *correctionModels READ correctionModels CONSTANT)
    Q_PROPERTY(QAbstractItemModel *punctuationModels READ punctuationModels CONSTANT)
    Q_PROPERTY(QVariantList devices READ devices NOTIFY devicesChanged)
    Q_PROPERTY(QString state READ state NOTIFY changed)
    Q_PROPERTY(QString result READ result NOTIFY changed)
    Q_PROPERTY(QString committedText READ committedText NOTIFY changed)
    Q_PROPERTY(QString liveText READ liveText NOTIFY changed)
    Q_PROPERTY(QString error READ error NOTIFY changed)
    Q_PROPERTY(bool recording READ recording NOTIFY changed)
    Q_PROPERTY(bool captureReady READ captureReady NOTIFY changed)
    Q_PROPERTY(bool sessionActive READ sessionActive NOTIFY changed)
    Q_PROPERTY(bool correctingContext READ correctingContext NOTIFY changed)
    Q_PROPERTY(bool serviceEnabled READ serviceEnabled NOTIFY settingsChanged)
    Q_PROPERTY(double level READ level NOTIFY levelChanged)
    Q_PROPERTY(double testLevel READ testLevel NOTIFY levelChanged)
    Q_PROPERTY(bool testing READ testing NOTIFY changed)
    Q_PROPERTY(QVariantList history READ history NOTIFY historyChanged)
    Q_PROPERTY(QVariantMap dictionary READ dictionary NOTIFY maintenanceChanged)
    Q_PROPERTY(QVariantMap update READ update NOTIFY maintenanceChanged)
    Q_PROPERTY(QVariantMap statistics READ statistics NOTIFY historyChanged)
    Q_PROPERTY(QVariantList changelog READ changelog CONSTANT)
    Q_PROPERTY(QString modelDirectory READ modelDirectory CONSTANT)
    Q_PROPERTY(QString debugDirectory READ debugDirectory CONSTANT)
    Q_PROPERTY(QString debugError READ debugError NOTIFY debugChanged)
    Q_PROPERTY(QString version READ version CONSTANT)
    Q_PROPERTY(bool inputSupported READ inputSupported CONSTANT)
    Q_PROPERTY(QPoint overlayPosition READ overlayPosition NOTIFY changed)
    Q_PROPERTY(QRect overlayArea READ overlayArea NOTIFY changed)
    Q_PROPERTY(QVariantMap resources READ resources NOTIFY resourcesChanged)
    Q_PROPERTY(QAbstractItemModel *resourceProcesses READ resourceProcesses CONSTANT)
  public:
    AppController(QString dataDirectory, QString modelDirectory, bool hooks, bool maintenance = true,
                  QObject *parent = nullptr);
    ~AppController() override;
    QVariantMap settings() const { return m_settings.values().toVariantMap(); }
    QAbstractItemModel *models() { return &m_offlineRows; }
    QAbstractItemModel *streamingModels() { return &m_streamRows; }
    QAbstractItemModel *correctionModels() { return &m_correctionRows; }
    QAbstractItemModel *punctuationModels() { return &m_punctuationRows; }
    QVariantList devices() const { return m_audio.devices(); }
    QString state() const { return m_state; }
    QString result() const;
    QString committedText() const { return m_result; }
    QString liveText() const;
    QString error() const { return m_error; }
    bool recording() const { return m_recording; }
    bool captureReady() const { return m_captureReady; }
    bool recognitionReady() const {
        return m_offline.ready() && (m_settings.values()["modelId"] != "none" || m_stream.ready());
    }
    bool sessionActive() const { return m_session; }
    bool correctingContext() const { return m_finalCorrectionJob != 0; }
    int decodePasses() const { return m_decodePasses; }
    bool punctuatingFinal() const { return m_finalPunctuationJob != 0; }
    int punctuationPasses() const { return m_punctuationPasses; }
    bool serviceEnabled() const { return m_settings.values()["serviceEnabled"].toBool(true); }
    double level() const { return m_level; }
    double testLevel() const { return m_testLevel; }
    bool testing() const { return m_testing; }
    QVariantList history() const { return m_history; }
    QVariantMap dictionary() const { return m_desktop.dictionaryInfo(); }
    QVariantMap update() const { return m_desktop.updateInfo(); }
    QVariantMap statistics() const;
    QVariantList changelog() const;
    QString modelDirectory() const { return m_catalog.root(); }
    QString debugDirectory() const { return m_debug.root(); }
    QString debugError() const { return m_debugError; }
    QString version() const;
    bool inputSupported() const { return m_platform->inputSupported(); }
    QPoint overlayPosition() const { return m_overlayPosition; }
    QRect overlayArea() const { return m_overlayArea; }
    Q_INVOKABLE void setOverlaySize(int width, int height);
    QVariantMap resources() const { return m_resources; }
    QAbstractItemModel *resourceProcesses() { return &m_resourceRows; }
    void transcribeForTest(const QString &path, int rate, int segments = 1, int releaseDelayMs = 0, int packetMs = 0,
                           std::function<bool()> releaseReady = {});
    Q_INVOKABLE void setSetting(const QString &key, const QVariant &value);
    QVariantMap settingErrors() const { return m_settingErrors; }
    Q_INVOKABLE void clearSettingError(const QString &key) { m_settingErrors.remove(key); emit settingErrorsChanged(); }
    Q_INVOKABLE void toggleRecording();
    Q_INVOKABLE void cancelRecording();
    Q_INVOKABLE void toggleMicTest();
    Q_INVOKABLE void copyResult();
    Q_INVOKABLE void copyText(const QString &text);
    Q_INVOKABLE void reloadModel();
    Q_INVOKABLE void selectModel(const QString &role, const QString &id);
    Q_INVOKABLE void deleteModel(const QString &id);
    Q_INVOKABLE void cancelDownload(const QString &id = {});
    Q_INVOKABLE void setServiceEnabled(bool enabled);
    Q_INVOKABLE void openModelDirectory();
    Q_INVOKABLE void openDebugDirectory();
    Q_INVOKABLE void clearHistory();
    Q_INVOKABLE void deleteHistory(int index);
    Q_INVOKABLE QString cleanupPreview(const QString &text) const;
    Q_INVOKABLE void saveWords(const QString &key, const QString &text);
    Q_INVOKABLE void commitInputMethod();
    Q_INVOKABLE void updateDictionary() { m_desktop.updateDictionary(); }
    Q_INVOKABLE void checkUpdates() { m_desktop.checkUpdates(); }
    Q_INVOKABLE void installUpdate() { m_desktop.installUpdate(); }
    Q_INVOKABLE void dismissError() {
        m_error.clear();
        emit changed();
    }
  signals:
    void textOutputRequested(const QString &text, bool final);
    void punctuationRequested(const QString &source);
    void contextCorrectionRequested(const QString &source);
    void segmentRecognized(const QString &raw, const QString &corrected);
    void changed();
    void settingsChanged();
    void settingErrorsChanged();
    void modelsChanged();
    void levelChanged();
    void devicesChanged();
    void historyChanged();
    void maintenanceChanged();
    void resourcesChanged();
    void debugChanged();

  private:
    StartupUpdateGate m_startupGate;
    QVariantMap m_settingErrors;
    struct Job {
        int id = 0, rate = 16000;
        QString path, preview, raw, text;
        bool streamDone = false, streamQueued = false;
        QString stage = "waiting";
    };
    QVariantList modelRows(const QString &group, const QString &key, const WorkerProcess &worker) const;
    void refreshModelRows();
    void configureTriggers();
    QString modelFailure(const QString &role, const QString &detail) const;
    void loadRole(const QString &key);
    void updateState();
    void armIdle();
    bool updateOverlayPosition();
    void start(bool inject);
    void finish();
    void finishCapture();
    void configureCapture();
    void resetTranscript();
    void cutSegment(QVector<float> samples, int rate);
    void frames(const QVector<float> &samples, int rate);
    void feedStream();
    void queueStreamAudio(const QVector<float> &samples);
    void pump();
    void drainJobs();
    void completeSession();
    void insertText(const QString &text, bool final = false);
    void requestPunctuation();
    void finishOutput();
    void endSession();
    void fail(const QString &message);
    void saveHistory();
    void writeHistory();
    void sampleResources();
    void beginDebug(bool fixture = false);
    void debugPreview();
    Settings m_settings;
    SessionDebug m_debug;
    QJsonObject m_debugPreview;
    QMap<QString, QSet<int>> m_debugRequests;
    QString m_debugError;
    qint64 m_segmentOffset = 0;
    ModelCatalog m_catalog;
    ModelManager m_manager;
    ModelRows m_offlineRows, m_streamRows, m_correctionRows, m_punctuationRows;
    ModelRows m_resourceRows;
    AsyncAudioCapture m_audio, m_testAudio;
    AudioSegmenter m_segmenter;
    std::unique_ptr<Platform> m_platform;
    TriggerController m_triggers;
    TextOutput m_output;
    DesktopServices m_desktop;
    WorkerProcess m_offline, m_stream, m_corrector;
    LlmService m_llm;
    QTimer m_idle, m_watchdog, m_tick;
    QElapsedTimer m_recordTime;
    QTemporaryDir m_temp;
    QMap<int, Job> m_jobs;
    QMap<QString, QString> m_pendingSelection;
    QMap<int, QString> m_abandonedAudio;
    QVector<float> m_streamBuffer;
    QString m_state = "loading", m_result, m_partial, m_error, m_raw;
    // Model input and displayed punctuation are separate, immutable snapshots.
    QString m_unpunctuated, m_punctuationSource, m_punctuatedSource;
    QVariantList m_history;
    double m_level = 0, m_testLevel = 0;
    qsizetype m_streamAccepted = 0;
    quintptr m_target = 0;
    QPoint m_overlayPosition;
    QRect m_overlayArea;
    QSize m_overlaySize{420, 92};
    QVariantMap m_resources;
    QElapsedTimer m_uptime, m_resourceTime;
    QMap<qint64, quint64> m_cpuTimes;
    int m_request = 0, m_segment = 0, m_asrJob = 0, m_correctionJob = 0, m_generation = 0, m_segments = 0,
        m_duration = 0, m_lastRolling = 0;
    int m_streamRate = 16000, m_streamReplayJob = 0;
    int m_finalCorrectionJob = 0;
    int m_decodePasses = 0;
    int m_finalPunctuationJob = 0, m_punctuationPasses = 0;
    bool m_finalPunctuationDone = false;
    bool m_finalCorrectionDone = false;
    bool m_waitingOutput = false;
    bool m_captureReady = false;
    bool m_captureStopping = false;
    bool m_allowMicWarmup = false;
    bool m_recording = false, m_testing = false, m_inject = false, m_session = false, m_streamStarted = false,
         m_finishing = false, m_limitPending = false, m_loadingRoles = false;
};
