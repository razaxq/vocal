#include "TextCleanup.h"
#include <QJsonArray>
#include <QRegularExpression>
#include <algorithm>

QString cleanupSpeech(const QString &input, const QJsonObject &settings) {
    const auto level = settings["cleanupLevel"].toString("standard");
    if (level == "off" || input.trimmed().isEmpty())
        return input;
    QString text = input;
    QStringList words;
    if (settings["protectHotwords"].toBool(true))
        for (auto word : settings["hotwords"].toArray())
            words.append(word.toString().trimmed());
    std::sort(words.begin(), words.end(), [](const auto &a, const auto &b) { return a.size() > b.size(); });
    QList<QPair<QString, QString>> protectedWords;
    for (const auto &word : words) {
        if (word.isEmpty())
            continue;
        const QString token = QChar(0xe000) + QString::number(protectedWords.size()) + QChar(0xe000);
        protectedWords.append({token, word});
        text.replace(word, token);
    }
    auto replace = [&](const QString &pattern, const QString &replacement, bool insensitive = false) {
        text.replace(QRegularExpression(pattern, insensitive ? QRegularExpression::CaseInsensitiveOption
                                                             : QRegularExpression::NoPatternOption),
                     replacement);
    };
    const QString pause = QString::fromUtf8("，。！？；：、,.!?;:");
    const QString p = QRegularExpression::escape(pause);
    replace("([一-龥])\\1{2,}", "\\1");
    replace("([一-龥]{2})\\1{2,}", "\\1");
    replace("\\b(\\w+)(\\s+\\1\\b)+", "\\1", true);
    replace("(^|[" + p + "\\s])(?:嗯|呃|唔|额|诶|欸|哎|啊|哦|喔|噢)+[" + p + "\\s]*", "\\1");
    replace("(?:嗯|呃|唔|额|诶|欸|哎|啊|哦|喔|噢)+$", "");
    if (level != "light") {
        replace("\\b(?:um|uh|erm|er|hmm|mmm)\\b[,\\s]*", "", true);
        QStringList fillers{"那个",     "这个",     "就是说",   "就是讲", "然后呢",   "对吧",   "对不对",  "你知道吧",
                            "你知道吗", "怎么说呢", "我跟你讲", "说白了", "you know", "i mean", "sort of", "kind of"};
        for (auto item : settings["extraFillers"].toArray())
            fillers.append(item.toString());
        for (const auto &filler : fillers) {
            if (filler.trimmed().isEmpty())
                continue;
            const auto f = QRegularExpression::escape(filler.trimmed());
            replace("(^|[" + p + "])\\s*" + f + "\\s*[" + p + "]\\s*", "\\1", true);
            replace("[" + p + "]\\s*" + f + "\\s*(?=[" + p + "])", "", true);
        }
    }
    replace("([" + p + "])\\s*(?=[" + p + "])", "");
    replace("\\s{2,}", " ");
    replace("([一-龥])([A-Za-z0-9])", "\\1 \\2");
    replace("([A-Za-z0-9])([一-龥])", "\\1 \\2");
    replace("\\s+([，。！？；：、])", "\\1");
    text = text.trimmed();
    for (const auto &pair : protectedWords)
        text.replace(pair.first, pair.second);
    return text;
}
