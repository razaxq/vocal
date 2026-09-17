#include "TextOutput.h"
#include <QClipboard>
#include <QGuiApplication>
#include <QJsonArray>
#include <QMimeData>
#include <QScopeGuard>
#include <QTimer>
#include <QTextBoundaryFinder>

TextOutput::TextOutput(Platform *platform, QObject *parent) : QObject(parent), m_platform(platform) {
    connect(QGuiApplication::clipboard(), &QClipboard::dataChanged, this, [this] { ++m_clipboardRevision; });
    m_restoreClipboardTimer.setSingleShot(true);
    m_restoreClipboardTimer.setInterval(200);
    connect(&m_restoreClipboardTimer, &QTimer::timeout, this, &TextOutput::restoreClipboard);
    m_settleTimer.setInterval(40);
    connect(&m_settleTimer, &QTimer::timeout, this, &TextOutput::settle);
}
void TextOutput::restoreClipboard() {
    if (m_clipboardBackup && m_clipboardRevision == m_ownedClipboardRevision)
        QGuiApplication::clipboard()->setMimeData(m_clipboardBackup.release());
    m_clipboardBackup.reset();
}
void TextOutput::begin(quintptr target) {
    m_hasQueued = false;
    if (m_waiting) {
        // Do not change the clipboard/target underneath an outstanding paste.
        m_beginQueued = true;
        m_nextTarget = target;
        return;
    }
    m_target = target;
    m_inserted.clear();
}
void TextOutput::settle() {
    if (!m_waiting) return;
    const bool focused = m_platform->target() == m_target;
    const int applied = focused ? m_platform->textInputApplied(m_target, m_pendingText) : 0;
    if (focused && (applied == 1 || (applied < 0 && m_pendingTime.elapsed() >= 300))) {
        m_inserted = m_pendingText;
        finishPending();
        return;
    }
    if (!focused || m_pendingTime.elapsed() >= 2000) {
        const bool superseded = m_beginQueued;
        if (!superseded) m_hasQueued = false;
        m_target = 0;
        finishPending();
        if (!superseded) emit failed("未能确认文字输入，结果已保留，可从历史中复制");
    }
}
void TextOutput::finishPending() {
    m_waiting = false;
    m_settleTimer.stop();
    m_restoreClipboardTimer.stop();
    restoreClipboard();
    if (m_beginQueued) {
        m_beginQueued = false;
        m_target = m_nextTarget;
        m_inserted.clear();
    }
    if (m_hasQueued) {
        m_hasQueued = false;
        QString error;
        if (!apply(m_queuedText, m_queuedSettings, m_queuedLimit, &error)) emit failed(error);
    }
    if (!m_waiting) emit idle();
}
bool TextOutput::paste(const QString &text, bool restore, QString *error) {
    auto *clipboard = QGuiApplication::clipboard();
    // Rapid partial/final pastes share the original clipboard backup. Never
    // accidentally restore a previous Vocal preview instead of the user's copy.
    if (restore && (!m_clipboardBackup || m_clipboardRevision != m_ownedClipboardRevision)) {
        m_clipboardBackup = std::make_unique<QMimeData>();
        if (const auto *old = clipboard->mimeData())
            for (const auto &format : old->formats())
                m_clipboardBackup->setData(format, old->data(format));
    }
    m_restoreClipboardTimer.stop();
    clipboard->setText(text);
    m_ownedClipboardRevision = m_clipboardRevision;
    const bool sent = m_platform->paste(m_target, error);
    if (restore && sent)
        m_restoreClipboardTimer.start();
    else
        m_clipboardBackup.reset();
    return sent;
}
bool TextOutput::update(const QString &text, const QJsonObject &settings, int replaceLimit, QString *error) {
    if (m_waiting) {
        // Last update wins; the final transcript supersedes all unsent previews.
        m_hasQueued = true;
        m_queuedText = text;
        m_queuedSettings = settings;
        m_queuedLimit = replaceLimit;
        return true;
    }
    return apply(text, settings, replaceLimit, error);
}
bool TextOutput::apply(const QString &text, const QJsonObject &settings, int replaceLimit, QString *error) {
    if (text == m_inserted)
        return true;
    if (!m_target || m_platform->target() != m_target) {
        m_target = 0;
        *error = "焦点已变化，结果已保留，可从历史中复制";
        return false;
    }
    if (!m_platform->beginTextInput(m_target, settings["triggerOwned"].toBool(), error))
        return false;
    const auto restoreKeys = qScopeGuard([this] { m_platform->endTextInput(); });
    int common = 0;
    while (common < text.size() && common < m_inserted.size() && text[common] == m_inserted[common])
        ++common;
    QTextBoundaryFinder oldBoundary(QTextBoundaryFinder::Grapheme, m_inserted);
    QTextBoundaryFinder newBoundary(QTextBoundaryFinder::Grapheme, text);
    while (common > 0) {
        oldBoundary.setPosition(common);
        newBoundary.setPosition(common);
        if (oldBoundary.isAtBoundary() && newBoundary.isAtBoundary()) break;
        --common;
    }
    const int remove = m_inserted.mid(common).toUcs4().size();
    if (remove > replaceLimit) {
        *error = "超出自动替换上限，整理结果已保留";
        return false;
    }
    if (remove && !m_platform->selectPreviousText(m_target, m_inserted.mid(common), error)) {
        m_target = 0; // A failed/partial selection must never be retried blindly.
        m_restoreClipboardTimer.stop();
        m_clipboardBackup.reset();
        QGuiApplication::clipboard()->setText(text);
        return false;
    }
    const auto tail = text.mid(common);
    if (tail.isEmpty()) {
        if (remove && !m_platform->erase(m_target, 1, error)) {
            m_target = 0;
            return false;
        }
        trackInput(text);
        return true;
    }
    auto strategy = settings["injectionStrategy"].toString("auto");
    bool viaPaste = strategy == "clipboard";
    if (strategy == "auto") {
        viaPaste = qMax(tail.size(), qsizetype(remove)) > settings["clipboardThreshold"].toInt(80);
        const auto process = m_platform->targetProcess(m_target).toUpper();
        for (auto entry : settings["clipboardOnlyApps"].toArray())
            if (entry.toString().toUpper() == process)
                viaPaste = true;
    }
    bool ok = viaPaste ? paste(tail, settings["restoreClipboard"].toBool(true), error)
                       : m_platform->inject(m_target, tail, error);
    if (ok) {
        trackInput(text);
    } else {
        m_target = 0;
        m_restoreClipboardTimer.stop();
        m_clipboardBackup.reset();
        QGuiApplication::clipboard()->setText(text);
    }
    return ok;
}

void TextOutput::trackInput(const QString &text) {
    if (m_platform->textInputApplied(m_target, text) == 1) {
        m_inserted = text;
    } else {
        m_pendingText = text;
        m_waiting = true;
        m_pendingTime.start();
        m_restoreClipboardTimer.stop();
        m_settleTimer.start();
    }
}
