#pragma once
#include "Platform.h"
#include "TextOutput.h"
#include <QApplication>
#include <QClipboard>
#include <QElapsedTimer>
#include <QJsonDocument>
#include <QJsonObject>
#include <QProcess>
#include <QScopeGuard>
#include <QTextEdit>
#include <QTimer>
#include <QTest>
#include <iostream>
#include <windows.h>

namespace ReplacementProbe {
inline QString prefix() { return "已有内容（保留）\n"; }
inline QString suffix() { return "\n后面的内容（保留）"; }
inline QString original() { return QString("旧的识别内容重复测试 ").repeated(80) + "\né👩‍💻 旧结尾"; }
inline QString revised() { return QString("整理后的完整内容 ").repeated(75) + "\nè👩‍🔬 新结尾"; }
inline QString normalize(QString text) { return text.replace("\r\n", "\n").replace('\r', '\n'); }
inline void report(const QJsonObject &object) {
    std::cout << QJsonDocument(object).toJson(QJsonDocument::Compact).constData() << std::endl;
}
inline int fixture(QApplication &app, bool native, bool moved) {
    QTextEdit field;
    field.setWindowTitle("Vocal temporary replacement test");
    field.resize(600, 240);
    HWND edit = nullptr;
    if (native) {
        field.setReadOnly(true);
        edit = CreateWindowExW(0, L"EDIT", L"", WS_CHILD | WS_VISIBLE | WS_VSCROLL | ES_MULTILINE | ES_AUTOVSCROLL,
                               0, 0, 580, 220, reinterpret_cast<HWND>(field.winId()), nullptr, GetModuleHandleW(nullptr), nullptr);
        const auto initial = (prefix() + suffix()).replace("\n", "\r\n").toStdWString();
        SetWindowTextW(edit, initial.c_str());
        const int at = QString(prefix()).replace("\n", "\r\n").size();
        SendMessageW(edit, EM_SETSEL, at, at);
    } else {
        field.setPlainText(prefix() + suffix());
        auto cursor = field.textCursor(); cursor.setPosition(prefix().size()); field.setTextCursor(cursor);
    }
    auto text = [&] {
        if (!native) return field.toPlainText();
        std::wstring buffer(GetWindowTextLengthW(edit) + 1, L'\0');
        const int size = GetWindowTextW(edit, buffer.data(), int(buffer.size()));
        return normalize(QString::fromWCharArray(buffer.data(), size));
    };
    field.show();
    field.activateWindow();
    if (native) SetFocus(edit); else field.setFocus();
    QTimer::singleShot(200, &app, [&] {
        field.activateWindow();
        if (native) SetFocus(edit); else field.setFocus();
        report({{"window", QString::number(quintptr(field.winId()))}});
    });
    QString last;
    QTimer poll;
    poll.setInterval(10);
    QObject::connect(&poll, &QTimer::timeout, &app, [&] {
        const auto value = text();
        if (value == last) return;
        last = value;
        const bool oldMatches = value == prefix() + original() + suffix();
        if (oldMatches && moved) {
            if (native) SendMessageW(edit, EM_SETSEL, 3, 3);
            else { auto cursor = field.textCursor(); cursor.setPosition(3); field.setTextCursor(cursor); }
        }
        report({{"oldMatches", oldMatches}, {"newMatches", value == prefix() + revised() + suffix()},
                {"prefixIntact", value.startsWith(prefix())}, {"suffixIntact", value.endsWith(suffix())},
                {"characters", value.size()}});
    });
    poll.start();
    QTimer::singleShot(15000, &app, &QApplication::quit);
    return app.exec();
}
inline int run(QApplication &app, const QString &kind, bool moved) {
    auto *clipboard = QGuiApplication::clipboard();
    auto previousClipboard = std::make_unique<QMimeData>();
    if (const auto *old = clipboard->mimeData())
        for (const auto &format : old->formats()) previousClipboard->setData(format, old->data(format));
    const auto restoreUserClipboard = qScopeGuard([&] {
        const auto current = clipboard->text();
        if (current == "Vocal probe clipboard sentinel" || current == original() || current == revised())
            clipboard->setMimeData(previousClipboard.release());
    });
    QProcess child;
    QStringList args{"--replacement-fixture", kind};
    if (moved) args.append("--replacement-moved");
    child.start(app.applicationFilePath(), args);
    if (!child.waitForStarted(3000)) return 1;
    QByteArray pending;
    auto await = [&](const QString &key, int timeout) {
        QElapsedTimer deadline; deadline.start();
        while (deadline.elapsed() < timeout) {
            pending += child.readAllStandardOutput();
            while (pending.contains('\n')) {
                const int end = pending.indexOf('\n');
                const auto row = QJsonDocument::fromJson(pending.left(end)).object();
                pending.remove(0, end + 1);
                if (row.contains(key) && (row[key].isString() || row[key].toBool())) return row;
            }
            QTest::qWait(10);
        }
        return QJsonObject{};
    };
    const auto first = await("window", 4000);
    const auto window = first["window"].toString().toULongLong();
    auto platform = createPlatform();
    const auto hwnd = reinterpret_cast<HWND>(window);
    const DWORD foregroundThread = GetWindowThreadProcessId(GetForegroundWindow(), nullptr);
    const bool attached = foregroundThread != GetCurrentThreadId() && AttachThreadInput(GetCurrentThreadId(), foregroundThread, TRUE);
    BOOL activated = FALSE;
    if (hwnd) { ShowWindow(hwnd, SW_SHOW); activated = SetForegroundWindow(hwnd); }
    if (attached) AttachThreadInput(GetCurrentThreadId(), foregroundThread, FALSE);
    for (int i = 0; i < 30 && platform->target() != window; ++i) QTest::qWait(10);
    TextOutput output(platform.get());
    QString error;
    QGuiApplication::clipboard()->setText("Vocal probe clipboard sentinel");
    QJsonObject config{{"injectionStrategy", "auto"}, {"restoreClipboard", true}};
    output.begin(window);
    const bool initial = window && output.update(original(), config, 1500, &error) && !await("oldMatches", 3000).isEmpty();
    QElapsedTimer timer; timer.start();
    const bool replaced = initial && output.update(revised(), config, 1500, &error);
    const auto result = replaced ? await("newMatches", 3000) : QJsonObject{};
    const double ms = timer.nsecsElapsed() / 1.e6;
    QTest::qWait(250);
    const bool restored = QGuiApplication::clipboard()->text() == "Vocal probe clipboard sentinel";
    report({{"kind", kind}, {"movedCaret", moved}, {"initialInserted", initial}, {"replaced", replaced},
            {"exactReplacement", !result.isEmpty()}, {"selectionMethod", platform->property("replacementSelectionMethod").toString()},
            {"elapsedMs", ms}, {"clipboardRestored", restored}, {"oldCharacters", original().size()},
            {"newCharacters", revised().size()}, {"error", error}});
    if (!initial) report({{"activationAccepted", bool(activated)}, {"target", QString::number(window)},
                         {"foreground", QString::number(platform->target())}, {"fixtureVisible", bool(IsWindowVisible(hwnd))},
                         {"fixtureExit", child.exitCode()}, {"stderr", QString::fromUtf8(child.readAllStandardError()).right(1200)}});
    child.kill(); child.waitForFinished();
    return initial && (moved ? !replaced : !result.isEmpty() && restored) ? 0 : 2;
}
}
