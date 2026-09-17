#pragma once
#include <QJsonObject>
#include <QString>
QString cleanupSpeech(const QString &input, const QJsonObject &settings);
QString joinSpeechFragments(const QString &left, const QString &right);
