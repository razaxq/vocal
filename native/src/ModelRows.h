#pragma once
#include <QAbstractListModel>
#include <QVariantList>

// Keep QML delegates alive while model state or resource statistics change.
class ModelRows : public QAbstractListModel {
  public:
    using QAbstractListModel::QAbstractListModel;
    int rowCount(const QModelIndex &parent = {}) const override { return parent.isValid() ? 0 : m_rows.size(); }
    QVariant data(const QModelIndex &index, int role) const override {
        return index.isValid() && index.row() >= 0 && index.row() < m_rows.size() && role == Qt::UserRole
                   ? m_rows[index.row()]
                   : QVariant{};
    }
    QHash<int, QByteArray> roleNames() const override { return {{Qt::UserRole, "modelData"}}; }
    void update(const QVariantList &rows) {
        bool sameOrder = rows.size() == m_rows.size();
        for (int i = 0; sameOrder && i < rows.size(); ++i)
            sameOrder = rows[i].toMap()["id"] == m_rows[i].toMap()["id"];
        if (!sameOrder) {
            beginResetModel();
            m_rows = rows;
            endResetModel();
            return;
        }
        for (int i = 0; i < rows.size(); ++i) {
            if (rows[i] == m_rows[i])
                continue;
            m_rows[i] = rows[i];
            emit dataChanged(index(i), index(i), {Qt::UserRole});
        }
    }

  private:
    QVariantList m_rows;
};
