#include "WindowActivation.h"
#include <QtTest>

class TrayTests : public QObject {
    Q_OBJECT
  private slots:
    void activation_data() {
        QTest::addColumn<int>("reason");
        QTest::addColumn<bool>("opens");
        QTest::newRow("single-click") << int(QSystemTrayIcon::Trigger) << true;
        QTest::newRow("double-click") << int(QSystemTrayIcon::DoubleClick) << true;
        QTest::newRow("context-menu") << int(QSystemTrayIcon::Context) << false;
        QTest::newRow("middle-click") << int(QSystemTrayIcon::MiddleClick) << false;
    }
    void activation() {
        QFETCH(int, reason);
        QFETCH(bool, opens);
        QWindow window;
        QSystemTrayIcon tray;
        connectTrayActivation(&tray, &window);
        QVERIFY(!window.isVisible());
        tray.activated(static_cast<QSystemTrayIcon::ActivationReason>(reason));
        QCOMPARE(window.isVisible(), opens);
    }
    void doubleClickRestoresMinimizedWindow() {
        QWindow window;
        QSystemTrayIcon tray;
        connectTrayActivation(&tray, &window);
        window.showMinimized();
        QVERIFY(window.windowStates().testFlag(Qt::WindowMinimized));
        tray.activated(QSystemTrayIcon::DoubleClick);
        QVERIFY(window.isVisible());
        QVERIFY(!window.windowStates().testFlag(Qt::WindowMinimized));
        window.close();
        QVERIFY(!window.isVisible());
        tray.activated(QSystemTrayIcon::DoubleClick);
        QVERIFY(window.isVisible());
    }
    void menuRestorePreservesMaximizedState() {
        QWindow window;
        window.showMaximized();
        window.hide();
        restoreMainWindow(&window);
        QVERIFY(window.isVisible());
        QVERIFY(window.windowStates().testFlag(Qt::WindowMaximized));
    }
};
QTEST_MAIN(TrayTests)
#include "TrayTests.moc"
