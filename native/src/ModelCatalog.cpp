#include "ModelCatalog.h"
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>

static void initCatalogResource() {
    Q_INIT_RESOURCE(catalog);
}
ModelCatalog::ModelCatalog(QString root, QJsonObject registry) : m_root(QDir(root).absolutePath()) {
    if (!registry.isEmpty()) {
        m_catalog = std::move(registry);
        return;
    }
    initCatalogResource();
    QFile resource(":/vocal/scripts/models.json");
    if (resource.open(QIODevice::ReadOnly))
        m_catalog = QJsonDocument::fromJson(resource.readAll()).object();
}
QJsonObject ModelCatalog::find(const QString &id) const {
    for (const auto &group : {"offline", "streaming", "correction", "punct", "vad"})
        for (const auto &value : m_catalog[group].toArray())
            if (value.toObject()["id"].toString() == id)
                return value.toObject();
    return {};
}
QString ModelCatalog::file(const QJsonObject &model, const QString &key) const {
    const auto name = model["files"].toObject()[key].toString();
    if (name.isEmpty() || model["dir"].toString().isEmpty())
        return {};
    return QDir(m_root).filePath(model["dir"].toString() + '/' + name);
}
bool ModelCatalog::installed(const QJsonObject &model) const {
    const auto files = model["files"].toObject();
    if (files.isEmpty())
        return false;
    for (auto it = files.begin(); it != files.end(); ++it)
        if (!QFileInfo(file(model, it.key())).isFile() || QFileInfo(file(model, it.key())).size() <= 0)
            return false;
    return true;
}
QVariantList ModelCatalog::offlineModels() const {
    return models("offline");
}
QVariantList ModelCatalog::models(const QString &group) const {
    QVariantList result;
    for (const auto &value : m_catalog[group].toArray()) {
        auto item = value.toObject().toVariantMap();
        item["installed"] = installed(value.toObject());
        result.append(item);
    }
    return result;
}
