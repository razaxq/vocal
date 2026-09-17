#include "Dictionary.h"
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QSet>

QVariantMap Dictionary::inspect(const QString &path) {
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly) || file.size() > 64 * 1024 * 1024)
        return {};
    auto json = QJsonDocument::fromJson(file.readAll()).object();
    if (json.contains("catalog"))
        json = json["catalog"].toObject();
    const auto words = json["words"].toArray(), readings = json["readings"].toArray();
    if (words.isEmpty() || words.size() != readings.size() || json["version"].toInt() != 3)
        return {};
    for (int i = 0; i < words.size(); ++i)
        if (words[i].toString().isEmpty() || readings[i].toString().isEmpty())
            return {};
    json.remove("words");
    json.remove("readings");
    json["count"] = words.size();
    return json.toVariantMap();
}

bool Dictionary::load(const QString &path) {
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly) || file.size() > 64 * 1024 * 1024)
        return false;
    auto json = QJsonDocument::fromJson(file.readAll()).object();
    if (json.contains("catalog"))
        json = json["catalog"].toObject();
    const auto words = json["words"].toArray(), readings = json["readings"].toArray();
    if (words.isEmpty() || words.size() != readings.size() || !json["version"].isDouble())
        return false;
    m_words.clear();
    m_readings.clear();
    m_byReading.clear();
    m_characters.clear();
    for (int i = 0; i < words.size(); ++i) {
        const auto word = words[i].toString(), raw = readings[i].toString();
        if (word.isEmpty() || raw.isEmpty())
            return false;
        m_words.append(word);
        m_readings.insert(word, raw.section('|', 0, 0));
        for (const auto &reading : raw.split('|'))
            m_byReading[reading].append(i);
        const auto parts = raw.section('|', 0, 0).split(' ');
        if (parts.size() == word.size())
            for (int at = 0; at < word.size(); ++at)
                if (!m_characters.contains(word[at]))
                    m_characters[word[at]] = parts[at];
    }
    m_metadata = json;
    m_metadata.remove("words");
    m_metadata.remove("readings");
    return true;
}
QString Dictionary::reading(const QString &text) const {
    if (m_readings.contains(text))
        return m_readings[text];
    QStringList parts;
    for (int at = 0; at < text.size();) {
        bool found = false;
        for (int length = qMin(8, int(text.size()) - at); length >= 2; --length) {
            const auto word = text.mid(at, length);
            if (m_readings.contains(word)) {
                parts.append(m_readings[word]);
                at += length;
                found = true;
                break;
            }
        }
        if (!found) {
            parts.append(m_characters.value(text[at], QString(text[at])));
            ++at;
        }
    }
    return parts.join(' ');
}
bool Dictionary::similarSound(const QString &a, const QString &b) const {
    static const QRegularExpression han("^[\\p{Han}]+$");
    if (a.size() != b.size() || !han.match(a).hasMatch() || !han.match(b).hasMatch())
        return false;
    auto normalize = [](QString value) {
        value.replace(QRegularExpression("ng(?= |$)"), "n");
        return value;
    };
    return normalize(reading(a)) == normalize(reading(b));
}
QStringList Dictionary::homophones(const QString &word) const {
    QStringList result;
    for (int id : m_byReading.value(reading(word))) {
        if (m_words[id] != word && m_words[id].size() == word.size())
            result.append(m_words[id]);
        if (result.size() >= 16)
            break;
    }
    return result;
}
QStringList Dictionary::retrieve(const QString &text, int limit) const {
    QSet<int> seen;
    QList<QPair<int, int>> candidates;
    auto runs = QRegularExpression("[\\p{Han}]+").globalMatch(text.left(512));
    while (runs.hasNext()) {
        const auto syllables = reading(runs.next().captured()).split(' ');
        for (int at = 0; at < syllables.size(); ++at)
            for (int length = qMin(8, int(syllables.size()) - at); length >= 2; --length) {
                const auto ids = m_byReading.value(syllables.mid(at, length).join(' '));
                for (int j = 0; j < qMin(8, int(ids.size())); ++j)
                    if (!seen.contains(ids[j])) {
                        seen.insert(ids[j]);
                        candidates.append({length, ids[j]});
                    }
            }
    }
    std::sort(candidates.begin(), candidates.end(),
              [](auto a, auto b) { return a.first != b.first ? a.first > b.first : a.second < b.second; });
    QStringList result;
    for (auto item : candidates.first(qMin(qBound(0, limit, 64), int(candidates.size()))))
        result.append(m_words[item.second]);
    return result;
}
