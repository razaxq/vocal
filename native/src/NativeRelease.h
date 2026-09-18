#pragma once
#include <QJsonArray>
#include <QJsonObject>
#include <QRegularExpression>
#include <QUrl>
#include <QVariantMap>
#include <QVersionNumber>

// Only the initial update attempt gates model startup. A later manual check
// must not stop an already running recognition session.
class StartupUpdateGate {
  public:
    explicit StartupUpdateGate(bool pending = true) : m_pending(pending) {}
    bool pending() const { return m_pending; }
    bool finishIfReady(const QString &state, bool automatic) {
        if (!m_pending || state == "idle" || state == "checking" || state == "downloading" ||
            state == "installing" || (state == "available" && automatic)) return false;
        m_pending = false;
        return true;
    }
  private:
    bool m_pending;
};

// Match the filenames produced by package.ps1. Electron assets and preview
// builds cannot enter the native stable update channel.
inline QVariantMap selectNativeRelease(const QJsonArray &releases, const QString &currentVersion) {
    auto newest = QVersionNumber::fromString(currentVersion);
    QVariantMap result;
    const QRegularExpression stableTag("^v(\\d+\\.\\d+\\.\\d+)$");
    const QRegularExpression sha256("^sha256:[a-fA-F0-9]{64}$");
    for (const auto &value : releases) {
        const auto release = value.toObject();
        const auto match = stableTag.match(release["tag_name"].toString());
        if (release["draft"].toBool() || release["prerelease"].toBool() || !match.hasMatch())
            continue;
        const auto version = match.captured(1);
        const auto parsed = QVersionNumber::fromString(version);
        if (parsed <= newest)
            continue;
        const auto filename = "Vocal-Native-Setup-" + version + ".exe";
        for (const auto &item : release["assets"].toArray()) {
            const auto asset = item.toObject();
            const QUrl url(asset["browser_download_url"].toString());
            const auto digest = asset["digest"].toString();
            const auto size = asset["size"].toInteger();
            if (asset["name"].toString() != filename || !sha256.match(digest).hasMatch() || size <= 0 ||
                size > 1024LL * 1024 * 1024 || url.scheme() != "https" || url.host() != "github.com" ||
                url.path() != "/razaxq/vocal/releases/download/v" + version + "/" + filename ||
                !url.userInfo().isEmpty() || url.hasQuery() || url.hasFragment())
                continue;
            newest = parsed;
            result = {{"state", "available"},  {"message", "发现新版本 " + version}, {"available", true},
                      {"url", url.toString()}, {"digest", digest.mid(7).toLower()},  {"version", version},
                      {"size", size}};
        }
    }
    return result;
}
