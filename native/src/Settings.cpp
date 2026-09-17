#include "Settings.h"
#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QMap>
#include <QSaveFile>

Settings::Settings(QString directory) : m_directory(std::move(directory)) {
    m_values = {
        {"modelId", "paraformer-yue-offline"},
        {"deviceId", ""},
        {"keyboardEnabled", true},
        {"mouseEnabled", false},
        {"keyboardInFullscreen", false},
        {"mouseInFullscreen", false},
        {"mouseButton", "middle"},
        {"mouseHoldDelayMs", 1000},
        {"language", "zh"},
        {"keyboardMode", "hold"},
        {"keyboardKey", "CtrlRight"},
        {"accelerator", "Control+Shift+Space"},
        {"minHoldMs", 200},
        {"doubleTapWindowMs", 350},
        {"debounceMs", 300},
        {"streamingModel", "none"},
        {"correctionModel", "macbert4csc"},
        {"endpointSilenceMs", 1500},
        {"idleUnloadMin", 10},
        {"cleanupLevel", "standard"},
        {"protectHotwords", true},
        {"extraFillers", QJsonArray{}},
        {"hotwords", QJsonArray{}},
        {"dictionaryEnabled", true},
        {"dictionaryAutoUpdate", true},
        {"injectionStrategy", "auto"},
        {"clipboardThreshold", 80},
        {"restoreClipboard", true},
        {"clipboardOnlyApps", QJsonArray{"WINWORD.EXE", "EXCEL.EXE"}},
        {"injectMode", "segment"},
        {"theme", "system"},
        {"followCaret", true},
        {"launchAtLogin", false},
        {"autoUpdate", true},
        {"consolidationMode", "onFinish"},
        {"minChars", 120},
        {"rollingChars", 300},
        {"maxReplaceChars", 1500},
        {"llmEnabled", false},
        {"llmBaseUrl", "https://dashscope.aliyuncs.com/compatible-mode/v1"},
        {"llmApiKey", ""},
        {"llmModel", "qwen-flash"},
        {"llmTimeoutMs", 8000},
        {"consolidatePrompt",
         QString::fromUtf8(
             "你是中文口述稿的整理编辑。将口语整理为书面文字，理顺语序，删除重复和自我修正，按语义分段。不得增加原文没"
             "有的信息，不得回答问题。保留专有名词、人名、数字、代码和英文术语。只输出整理后的正文。")}};
    QFile file(QDir(m_directory).filePath("settings.json"));
    if (!file.exists())
        return;
    if (!file.open(QIODevice::ReadOnly)) {
        m_error = file.errorString();
        return;
    }
    QJsonParseError error;
    const auto doc = QJsonDocument::fromJson(file.readAll(), &error);
    if (error.error != QJsonParseError::NoError || !doc.isObject()) {
        m_error = "Invalid settings.json; the original file has been preserved.";
        return;
    }
    const auto stored = doc.object();
    for (auto it = m_values.begin(); it != m_values.end(); ++it) {
        if (stored.value(it.key()).type() == it.value().type())
            it.value() = stored.value(it.key());
    }
    m_values["mouseHoldDelayMs"] = qBound(100, m_values["mouseHoldDelayMs"].toInt(1000), 10000);
    if (!QStringList{"left", "middle", "leftMiddle"}.contains(m_values["mouseButton"].toString()))
        m_values["mouseButton"] = "middle";
    if (!QStringList{"zh", "en"}.contains(m_values["language"].toString()))
        m_values["language"] = "zh";
}

bool Settings::set(const QString &key, const QJsonValue &value, QString *error) {
    // A corrupt file is not silently overwritten during a migration preview.
    auto fail = [&](const QString &message) {
        if (error)
            *error = message;
        return false;
    };
    if (!m_error.isEmpty())
        return fail(m_error);
    if (!m_values.contains(key) || value.type() != m_values[key].type())
        return fail("Invalid setting");
    if (key == "mouseHoldDelayMs" && (value.toInt() < 100 || value.toInt() > 10000))
        return fail("Invalid delay");
    if (key == "mouseButton" && !QStringList{"left", "middle", "leftMiddle"}.contains(value.toString()))
        return fail("Invalid mouse button");
    if (key == "language" && !QStringList{"zh", "en"}.contains(value.toString()))
        return fail("Invalid language");
    const QMap<QString, QStringList> choices{{"keyboardMode", {"hold", "toggle", "doubleTap"}},
                                             {"cleanupLevel", {"off", "light", "standard"}},
                                             {"injectionStrategy", {"auto", "unicode", "clipboard"}},
                                             {"injectMode", {"segment", "live"}},
                                             {"theme", {"system", "light", "dark"}},
                                             {"consolidationMode", {"off", "onFinish", "rolling"}},
                                             {"correctionModel", {"none", "macbert4csc", "bert-chinese-int8"}}};
    if (choices.contains(key) && !choices[key].contains(value.toString()))
        return fail("Invalid option");
    const QMap<QString, QPair<int, int>> ranges{{"minHoldMs", {0, 2000}},         {"doubleTapWindowMs", {150, 800}},
                                                {"debounceMs", {0, 2000}},        {"endpointSilenceMs", {400, 5000}},
                                                {"idleUnloadMin", {0, 240}},      {"clipboardThreshold", {1, 100000}},
                                                {"minChars", {0, 100000}},        {"rollingChars", {50, 100000}},
                                                {"maxReplaceChars", {0, 100000}}, {"llmTimeoutMs", {500, 60000}}};
    if (ranges.contains(key) &&
        (value.toDouble() != value.toInt() || value.toInt() < ranges[key].first || value.toInt() > ranges[key].second))
        return fail("Invalid number");
    if (value.isArray())
        for (auto entry : value.toArray())
            if (!entry.isString())
                return fail("Invalid list");
    QJsonObject next = m_values;
    next[key] = value;
    if (!QDir().mkpath(m_directory))
        return fail("Cannot create settings directory");
    QSaveFile file(QDir(m_directory).filePath("settings.json"));
    const auto bytes = QJsonDocument(next).toJson();
    if (!file.open(QIODevice::WriteOnly) || file.write(bytes) != bytes.size() || !file.commit())
        return fail(file.errorString());
    m_values = next;
    return true;
}
