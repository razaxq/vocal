#pragma once
#include <QJsonObject>
#include <QString>
#include <QList>
QString cleanupSpeech(const QString &input, const QJsonObject &settings);
QString joinSpeechFragments(const QString &left, const QString &right);
QString cleanupSpeechSegments(const QString &input, const QList<QPair<int, int>> &ranges,
                             const QJsonObject &settings);
