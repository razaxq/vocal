#include "SentenceCorrection.h"
#include <QRegularExpression>
#include <QVector>
#include <numeric>

QStringList sentenceCorrectionChunks(const QString &text, int maximum) {
    QStringList chunks;
    maximum = qMax(2, maximum);
    for (int at = 0; at < text.size();) {
        int end = qMin(at + maximum, int(text.size()));
        if (end < text.size()) {
            for (int i = end - 1; i >= at + maximum / 2; --i) {
                if (QStringView(u"。！？!?；;，,\n").contains(text[i])) { end = i + 1; break; }
            }
            if (text[end - 1].isHighSurrogate()) --end;
        }
        chunks.append(text.mid(at, end - at));
        at = end;
    }
    return chunks;
}

QString sentenceCorrectionCandidate(const QString &source, const QString &generated) {
    QString result = generated.trimmed();
    // External punctuation is applied once to the cumulative raw transcript.
    // Do not turn an unpunctuated source into repeatedly punctuated input.
    const QString punctuation = QStringLiteral("，。！？；：、");
    for (auto ch : punctuation)
        if (!source.contains(ch)) result.remove(ch);
    return result;
}

QString sentenceCorrectionProtectedRejection(const QString &source, const QString &target, const QStringList &hotwords) {
    // Compare protected runs in order, allowing insertion/deletion of ordinary
    // characters around them. Include candidate-side additions, not just removals.
    const QRegularExpression protectedPattern(
        "`[^`]*`|https?://\\S+|[\\w.+-]+@[\\w.-]+\\.[\\w.-]+|"
        "[+-]?[0-9]+(?:[.,][0-9]+)*(?:%|％)?|[A-Za-z0-9_][A-Za-z0-9_.:+/#@-]*|[零〇一二三四五六七八九十百千万亿两]+|[他她它牠祂]");
    auto protectedRuns = [&](const QString &text) {
        QStringList runs;
        auto matches = protectedPattern.globalMatch(text);
        while (matches.hasNext()) runs.append(matches.next().captured());
        return runs;
    };
    if (protectedRuns(source) != protectedRuns(target)) return "protected-text";
    for (const auto &word : hotwords)
        if (!word.isEmpty() && source.count(word) != target.count(word)) return "hotword";
    return {};
}

QString sentenceCorrectionRejection(const QString &source, const QString &target, const QStringList &hotwords) {
    if (source == target) return {};
    if (target.isEmpty()) return "empty";
    if (source.size() > 1000 || target.size() > source.size() + qMax(8, int(source.size() / 4))) return "length";
    if (target.contains(QChar::ReplacementCharacter) || target.contains("<|") || target.contains("<think") ||
        target.contains("</think") || target.contains("```")) return "format";
    const auto protectedReason = sentenceCorrectionProtectedRejection(source, target, hotwords);
    if (!protectedReason.isEmpty()) return protectedReason;
    // Refuse broad rewrites or instruction-following responses. Unlike the CSC
    // guard, edit distance supports genuine missing/redundant word correction.
    QVector<int> row(target.size() + 1), next(row.size());
    std::iota(row.begin(), row.end(), 0);
    for (int i = 0; i < source.size(); ++i) {
        next[0] = i + 1;
        for (int j = 0; j < target.size(); ++j)
            next[j + 1] = qMin(qMin(next[j] + 1, row[j + 1] + 1), row[j] + (source[i] != target[j]));
        row.swap(next);
    }
    if (row.back() > qMax(3, int(source.size() / 5))) return "rewrite";
    return {};
}
