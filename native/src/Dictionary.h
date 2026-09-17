#pragma once
#include <QHash>
#include <QJsonObject>
#include <QStringList>

class Dictionary {
  public:
    bool load(const QString &path);
    static QVariantMap inspect(const QString &path);
    QString reading(const QString &text) const;
    bool similarSound(const QString &a, const QString &b) const;
    QStringList homophones(const QString &word) const;
    QStringList retrieve(const QString &text, int limit = 64) const;
    bool contains(const QString &word) const { return m_readings.contains(word); }
    QJsonObject metadata() const { return m_metadata; }
    int size() const { return m_words.size(); }

  private:
    QStringList m_words;
    QHash<QString, QString> m_readings;
    QHash<QString, QVector<int>> m_byReading;
    QHash<QChar, QString> m_characters;
    QJsonObject m_metadata;
};
