#include "WorkerProcess.h"
#include <QCoreApplication>
#include <QJsonDocument>

WorkerProcess::WorkerProcess(QObject *parent) : QObject(parent) {
    m_startup.setSingleShot(true);
    connect(&m_startup, &QTimer::timeout, this, [this] {
        stop();
        error("模型加载超时，请重试");
    });
    connect(&m_process, &QProcess::readyReadStandardError, this,
            [this] { m_stderr = (m_stderr + m_process.readAllStandardError()).right(4096); });
    connect(&m_process, &QProcess::readyReadStandardOutput, this, [this] {
        m_buffer += m_process.readAllStandardOutput();
        if (m_buffer.size() > 8 * 1024 * 1024) {
            stop();
            error("识别进程响应过大");
            return;
        }
        while (m_buffer.contains('\n')) {
            const auto at = m_buffer.indexOf('\n');
            const auto message = QJsonDocument::fromJson(m_buffer.left(at)).object();
            m_buffer.remove(0, at + 1);
            if (message["type"] == "ready") {
                m_ready = true;
                m_state = "ready";
                m_startup.stop();
                emit stateChanged();
            } else if (message["type"] == "error") {
                error(message["message"].toString());
            }
            emit event(message);
        }
    });
    connect(&m_process, &QProcess::errorOccurred, this, [this](QProcess::ProcessError) {
        if (!m_stopping)
            error("识别进程启动或运行失败：" + m_process.errorString());
    });
    connect(&m_process, &QProcess::finished, this, [this](int, QProcess::ExitStatus) {
        if (!m_stopping && m_state != "error")
            error("识别进程已退出，请重新加载模型");
    });
}
WorkerProcess::~WorkerProcess() {
    stop();
}
void WorkerProcess::start(const QStringList &arguments) {
    stop();
    m_state = "loading";
    emit stateChanged();
    m_process.start(QCoreApplication::applicationFilePath(), arguments);
    m_startup.start(90000);
}
void WorkerProcess::stop() {
    m_stopping = true;
    m_startup.stop();
    if (m_process.state() != QProcess::NotRunning) {
        m_process.kill();
        m_process.waitForFinished(3000);
    }
    m_ready = false;
    m_state = "unloaded";
    m_buffer.clear();
    m_stderr.clear();
    m_stopping = false;
    emit stateChanged();
}
bool WorkerProcess::send(const QJsonObject &message) {
    if (!m_ready || m_process.bytesToWrite() > 16 * 1024 * 1024)
        return false;
    const bool sent = m_process.write(QJsonDocument(message).toJson(QJsonDocument::Compact) + '\n') >= 0;
    if (sent) emit requestSent(message);
    return sent;
}
void WorkerProcess::error(const QString &message) {
    m_startup.stop();
    m_ready = false;
    m_state = "error";
    emit stateChanged();
    emit failed(message);
}
