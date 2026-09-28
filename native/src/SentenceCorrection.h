#pragma once
#include <QStringList>

// Keep generation bounded. Long transcripts are corrected in sentence/clause
// windows; the worker never silently truncates the transcript to its context.
QStringList sentenceCorrectionChunks(const QString &text, int maximum = 240);
QString sentenceCorrectionCandidate(const QString &source, const QString &generated);
QString sentenceCorrectionProtectedRejection(const QString &source, const QString &target, const QStringList &hotwords);
QString sentenceCorrectionRejection(const QString &source, const QString &target, const QStringList &hotwords);
