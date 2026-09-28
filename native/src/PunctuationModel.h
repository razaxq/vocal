#pragma once
#include <QString>
#include <memory>

class PunctuationModel {
  public:
    PunctuationModel(const QString &runtime, const QString &model);
    ~PunctuationModel();
    QString punctuate(const QString &text);
  private:
    struct Impl;
    std::unique_ptr<Impl> m_impl;
};
