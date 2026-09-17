#pragma once
#include <QDir>
#include <QProcess>

inline void configureNativeUpdate(QProcess &installer, const QString &path, qint64 parentPid,
                                  const QString &directory) {
    installer.setProgram(path);
    installer.setArguments({"/S", "/APPUPDATE", "/WAITPID=" + QString::number(parentPid)});
#ifdef Q_OS_WIN
    // NSIS requires /D last and unquoted, including when the directory has spaces.
    installer.setNativeArguments("/D=" + QDir::toNativeSeparators(directory));
#else
    Q_UNUSED(directory);
#endif
}
