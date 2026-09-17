#pragma once
#include <QJsonObject>
#include <QVariantList>

class ModelCatalog {
  public:
    explicit ModelCatalog(QString root, QJsonObject registry = {});
    QJsonObject find(const QString &id) const;
    QString file(const QJsonObject &model, const QString &key) const;
    bool installed(const QJsonObject &model) const;
    QVariantList offlineModels() const;
    QVariantList models(const QString &group) const;
    QString root() const { return m_root; }

  private:
    QString m_root;
    QJsonObject m_catalog;
};
