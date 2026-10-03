#include "AppController.h"
#include <QFile>
#include <QJsonDocument>
#include <QSignalSpy>
#include <QTemporaryDir>
#include <QtTest>
#ifdef Q_OS_WIN
#include <windows.h>
#endif

class ControllerTests : public QObject {
    Q_OBJECT
  private slots:
    void failedHistoryDeletionPreservesRowsAndNotifies_data() {
        QTest::addColumn<bool>("clearAll");
        QTest::newRow("single") << false;
        QTest::newRow("all") << true;
    }
    void failedHistoryDeletionPreservesRowsAndNotifies() {
        QFETCH(bool, clearAll);
        QTemporaryDir temp;
        QFile settings(temp.filePath("settings.json"));
        QVERIFY(settings.open(QIODevice::WriteOnly));
        settings.write("{\"serviceEnabled\":false}");
        settings.close();
        const auto path = temp.filePath("history.jsonl");
        const QByteArray original = "{\"text\":\"first\"}\n{\"text\":\"second\"}\n";
        QFile file(path);
        QVERIFY(file.open(QIODevice::WriteOnly));
        QCOMPARE(file.write(original), original.size());
        file.close();
        AppController controller(temp.path(), temp.filePath("models"), false, false);
        QCOMPARE(controller.history().size(), 2);
        QSignalSpy changed(&controller, &AppController::changed);
        QSignalSpy historyChanged(&controller, &AppController::historyChanged);
        // Reproduce a real commit failure without touching user data.
#ifdef Q_OS_WIN
        const auto handle = CreateFileW(reinterpret_cast<LPCWSTR>(path.utf16()), GENERIC_READ,
            FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
        QVERIFY(handle != INVALID_HANDLE_VALUE);
#else
        QVERIFY(QFile::rename(path, path + ".backup"));
        QVERIFY(QDir().mkdir(path));
#endif
        if (clearAll) controller.clearHistory();
        else controller.deleteHistory(0);
#ifdef Q_OS_WIN
        CloseHandle(handle);
#else
        QVERIFY(QDir().rmdir(path));
        QVERIFY(QFile::rename(path + ".backup", path));
#endif
        QCOMPARE(controller.history().size(), 2);
        QCOMPARE(historyChanged.size(), 0);
        QVERIFY(!controller.error().isEmpty());
        QCOMPARE(changed.size(), 1);
        QVERIFY(file.open(QIODevice::ReadOnly));
        QCOMPARE(file.readAll(), original);
        file.close();
        {
            AppController reopened(temp.path(), temp.filePath("models"), false, false);
            QCOMPARE(reopened.history(), controller.history());
        }
        if (clearAll) controller.clearHistory();
        else controller.deleteHistory(0);
        QVERIFY(controller.error().isEmpty());
        QCOMPARE(controller.history().size(), clearAll ? 0 : 1);
        QCOMPARE(historyChanged.size(), 1);
        AppController reopened(temp.path(), temp.filePath("models"), false, false);
        QCOMPARE(reopened.history(), controller.history());
        if (!clearAll) QCOMPARE(reopened.history()[0].toMap()["text"].toString(), QString("first"));
    }
};
QTEST_MAIN(ControllerTests)
#include "ControllerTests.moc"
