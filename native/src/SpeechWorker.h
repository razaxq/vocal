#pragma once
#include <QStringList>

// This entrypoint runs in a separate native process, without a QML engine,
// microphone, global hooks, or access to the user's text input target.
int runSpeechWorker(const QStringList &arguments);
