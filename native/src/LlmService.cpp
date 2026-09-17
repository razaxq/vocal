#include "LlmService.h"
#include <QJsonArray>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QTimer>

void LlmService::cancel() {
    if (m_reply) {
        auto *reply = m_reply.data();
        m_reply = nullptr;
        reply->abort();
        reply->deleteLater();
    }
}
QString LlmService::guard(const QString &input, QString output) {
    output = output.trimmed();
    const double ratio = double(output.size()) / qMax(1, int(input.size()));
    if (output.isEmpty() || ratio < .4 || ratio > 2.5)
        return input;
    for (const auto &prefix : {"整理后的文本：", "整理后：", "以下是整理后的内容：", "好的，", "Here is", "修改后："})
        if (output.startsWith(QString::fromUtf8(prefix)))
            output = output.mid(QString::fromUtf8(prefix).size()).trimmed();
    auto fence = QRegularExpression("^```[a-z]*\\n([\\s\\S]*?)\\n```$").match(output);
    if (fence.hasMatch())
        output = fence.captured(1).trimmed();
    return output.isEmpty() ? input : output;
}
void LlmService::consolidate(const QString &text, const QJsonObject &settings, int generation) {
    if (busy())
        return;
    if (!settings["llmEnabled"].toBool() || settings["llmApiKey"].toString().isEmpty()) {
        emit completed(generation, text, text);
        return;
    }
    QString base = settings["llmBaseUrl"].toString();
    while (base.endsWith('/'))
        base.chop(1);
    const QUrl url(base + "/chat/completions");
    if (url.scheme() != "https" &&
        !(url.scheme() == "http" && (url.host() == "localhost" || url.host() == "127.0.0.1"))) {
        emit completed(generation, text, text);
        return;
    }
    QNetworkRequest request(url);
    request.setHeader(QNetworkRequest::ContentTypeHeader, "application/json");
    request.setRawHeader("Authorization", "Bearer " + settings["llmApiKey"].toString().toUtf8());
    request.setAttribute(QNetworkRequest::RedirectPolicyAttribute, QNetworkRequest::ManualRedirectPolicy);
    request.setTransferTimeout(settings["llmTimeoutMs"].toInt(8000));
    QJsonArray messages{QJsonObject{{"role", "system"}, {"content", settings["consolidatePrompt"]}},
                        QJsonObject{{"role", "user"}, {"content", text}}};
    m_reply = m_network.post(
        request, QJsonDocument(QJsonObject{{"model", settings["llmModel"]}, {"temperature", 0}, {"messages", messages}})
                     .toJson(QJsonDocument::Compact));
    auto *reply = m_reply.data();
    auto *timer = new QTimer(reply);
    timer->setSingleShot(true);
    connect(timer, &QTimer::timeout, reply, &QNetworkReply::abort);
    timer->start(settings["llmTimeoutMs"].toInt(8000));
    connect(reply, &QNetworkReply::downloadProgress, reply, [reply](qint64 bytes, qint64) {
        if (bytes > 4 * 1024 * 1024)
            reply->abort();
    });
    connect(reply, &QNetworkReply::finished, this, [this, reply, text, generation] {
        if (m_reply != reply)
            return;
        m_reply = nullptr;
        QString result = text;
        if (reply->error() == QNetworkReply::NoError) {
            const auto data = QJsonDocument::fromJson(reply->readAll()).object();
            const auto choices = data["choices"].toArray();
            if (!choices.isEmpty())
                result = guard(text, choices.first().toObject()["message"].toObject()["content"].toString());
        }
        reply->deleteLater();
        emit completed(generation, text, result);
    });
}
