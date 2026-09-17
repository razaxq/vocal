#pragma once
#include <QStringView>

inline bool isHanCharacterEdit(QStringView source, QStringView target) {
    return source.size() == 1 && target.size() == 1 &&
           source.front().script() == QChar::Script_Han && target.front().script() == QChar::Script_Han;
}

// A language-model preference is not evidence for introducing or changing a
// number. Apply the existing source-number protection to proposed edits too.
inline bool preservesNumericCharacters(QStringView source, QStringView target) {
    if (source.size() != target.size())
        return false;
    constexpr auto numerals = u"零〇一二三四五六七八九十百千万亿两";
    const auto numeric = [&](QChar ch) { return ch.isDigit() || QStringView(numerals).contains(ch); };
    for (qsizetype i = 0; i < source.size(); ++i)
        if (source[i] != target[i] && (numeric(source[i]) || numeric(target[i])))
            return false;
    return true;
}
