#include "Dictionary.h"
#include "CorrectionGuard.h"
#include "LlmService.h"
#include "ModelManager.h"
#include "ModelRows.h"
#include "NativeRelease.h"
#include "NativeUpdate.h"
#include "Settings.h"
#include "TextCleanup.h"
#include "TextOutput.h"
#include "TriggerController.h"
#include <QCryptographicHash>
#include <QClipboard>
#include <QGuiApplication>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QTcpServer>
#include <QTcpSocket>
#include <QTemporaryDir>
#include <QtTest>

class InputFixture : public Platform {
  public:
    quintptr focus = 1;
    QString typed;
    int erased = 0;
    QStringList selectedRanges;
    QString selected;
    int pasted = 0;
    int pasteDelay = 0;
    bool selectionSucceeds = true;
    bool succeeds = true;
    bool start(QString *) override { return true; }
    bool fullscreen() const override { return false; }
    quintptr target() const override { return focus; }
    bool inputSupported() const override { return true; }
    bool inject(quintptr, const QString &t, QString *) override {
        if (succeeds)
        {
            if (!selected.isEmpty()) typed.chop(selected.size());
            selected.clear();
            typed += t;
        }
        return succeeds;
    }
    bool selectPreviousText(quintptr, const QString &expected, QString *) override {
        selectedRanges.append(expected);
        if (!selectionSucceeds || !typed.endsWith(expected)) return false;
        selected = expected;
        return true;
    }
    int textInputApplied(quintptr, const QString &expected) override {
        return selected.isEmpty() && typed.endsWith(expected) ? 1 : 0;
    }
    bool paste(quintptr target, QString *error) override {
        ++pasted;
        if (pasteDelay > 0) {
            QTimer::singleShot(pasteDelay, this, [this, target] {
                QString ignored;
                inject(target, QGuiApplication::clipboard()->text(), &ignored);
            });
            return true;
        }
        return inject(target, QGuiApplication::clipboard()->text(), error);
    }
    bool erase(quintptr, int n, QString *) override {
        erased += n;
        if (!selected.isEmpty()) typed.chop(selected.size());
        selected.clear();
        return true;
    }
};
class LocalHttp : public QTcpServer {
  public:
    QByteArray body, request;
    bool hold = false;
    LocalHttp() {
        listen(QHostAddress::LocalHost);
        connect(this, &QTcpServer::newConnection, this, [this] {
            auto *socket = nextPendingConnection();
            connect(socket, &QTcpSocket::readyRead, socket, [this, socket] {
                request += socket->readAll();
                if (!request.contains("\r\n\r\n") || hold || socket->property("sent").toBool())
                    return;
                socket->setProperty("sent", true);
                socket->write("HTTP/1.1 200 OK\r\nContent-Length: " + QByteArray::number(body.size()) +
                              "\r\nConnection: close\r\n\r\n" + body);
                socket->disconnectFromHost();
            });
            connect(socket, &QTcpSocket::disconnected, socket, &QObject::deleteLater);
        });
    }
    QString url() const { return "http://127.0.0.1:" + QString::number(serverPort()); }
};
QByteArray tarMember(const QByteArray &path, const QByteArray &bytes, char type = '0', const QByteArray &link = {}) {
    QByteArray header(512, '\0');
    auto put = [&](int at, const QByteArray &value) { std::copy(value.begin(), value.end(), header.begin() + at); };
    put(0, path);
    put(100, "0000644");
    put(108, "0000000");
    put(116, "0000000");
    put(124, QByteArray::number(bytes.size(), 8).rightJustified(11, '0'));
    put(136, "00000000000");
    put(148, "        ");
    header[156] = type;
    put(157, link);
    put(257, "ustar");
    put(263, "00");
    unsigned sum = 0;
    for (auto ch : header)
        sum += quint8(ch);
    put(148, QByteArray::number(sum, 8).rightJustified(6, '0') + QByteArray(1, '\0') + ' ');
    return header + bytes + QByteArray((512 - bytes.size() % 512) % 512, '\0');
}
class FeatureTests : public QObject {
    Q_OBJECT
  private slots:
    void contextualCorrectionRejectsNonHanTokens() {
        QVERIFY(isHanCharacterEdit(u"夭", u"天"));
        QVERIFY(isHanCharacterEdit(u"汽", u"气"));
        QVERIFY(!isHanCharacterEdit(u"天", u"[UNK]"));
        QVERIFY(!isHanCharacterEdit(u"天", u"##天"));
        QVERIFY(!isHanCharacterEdit(u"天", u"天气"));
        QVERIFY(!isHanCharacterEdit(u"天", u"。"));
        QVERIFY(!isHanCharacterEdit(u"A", u"天"));
        QVERIFY(!isHanCharacterEdit(u"天", u"1"));
        QVERIFY(!isHanCharacterEdit(u"", u"天"));
    }
    void correctionCannotIntroduceOrChangeNumbers() {
        QVERIFY(!preservesNumericCharacters(u"已在", u"一在"));
        QVERIFY(!preservesNumericCharacters(u"已再", u"一再"));
        QVERIFY(!preservesNumericCharacters(u"一百", u"已百"));
        QVERIFY(!preservesNumericCharacters(u"O1", u"01"));
        QVERIFY(!preservesNumericCharacters(u"12", u"13"));
        QVERIFY(preservesNumericCharacters(u"三幢楼", u"三栋楼"));
        QVERIFY(preservesNumericCharacters(u"懒柜", u"懒鬼"));
        QVERIFY(preservesNumericCharacters(u"已在", u"已在"));
    }
    void silentUpdatePreservesInstallDirectory() {
        QProcess installer;
        configureNativeUpdate(installer, "C:/Temp/Vocal Update.exe", 1234, "C:/Users/Test User/Vocal 中文");
        QCOMPARE(installer.program(), "C:/Temp/Vocal Update.exe");
        QCOMPARE(installer.arguments(), QStringList({"/S", "/APPUPDATE", "/WAITPID=1234"}));
#ifdef Q_OS_WIN
        QCOMPARE(installer.nativeArguments(), QString("/D=C:\\Users\\Test User\\Vocal 中文"));
#endif
    }
    void queuedDownloadsContinueAfterCancellationAndFailure() {
        QTemporaryDir temp;
        LocalHttp held, good, bad;
        held.hold = true;
        good.body = bad.body = "model";
        const auto entry = [](const QString &id, const QString &url, bool invalid = false) {
            QJsonObject file{{"url", url}, {"file", "model.onnx"}};
            if (invalid) {
                file["sha256"] = QString(64, '0');
                file["bytes"] = 5;
            }
            return QJsonObject{{"id", id},
                               {"dir", id},
                               {"archive", "files"},
                               {"files", QJsonObject{{"model", "model.onnx"}}},
                               {"downloads", QJsonArray{file}}};
        };
        ModelManager manager(temp.path(), nullptr,
                             {{"offline", QJsonArray{entry("held", held.url()), entry("bad", bad.url(), true),
                                                     entry("good", good.url()), entry("skip", good.url())}}});
        const auto row = [&](int i) { return manager.models("offline")[i].toMap(); };
        QSignalSpy done(&manager, &ModelManager::completed), failed(&manager, &ModelManager::failed);
        manager.download("held");
        manager.download("skip");
        manager.download("bad");
        manager.download("good");
        manager.download("good"); // A double click must not queue the same model twice.
        QTRY_VERIFY(!held.request.isEmpty());
        QCOMPARE(row(2)["queuePosition"].toInt(), 3);
        QVERIFY(good.request.isEmpty());
        manager.cancel("skip");
        QCOMPARE(row(3)["phase"].toString(), "cancelled");
        QCOMPARE(row(2)["queuePosition"].toInt(), 2);
        manager.cancel("held");
        QTRY_COMPARE(done.size(), 1);
        QCOMPARE(done[0][0].toString(), "good");
        QCOMPARE(failed.size(), 1);
        QCOMPARE(row(1)["phase"].toString(), "error");
        QVERIFY(!row(1)["error"].toString().isEmpty());
        QVERIFY(QFile::exists(temp.filePath("good/model.onnx")));
        QVERIFY(!QFile::exists(temp.filePath("skip")));
        QVERIFY(!manager.busy());
        manager.download("held");
        manager.download("skip");
        manager.cancel();
        QTest::qWait(100);
        QVERIFY(!manager.busy());
        QCOMPARE(done.size(), 1);
        QVERIFY(!QFile::exists(temp.filePath("skip")));
    }
    void queuedDownloadsFinishInOrder() {
        QTemporaryDir temp;
        LocalHttp server;
        server.body = "model";
        QJsonArray entries;
        for (const auto &id : {"a", "b", "c"})
            entries.append(
                QJsonObject{{"id", id},
                            {"dir", id},
                            {"archive", "files"},
                            {"files", QJsonObject{{"model", "model.onnx"}}},
                            {"downloads", QJsonArray{QJsonObject{{"url", server.url()}, {"file", "model.onnx"}}}}});
        ModelManager manager(temp.path(), nullptr, {{"offline", entries}});
        QSignalSpy done(&manager, &ModelManager::completed);
        for (const auto &id : {"a", "b", "c"})
            manager.download(id);
        QTRY_COMPARE(done.size(), 3);
        QCOMPARE(done[0][0].toString(), "a");
        QCOMPARE(done[1][0].toString(), "b");
        QCOMPARE(done[2][0].toString(), "c");
        QVERIFY(!manager.busy());
    }
    void nativeUpdateChannel() {
        const auto release = [](QString version) {
            const auto name = "Vocal-Native-Setup-" + version + ".exe";
            return QJsonObject{
                {"tag_name", "v" + version},
                {"draft", false},
                {"prerelease", false},
                {"assets",
                 QJsonArray{QJsonObject{{"name", name},
                                        {"size", 12345},
                                        {"digest", "sha256:" + QString(64, 'a')},
                                        {"browser_download_url", "https://github.com/razaxq/vocal/releases/download/v" +
                                                                     version + "/" + name}}}}};
        };
        const auto valid = release("0.2.0");
        QCOMPARE(selectNativeRelease({release("0.1.12"), valid}, "0.1.11")["version"].toString(), "0.2.0");
        QVERIFY(selectNativeRelease({valid}, "0.2.0").isEmpty());
        for (const auto &flag : {"draft", "prerelease"}) {
            auto rejected = valid;
            rejected[flag] = true;
            QVERIFY(selectNativeRelease({rejected}, "0.1.11").isEmpty());
        }
        for (const auto &name : {"Vocal-Setup-0.2.0.exe", "Vocal-Native-0.2.0-win-x64.zip"}) {
            auto rejected = valid;
            auto asset = rejected["assets"].toArray()[0].toObject();
            asset["name"] = name;
            rejected["assets"] = QJsonArray{asset};
            QVERIFY(selectNativeRelease({rejected}, "0.1.11").isEmpty());
        }
        const QList<QPair<QString, QJsonValue>> invalid{
            {"digest", ""},
            {"digest", "sha256:" + QString(64, 'z')},
            {"size", 0},
            {"browser_download_url", "https://example.com/Vocal-Native-Setup-0.2.0.exe"}};
        for (const auto &field : invalid) {
            auto rejected = valid;
            auto asset = rejected["assets"].toArray()[0].toObject();
            asset[field.first] = field.second;
            rejected["assets"] = QJsonArray{asset};
            QVERIFY(selectNativeRelease({rejected}, "0.1.11").isEmpty());
        }
    }
    void modelProgressKeepsOtherRowsAlive() {
        ModelRows model;
        QVariantList rows{QVariantMap{{"id", "a"}, {"percent", 0}}, QVariantMap{{"id", "b"}, {"percent", 0}}};
        model.update(rows);
        QSignalSpy reset(&model, &QAbstractItemModel::modelReset);
        QSignalSpy changed(&model, &QAbstractItemModel::dataChanged);
        QPersistentModelIndex unchanged(model.index(1));
        rows[0] = QVariantMap{{"id", "a"}, {"percent", 42}};
        model.update(rows);
        QCOMPARE(reset.count(), 0);
        QCOMPARE(changed.count(), 1);
        QVERIFY(unchanged.isValid());
        QCOMPARE(unchanged.data(Qt::UserRole).toMap()["id"].toString(), QString("b"));
        model.update(rows);
        QCOMPARE(changed.count(), 1);
    }
    void cleanupPreservesMeaning() {
        QJsonObject config{{"cleanupLevel", "standard"}};
        QCOMPARE(cleanupSpeech("嗯，那个，今天天气很好。", config), QString("今天天气很好。"));
        QCOMPARE(cleanupSpeech("这个方案不行，刚刚看过。", config), QString("这个方案不行，刚刚看过。"));
        QCOMPARE(cleanupSpeech("我我我觉得可以使用GitHub。", config), QString("我觉得可以使用 GitHub。"));
        config["hotwords"] = QJsonArray{"那个"};
        config["protectHotwords"] = true;
        QCOMPARE(cleanupSpeech("那个，保留项目名。", config), QString("那个，保留项目名。"));
        config["cleanupLevel"] = "off";
        QCOMPARE(cleanupSpeech("嗯，  I I agree", config), QString("嗯，  I I agree"));
    }
    void textReplacementDoesNotDeleteTwice() {
        InputFixture platform;
        TextOutput output(&platform);
        QString error;
        QJsonObject config{{"injectionStrategy", "unicode"}};
        output.begin(1);
        QVERIFY(output.update("测试旧内容", config, 1500, &error));
        platform.succeeds = false;
        QVERIFY(!output.update("测试新内容", config, 1500, &error));
        QCOMPARE(platform.erased, 0);
        QCOMPARE(platform.typed, "测试旧内容"); // Failed insertion did not first destroy the old suffix.
        QCOMPARE(platform.selectedRanges.size(), 1);
        platform.succeeds = true;
        QVERIFY(!output.update("测试新内容", config, 1500, &error));
        QCOMPARE(platform.erased, 0);
        QCOMPARE(platform.selectedRanges.size(), 1);
    }
    void longReplacementUsesOneSelectionAndOnePaste() {
        InputFixture platform;
        TextOutput output(&platform);
        QString error;
        QJsonObject config{{"injectionStrategy", "auto"}, {"restoreClipboard", true}};
        QGuiApplication::clipboard()->setText("original clipboard");
        output.begin(1);
        QVERIFY(output.update(QString(1000, QChar(u'旧')), config, 1500, &error));
        const int before = platform.pasted;
        const QString replacement = QString(950, QChar(u'新'));
        QVERIFY(output.update(replacement, config, 1500, &error));
        QCOMPARE(platform.selectedRanges.size(), 1);
        QCOMPARE(platform.selectedRanges.first().size(), 1000);
        QCOMPARE(platform.erased, 0);
        QCOMPARE(platform.pasted, before + 1);
        QCOMPARE(platform.typed, replacement);
        QTRY_COMPARE(QGuiApplication::clipboard()->text(), "original clipboard");
    }
    void replacementPreservesPrefixAndGraphemeBoundaries() {
        InputFixture platform;
        TextOutput output(&platform);
        QString error;
        QJsonObject config{{"injectionStrategy", "unicode"}};
        output.begin(1);
        const QString original = QString::fromUtf8("保留：é👩‍💻旧内容");
        const QString revised = QString::fromUtf8("保留：è👩‍🔬新内容");
        QVERIFY(output.update(original, config, 1500, &error));
        QVERIFY(output.update(revised, config, 1500, &error));
        QCOMPARE(platform.selectedRanges.first(), original.mid(3));
        QCOMPARE(platform.typed, revised);
        QVERIFY(output.update("保留：", config, 1500, &error));
        QCOMPARE(platform.typed, "保留：");
        QCOMPARE(platform.erased, 1); // One deletion of the selected suffix.
    }
    void selectionFailureCannotRetryAndClipboardUserChangesSurvive() {
        InputFixture platform;
        TextOutput output(&platform);
        QString error;
        QJsonObject config{{"injectionStrategy", "clipboard"}, {"restoreClipboard", true}};
        QGuiApplication::clipboard()->setText("first copy");
        output.begin(1);
        QVERIFY(output.update("旧内容", config, 1500, &error));
        QGuiApplication::clipboard()->setText("new user copy");
        QVERIFY(output.update("新内容", config, 1500, &error));
        QTRY_COMPARE(QGuiApplication::clipboard()->text(), "new user copy");
        platform.selectionSucceeds = false;
        QVERIFY(!output.update("再次改写", config, 1500, &error));
        const int attempts = platform.selectedRanges.size();
        platform.selectionSucceeds = true;
        QVERIFY(!output.update("再次改写", config, 1500, &error));
        QCOMPARE(platform.selectedRanges.size(), attempts);
        QCOMPARE(platform.typed, "新内容");
        QCOMPARE(platform.erased, 0);
    }
    void delayedClipboardPastesCoalesceAndReplaceOnce() {
        InputFixture platform;
        platform.pasteDelay = 240; // Target reads clipboard after the old 200 ms restoration timeout.
        TextOutput output(&platform);
        QSignalSpy idle(&output, &TextOutput::idle);
        QString error;
        QJsonObject config{{"injectionStrategy", "clipboard"}, {"restoreClipboard", true}};
        QGuiApplication::clipboard()->setText("user clipboard");
        output.begin(1);
        QVERIFY(output.update("今天晴天", config, 1500, &error));
        QVERIFY(output.update("今天晴天明天", config, 1500, &error));
        QVERIFY(output.update("今天晴天，明天也晴天。", config, 1500, &error));
        QCOMPARE(platform.pasted, 1);
        QCOMPARE(QGuiApplication::clipboard()->text(), "今天晴天");
        QTRY_COMPARE(output.inserted(), QString("今天晴天，明天也晴天。"));
        QCOMPARE(platform.typed, output.inserted());
        QCOMPARE(platform.pasted, 2); // Intermediate preview never reaches target.
        QCOMPARE(idle.count(), 1);
        QVERIFY(!output.busy());
        QTRY_COMPARE(QGuiApplication::clipboard()->text(), "user clipboard");
        QVERIFY(output.update(output.inserted(), config, 1500, &error));
        QCOMPARE(platform.pasted, 2); // Final identical to preview: no second paste.
        QVERIFY(output.update("今天晴天。", config, 1500, &error));
        QTRY_COMPARE(output.inserted(), QString("今天晴天。"));
        QCOMPARE(platform.selectedRanges.last(), QString("，明天也晴天。"));
        QCOMPARE(platform.typed, QString("今天晴天。"));
    }
    void pendingPasteDoesNotLeakIntoNextSession() {
        InputFixture platform;
        platform.pasteDelay = 120;
        TextOutput output(&platform);
        QString error;
        QJsonObject config{{"injectionStrategy", "clipboard"}, {"restoreClipboard", true}};
        output.begin(1);
        QVERIFY(output.update("第一句", config, 1500, &error));
        QVERIFY(output.update("应被取消的旧预览", config, 1500, &error));
        output.begin(0); // Cancel the unsent preview; first paste has already been submitted.
        output.begin(1);
        QVERIFY(output.update("第二句", config, 1500, &error));
        QTRY_COMPARE(output.inserted(), QString("第二句"));
        QCOMPARE(platform.typed, QString("第一句第二句"));
        QCOMPARE(platform.pasted, 2);
        QVERIFY(platform.selectedRanges.isEmpty());
    }
    void delayedOutputDoesNotContinueAfterFocusMoves() {
        InputFixture platform;
        platform.pasteDelay = 100;
        TextOutput output(&platform);
        QSignalSpy failures(&output, &TextOutput::failed);
        QString error;
        QJsonObject config{{"injectionStrategy", "clipboard"}};
        output.begin(1);
        QVERIFY(output.update("预览", config, 1500, &error));
        QVERIFY(output.update("最终内容", config, 1500, &error));
        platform.focus = 2;
        QTRY_COMPARE(failures.count(), 1);
        QCOMPARE(platform.pasted, 1);
        QVERIFY(platform.selectedRanges.isEmpty());
    }
    void focusLossAndReplacementLimit() {
        InputFixture platform;
        TextOutput output(&platform);
        QString error;
        QJsonObject config{{"injectionStrategy", "unicode"}};
        output.begin(1);
        QVERIFY(output.update("原始文字", config, 1500, &error));
        QVERIFY(!output.update("全部改写", config, 2, &error));
        QCOMPARE(platform.erased, 0);
        QVERIFY(platform.selectedRanges.isEmpty());
        platform.focus = 2;
        QVERIFY(!output.update("最终文字", config, 1500, &error));
        platform.focus = 1;
        QVERIFY(!output.update("最终文字", config, 1500, &error));
        QCOMPARE(platform.erased, 0);
        QVERIFY(platform.selectedRanges.isEmpty());
    }
    void keyboardModesAndMouseEscape() {
        QTemporaryDir temp;
        Settings settings(temp.path());
        settings.set("keyboardMode", "doubleTap");
        settings.set("debounceMs", 0);
        InputFixture platform;
        TriggerController trigger(&platform);
        trigger.configure(settings.values());
        QSignalSpy pressed(&trigger, &TriggerController::pressed), released(&trigger, &TriggerController::released),
            cancelled(&trigger, &TriggerController::cancelled);
        trigger.accept(0, true);
        QTest::qWait(50);
        trigger.accept(0, false);
        QCOMPARE(pressed.size(), 0);
        trigger.accept(0, true);
        QTRY_COMPARE(pressed.size(), 1);
        trigger.accept(0, false);
        QCOMPARE(released.size(), 0);
        emit platform.escapePressed();
        QCOMPARE(cancelled.size(), 1);
        settings.set("keyboardMode", "toggle");
        trigger.configure(settings.values());
        trigger.accept(0, true);
        QTRY_COMPARE(pressed.size(), 2);
        trigger.accept(0, false);
        trigger.accept(0, true);
        QTRY_COMPARE(released.size(), 1);
        trigger.accept(0, false);
        settings.set("mouseEnabled", true);
        settings.set("mouseButton", "middle");
        settings.set("mouseHoldDelayMs", 100);
        trigger.configure(settings.values());
        trigger.accept(2, true);
        QTRY_COMPARE(pressed.size(), 3);
        emit platform.escapePressed();
        QCOMPARE(cancelled.size(), 1);
        trigger.accept(2, false);
        QCOMPARE(released.size(), 2);
    }
    void dictionaryCandidates() {
        QTemporaryDir temp;
        QFile file(temp.filePath("catalog.json"));
        QVERIFY(file.open(QIODevice::WriteOnly));
        file.write(
            QJsonDocument(QJsonObject{{"version", 3},
                                      {"words", QJsonArray{"懒鬼", "拦柜", "天气", "高兴", "高心"}},
                                      {"readings", QJsonArray{"lan gui", "lan gui", "tian qi", "gao xing", "gao xin"}}})
                .toJson());
        file.close();
        Dictionary dictionary;
        QVERIFY(dictionary.load(file.fileName()));
        QCOMPARE(dictionary.homophones("拦柜"), QStringList{"懒鬼"});
        QVERIFY(dictionary.similarSound("高兴", "高心"));
        QVERIFY(dictionary.retrieve("拦柜").contains("懒鬼"));
        QCOMPARE(Dictionary::inspect(file.fileName())["count"].toInt(), 5);
    }
    void llmResponseGuards() {
        QCOMPARE(LlmService::guard("原始内容", ""), QString("原始内容"));
        QCOMPARE(LlmService::guard("原始内容", QString(100, 'x')), QString("原始内容"));
        QCOMPARE(LlmService::guard("今天的天气很好。", "今天天气很好。"), QString("今天天气很好。"));
    }
    void llmLocalHttp() {
        LocalHttp server;
        QVERIFY(server.isListening());
        server.body = R"({"choices":[{"message":{"content":"今天天气很好。"}}]})";
        LlmService service;
        QSignalSpy done(&service, &LlmService::completed);
        QSignalSpy diagnostic(&service, &LlmService::diagnostic);
        QJsonObject config{{"llmEnabled", true}, {"llmBaseUrl", server.url()}, {"llmApiKey", "local-test-token"},
                           {"llmModel", "test"}, {"llmTimeoutMs", 1000},       {"consolidatePrompt", "整理文字"}};
        service.consolidate("今天的天气很好。", config, 7);
        QTRY_COMPARE(done.size(), 1);
        QCOMPARE(done[0][0].toInt(), 7);
        QCOMPARE(done[0][2].toString(), QString("今天天气很好。"));
        QVERIFY(server.request.contains("POST /chat/completions"));
        QVERIFY(server.request.contains("Bearer local-test-token"));
        QCOMPARE(diagnostic.size(), 2);
        QCOMPARE(diagnostic[1][1].toJsonObject()["raw"].toString(), QString("今天天气很好。"));
        for (const auto &event : diagnostic)
            QVERIFY(!QJsonDocument(event[1].toJsonObject()).toJson().contains("local-test-token"));
    }
    void archiveDownloadAndDelete() {
        QTemporaryDir temp;
        LocalHttp server;
        QVERIFY(server.isListening());
        server.body = tarMember("fixture/model.onnx", "weights") + tarMember("fixture/tokens.txt", "tokens") +
                      tarMember("fixture/link", {}, '2', "../../escape") +
                      tarMember("../../escape", "must not extract") + QByteArray(1024, '\0');
        const QJsonObject entry{{"id", "fixture"},
                                {"dir", "fixture"},
                                {"url", server.url() + "/model.tar.bz2"},
                                {"files", QJsonObject{{"model", "model.onnx"}, {"tokens", "tokens.txt"}}}};
        ModelManager manager(temp.path(), nullptr, QJsonObject{{"offline", QJsonArray{entry}}});
        QSignalSpy done(&manager, &ModelManager::completed), failed(&manager, &ModelManager::failed);
        manager.download("fixture");
        QTRY_COMPARE_WITH_TIMEOUT(done.size(), 1, 10000);
        QCOMPARE(failed.size(), 0);
        QVERIFY(QFile::exists(temp.filePath("fixture/model.onnx")));
        QVERIFY(!QFile::exists(temp.filePath("fixture/link")));
        QVERIFY(!QFile::exists(temp.filePath("escape")));
        QCOMPARE(manager.models("offline")[0].toMap()["installed"].toBool(), true);
        manager.remove("fixture");
        QCOMPARE(manager.models("offline")[0].toMap()["phase"].toString(), QString("deleting"));
        QTRY_COMPARE(done.size(), 2);
        QVERIFY(!QFile::exists(temp.filePath("fixture")));
    }
    void directDownloadRejectsWrongHashAndCancels() {
        QTemporaryDir temp;
        LocalHttp server;
        server.body = "incorrect";
        const QJsonObject entry{{"id", "fixture"},
                                {"dir", "fixture"},
                                {"archive", "files"},
                                {"files", QJsonObject{{"model", "model.onnx"}}},
                                {"downloads", QJsonArray{QJsonObject{{"url", server.url() + "/model"},
                                                                     {"file", "model.onnx"},
                                                                     {"bytes", 9},
                                                                     {"sha256", QString(64, '0')}}}}};
        ModelManager manager(temp.path(), nullptr, QJsonObject{{"offline", QJsonArray{entry}}});
        QSignalSpy done(&manager, &ModelManager::completed), failed(&manager, &ModelManager::failed);
        manager.download("fixture");
        QTRY_COMPARE(failed.size(), 1);
        QCOMPARE(done.size(), 0);
        QVERIFY(!QFile::exists(temp.filePath("fixture")));
        server.hold = true;
        manager.download("fixture");
        manager.cancel();
        QTest::qWait(50);
        QCOMPARE(manager.models("offline")[0].toMap()["phase"].toString(), QString("cancelled"));
        QCOMPARE(done.size(), 0);
    }
};
QTEST_MAIN(FeatureTests)
#include "FeatureTests.moc"
