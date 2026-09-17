#include "TextOutput.h"
#include <QClipboard>
#include <QGuiApplication>
#include <QJsonArray>
#include <QMimeData>
#include <QScopeGuard>
#include <QTimer>

TextOutput::TextOutput(Platform *platform, QObject *parent) : QObject(parent), m_platform(platform) {
    connect(QGuiApplication::clipboard(), &QClipboard::dataChanged, this, [this] { ++m_clipboardRevision; });
}
void TextOutput::begin(quintptr target) {
    m_target = target;
    m_inserted.clear();
}
bool TextOutput::paste(const QString &text, bool restore, QString *error) {
    auto *clipboard = QGuiApplication::clipboard();
    auto backup = std::make_unique<QMimeData>();
    if (const auto *old = clipboard->mimeData())
        for (const auto &format : old->formats())
            backup->setData(format, old->data(format));
    clipboard->setText(text);
    const auto revision = m_clipboardRevision;
    const bool sent = m_platform->paste(m_target, error);
    if (restore && sent)
        QTimer::singleShot(200, this, [this, backup = std::move(backup), revision]() mutable {
            if (m_clipboardRevision == revision)
                QGuiApplication::clipboard()->setMimeData(backup.release());
        });
    return sent;
}
bool TextOutput::update(const QString &text, const QJsonObject &settings, int replaceLimit, QString *error) {
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
    if (common > 0 && common < text.size() && text[common].isLowSurrogate())
        --common;
    const int remove = m_inserted.mid(common).toUcs4().size();
    if (remove > replaceLimit) {
        *error = "超出自动替换上限，整理结果已保留";
        return false;
    }
    if (remove && !m_platform->erase(m_target, remove, error))
        return false;
    if (remove)
        m_inserted.truncate(common);
    const auto tail = text.mid(common);
    if (tail.isEmpty()) {
        m_inserted = text;
        return true;
    }
    auto strategy = settings["injectionStrategy"].toString("auto");
    bool viaPaste = strategy == "clipboard";
    if (strategy == "auto") {
        viaPaste = tail.size() > settings["clipboardThreshold"].toInt(80);
        const auto process = m_platform->targetProcess(m_target).toUpper();
        for (auto entry : settings["clipboardOnlyApps"].toArray())
            if (entry.toString().toUpper() == process)
                viaPaste = true;
    }
    if (remove)
        viaPaste = false;
    bool ok = viaPaste ? paste(tail, settings["restoreClipboard"].toBool(true), error)
                       : m_platform->inject(m_target, tail, error);
    if (ok)
        m_inserted = text;
    else {
        m_target = 0;
        QGuiApplication::clipboard()->setText(text);
    }
    return ok;
}
