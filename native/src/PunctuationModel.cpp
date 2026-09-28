// SPDX-License-Identifier: Apache-2.0
// Incremental punctuation policy adapted from sherpa-onnx:
// Copyright (c) 2024 Xiaomi Corporation; modifications by Vocal contributors.
#include "PunctuationModel.h"
#if defined(__MINGW32__) && !defined(_Frees_ptr_opt_)
#define _Frees_ptr_opt_
#endif
#include "onnxruntime/onnxruntime_c_api.h"
#include <QHash>
#include <QLibrary>
#include <QRegularExpression>
#include <QScopeGuard>
#include <QVector>
#include <algorithm>
#include <cmath>
#include <stdexcept>

struct PunctuationModel::Impl {
    QLibrary library;
    const OrtApi *api = nullptr;
    OrtEnv *env = nullptr;
    OrtSessionOptions *options = nullptr;
    OrtSession *session = nullptr;
    OrtMemoryInfo *memory = nullptr;
    OrtAllocator *allocator = nullptr;
    QHash<QString, int32_t> vocabulary;
    QStringList marks;
    int32_t unknown = 0;

    ~Impl() {
        if (memory) api->ReleaseMemoryInfo(memory);
        if (session) api->ReleaseSession(session);
        if (options) api->ReleaseSessionOptions(options);
        if (env) api->ReleaseEnv(env);
    }
    void check(OrtStatus *status) {
        if (!status) return;
        const auto message = QString::fromUtf8(api->GetErrorMessage(status));
        api->ReleaseStatus(status);
        throw std::runtime_error(message.toStdString());
    }
    void initialize(const QString &runtime, const QString &path) {
        library.setFileName(runtime);
        auto base = reinterpret_cast<const OrtApiBase *(ORT_API_CALL *)()>(library.resolve("OrtGetApiBase"));
        if (!base || !(api = base()->GetApi(ORT_API_VERSION)))
            throw std::runtime_error("Cannot load punctuation ONNX Runtime");
        check(api->CreateEnv(ORT_LOGGING_LEVEL_ERROR, "vocal-punctuation", &env));
        check(api->CreateSessionOptions(&options));
        check(api->SetIntraOpNumThreads(options, 1));
        check(api->SetInterOpNumThreads(options, 1));
        check(api->SetSessionGraphOptimizationLevel(options, ORT_ENABLE_ALL));
#ifdef Q_OS_WIN
        check(api->CreateSession(env, reinterpret_cast<const wchar_t *>(path.utf16()), options, &session));
#else
        check(api->CreateSession(env, path.toUtf8().constData(), options, &session));
#endif
        check(api->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault, &memory));
        check(api->GetAllocatorWithDefaultOptions(&allocator));
        OrtModelMetadata *metadata = nullptr;
        check(api->SessionGetModelMetadata(session, &metadata));
        const auto release = qScopeGuard([&] { api->ReleaseModelMetadata(metadata); });
        auto value = [&](const char *key) {
            char *raw = nullptr;
            check(api->ModelMetadataLookupCustomMetadataMap(metadata, allocator, key, &raw));
            const auto result = QString::fromUtf8(raw ? raw : "");
            if (raw) allocator->Free(allocator, raw);
            return result;
        };
        const auto tokens = value("tokens").split('|');
        marks = value("punctuations").split('|');
        if (value("model_type") != "ct_transformer" || tokens.size() != value("vocab_size").toInt() ||
            !marks.contains("_") || !marks.contains("。") || !marks.contains("？"))
            throw std::runtime_error("Unsupported punctuation model metadata");
        vocabulary.reserve(tokens.size());
        for (int i = 0; i < tokens.size(); ++i) vocabulary.insert(tokens[i], i);
        const auto symbol = value("unk_symbol");
        if (!vocabulary.contains(symbol)) throw std::runtime_error("Missing punctuation unknown token");
        unknown = vocabulary.value(symbol);
    }
    QVector<int> predict(QVector<int32_t> tokens) {
        OrtValue *input = nullptr, *length = nullptr, *output = nullptr;
        OrtTensorTypeAndShapeInfo *info = nullptr;
        const auto release = qScopeGuard([&] {
            if (info) api->ReleaseTensorTypeAndShapeInfo(info);
            if (output) api->ReleaseValue(output);
            if (length) api->ReleaseValue(length);
            if (input) api->ReleaseValue(input);
        });
        int32_t count = int32_t(tokens.size());
        const int64_t shape[]{1, count}, lengthShape[]{1};
        check(api->CreateTensorWithDataAsOrtValue(memory, tokens.data(), tokens.size() * sizeof(int32_t),
            shape, 2, ONNX_TENSOR_ELEMENT_DATA_TYPE_INT32, &input));
        check(api->CreateTensorWithDataAsOrtValue(memory, &count, sizeof(count), lengthShape, 1,
            ONNX_TENSOR_ELEMENT_DATA_TYPE_INT32, &length));
        const OrtValue *inputs[]{input, length};
        const char *names[]{"inputs", "text_lengths"}, *outputs[]{"logits"};
        check(api->Run(session, nullptr, names, inputs, 2, outputs, 1, &output));
        check(api->GetTensorTypeAndShape(output, &info));
        size_t rank = 0;
        ONNXTensorElementDataType type;
        check(api->GetDimensionsCount(info, &rank));
        check(api->GetTensorElementType(info, &type));
        int64_t dimensions[3]{};
        if (rank != 3 || type != ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT)
            throw std::runtime_error("Unsupported punctuation output");
        check(api->GetDimensions(info, dimensions, 3));
        if (dimensions[0] != 1 || dimensions[1] != count || dimensions[2] != marks.size())
            throw std::runtime_error("Invalid punctuation output dimensions");
        float *scores = nullptr;
        check(api->GetTensorMutableData(output, reinterpret_cast<void **>(&scores)));
        QVector<int> result;
        result.reserve(count);
        for (int i = 0; i < count; ++i) {
            const auto *row = scores + i * marks.size();
            if (!std::all_of(row, row + marks.size(), [](float v) { return std::isfinite(v); }))
                throw std::runtime_error("Invalid punctuation scores");
            result.append(int(std::max_element(row, row + marks.size()) - row));
        }
        return result;
    }
    QVector<int> incremental(const QVector<int32_t> &tokens) {
        QVector<int> result(tokens.size());
        int start = 0;
        for (int right = qMin(20, int(tokens.size()));; right = qMin(right + 20, int(tokens.size()))) {
            auto local = predict(tokens.mid(start, right - start));
            int commit = -1, comma = -1;
            for (int i = int(local.size()) - 2; i >= 1; --i) {
                const auto &mark = marks[local[i]];
                if (mark == "。" || mark == "？") { commit = i; break; }
                if (comma < 0 && mark == "，") comma = i;
            }
            if (commit < 0 && local.size() >= 200 && comma >= 0) {
                commit = comma;
                local[commit] = marks.indexOf("。");
            }
            if (right == tokens.size()) commit = int(local.size()) - 1;
            // Malformed/unpunctuated input must not grow attention indefinitely.
            if (commit < 0 && local.size() >= 480) commit = 255;
            for (int i = 0; i <= commit; ++i) result[start + i] = local[i];
            start += commit + 1;
            if (right == tokens.size()) break;
        }
        return result;
    }
};

PunctuationModel::PunctuationModel(const QString &runtime, const QString &model) : m_impl(std::make_unique<Impl>()) {
    m_impl->initialize(runtime, model);
}
PunctuationModel::~PunctuationModel() = default;

QString PunctuationModel::punctuate(const QString &text) {
    struct Token { int start, end; bool protectedText; };
    QVector<Token> tokens;
    QVector<int32_t> ids;
    // Preserve source spelling/spacing and keep punctuation out of URLs, code,
    // addresses and numeric expressions. Han characters are individual tokens.
    static const QRegularExpression pattern(
        "(`[^`]*`|https?://[^\\s，。！？；]+|[\\w.+-]+@[\\w.-]+|[0-9]+(?:[.:/-][0-9]+)+)"
        "|[A-Za-zÀ-ÿ0-9]+(?:['’][A-Za-zÀ-ÿ0-9]+)*|[^\\s]",
        QRegularExpression::UseUnicodePropertiesOption);
    auto matches = pattern.globalMatch(text);
    while (matches.hasNext()) {
        const auto match = matches.next();
        tokens.append({int(match.capturedStart()), int(match.capturedEnd()), !match.captured(1).isEmpty()});
        ids.append(m_impl->vocabulary.value(match.captured().toLower(), m_impl->unknown));
    }
    if (tokens.isEmpty()) return text;
    QVector<int> labels(tokens.size());
    if (tokens.size() <= 512) {
        labels = m_impl->predict(ids);
    } else {
        // Bound attention/memory. Commit only the centre of each window, with
        // real left/right context, never artificial sentence endings per chunk.
        for (int at = 0; at < tokens.size(); at += 256) {
            const int begin = qMax(0, at - 128);
            const int finish = qMin(int(tokens.size()), at + 384);
            const auto local = m_impl->predict(ids.mid(begin, finish - begin));
            for (int i = at; i < qMin(at + 256, int(tokens.size())); ++i) labels[i] = local[i - begin];
        }
    }
    const auto provisional = m_impl->incremental(ids);
    // Preserve the established comma/list choices. Use the full right context
    // to withdraw premature full stops, rather than rewriting every mark.
    for (int i = 0; i < labels.size(); ++i) {
        const auto &confirmed = m_impl->marks[labels[i]];
        if (i + 1 == labels.size() || m_impl->marks[provisional[i]] != "。" ||
            confirmed == "。" || confirmed == "？") labels[i] = provisional[i];
    }
    QString result;
    int copied = 0;
    for (int i = 0; i < tokens.size(); ++i) {
        const auto &token = tokens[i];
        result += text.mid(copied, token.end - copied);
        copied = token.end;
        auto mark = m_impl->marks[labels[i]];
        if (mark != "，" && mark != "。" && mark != "？" && mark != "、") continue;
        const bool last = i + 1 == tokens.size();
        // Existing punctuation (including quotes and code) belongs to the source.
        if (token.protectedText || text[token.end - 1].isPunct() ||
            (!last && text[tokens[i + 1].start].isPunct())) continue;
        if (last && (mark == "，" || mark == "、")) mark = "。";
        result += mark;
    }
    result += text.mid(copied);
    // Add a terminal mark only at the true end, never at a context-window edge.
    const auto trimmed = result.trimmed();
    if (!trimmed.isEmpty() && !trimmed.back().isPunct() && !tokens.back().protectedText) {
        // Keep original leading/trailing whitespace unchanged.
        int end = result.size();
        while (end > 0 && result[end - 1].isSpace()) --end;
        result.insert(end, "。");
    }
    return result;
}
