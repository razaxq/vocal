#include "Settings.h"
#include <QDir>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QMap>
#include <QSaveFile>

Settings::Settings(QString directory) : m_directory(std::move(directory)) {
    m_values = {
        {"serviceEnabled", true},
        {"debugRecording", false},
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
        {"automaticSegmentation", true},
        {"microphoneWarmup", true},
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
        {"injectMode", "final"},
        {"theme", "system"},
        {"followCaret", true},
        {"overlayTextMode", "latest"},
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
        m_error = "无法读取设置文件，请检查文件权限：" + file.fileName() + "\n" + file.errorString();
        return;
    }
    QJsonParseError error;
    const auto doc = QJsonDocument::fromJson(file.readAll(), &error);
    if (error.error != QJsonParseError::NoError || !doc.isObject()) {
        m_error = "设置文件损坏。请修复或移走此文件后重启，原文件已保留：" + file.fileName() + "\n" + error.errorString();
        return;
    }
    const auto stored = doc.object();
    for (auto it = m_values.begin(); it != m_values.end(); ++it) {
        if (stored.value(it.key()).type() == it.value().type())
            it.value() = stored.value(it.key());
    }
    // AI editing now has one enable switch. Preserve effective disabled state
    // when migrating the old second Off option, without losing service details.
    if (m_values["consolidationMode"] == "off") {
        m_values["llmEnabled"] = false;
        m_values["consolidationMode"] = "onFinish";
    }
    // Preserve existing preview behavior when migrating the two legacy timings.
    if (stored["injectMode"] == "segment" || stored["injectMode"] == "live")
        m_values["injectMode"] = "preview";
    if (!QStringList{"final", "preview"}.contains(m_values["injectMode"].toString()))
        m_values["injectMode"] = "final";
    if (!stored.contains("overlayTextMode") && stored["overlayShowText"] == false)
        m_values["overlayTextMode"] = "none";
    if (!QStringList{"all", "latest", "none"}.contains(m_values["overlayTextMode"].toString()))
        m_values["overlayTextMode"] = "latest";
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
    const bool en = m_values["language"] == "en";
    const QMap<QString, QPair<QString, QString>> labels{
        {"mouseHoldDelayMs", {"按住多久开始", "Hold delay"}}, {"minHoldMs", {"最短录音时长", "Minimum recording length"}},
        {"doubleTapWindowMs", {"双击间隔", "Double tap interval"}}, {"debounceMs", {"重复触发间隔", "Trigger interval"}},
        {"endpointSilenceMs", {"停顿多久算一句", "Pause length"}}, {"idleUnloadMin", {"空闲释放内存", "Unload when idle"}},
        {"clipboardThreshold", {"粘贴字数门槛", "Paste above"}}, {"minChars", {"结束时最少字数", "Minimum final length"}},
        {"rollingChars", {"每次新增字数", "Edit every"}}, {"maxReplaceChars", {"自动替换上限", "Replacement limit"}},
        {"llmTimeoutMs", {"AI 整理超时", "AI editing timeout"}}, {"language", {"界面语言", "Interface language"}},
        {"mouseButton", {"鼠标按键", "Mouse button"}}, {"keyboardMode", {"键盘触发方式", "Keyboard mode"}},
        {"cleanupLevel", {"清理程度", "Cleanup level"}}, {"injectionStrategy", {"输入方式", "Input method"}},
        {"injectMode", {"何时输入", "Output timing"}}, {"overlayTextMode", {"预览内容", "Transcript preview"}},
        {"theme", {"主题", "Theme"}}, {"consolidationMode", {"整理时机", "Editing timing"}},
        {"correctionModel", {"文字纠错模型", "Text correction model"}}, {"hotwords", {"个人热词", "Personal hotwords"}},
        {"extraFillers", {"额外口头禅", "Extra fillers"}}, {"clipboardOnlyApps", {"始终粘贴的应用", "Apps that use paste"}}
    };
    const auto label = labels.contains(key) ? (en ? labels[key].second : labels[key].first) : key;
    const auto invalid = [&] { return fail(en ? label + ": choose a valid value." : label + "：请选择有效的值。"); };
    const QMap<QString, QPair<int, int>> ranges{{"mouseHoldDelayMs", {100, 10000}},
        {"minHoldMs", {0, 2000}}, {"doubleTapWindowMs", {150, 800}}, {"debounceMs", {0, 2000}},
        {"endpointSilenceMs", {400, 5000}}, {"idleUnloadMin", {0, 240}}, {"clipboardThreshold", {1, 100000}},
        {"minChars", {0, 100000}}, {"rollingChars", {50, 100000}}, {"maxReplaceChars", {0, 100000}},
        {"llmTimeoutMs", {500, 60000}}};
    if (ranges.contains(key) && (!value.isDouble() || value.toDouble() != value.toInt() ||
        value.toInt() < ranges[key].first || value.toInt() > ranges[key].second)) {
        const auto unit = key.endsWith("Ms") ? "ms" : key == "idleUnloadMin" ? "min" : en ? "chars" : "字";
        return fail(en ? QString("%1: enter a whole number from %2 to %3 %4.").arg(label).arg(ranges[key].first).arg(ranges[key].second).arg(unit)
                       : QString("%1：请输入 %2–%3 %4 范围内的整数。").arg(label).arg(ranges[key].first).arg(ranges[key].second).arg(unit));
    }
    if (!m_values.contains(key) || value.type() != m_values[key].type()) return invalid();
    const QMap<QString, QStringList> choices{{"keyboardMode", {"hold", "toggle", "doubleTap"}},
        {"mouseButton", {"left", "middle", "leftMiddle"}}, {"language", {"zh", "en"}},
        {"cleanupLevel", {"off", "light", "standard"}}, {"injectionStrategy", {"auto", "unicode", "clipboard"}},
        {"injectMode", {"final", "preview"}}, {"overlayTextMode", {"all", "latest", "none"}},
        {"theme", {"system", "light", "dark"}}, {"consolidationMode", {"off", "onFinish", "rolling"}},
        {"correctionModel", {"none", "macbert4csc", "bert-chinese-int8"}}};
    if (choices.contains(key) && !choices[key].contains(value.toString())) return invalid();
    if (value.isArray())
        for (auto entry : value.toArray())
            if (!entry.isString())
                return fail(en ? label + ": enter one text item per line." : label + "：请每行填写一项文字。");
    QJsonObject next = m_values;
    next[key] = value;
    if (!QDir().mkpath(m_directory))
        return fail(en ? label + ": cannot create the settings folder. Check folder permissions." : label + "：无法创建设置文件夹，请检查文件夹权限。");
    QSaveFile file(QDir(m_directory).filePath("settings.json"));
    const auto bytes = QJsonDocument(next).toJson();
    if (!file.open(QIODevice::WriteOnly) || file.write(bytes) != bytes.size() || !file.commit())
        return fail(en ? label + ": could not save. Check disk space and folder permissions.\n" + file.errorString() : label + "：保存失败，请检查磁盘空间和文件夹权限。\n" + file.errorString());
    m_values = next;
    return true;
}
