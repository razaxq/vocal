#include "SentenceWorker.h"
#include "ModelCatalog.h"
#include "SentenceCorrection.h"
#include "llama.h"
#include <QElapsedTimer>
#include <QJsonArray>
#include <QJsonDocument>
#include <QRegularExpression>
#include <QThread>
#include <iostream>
#include <memory>
#include <stdexcept>
#include <vector>

namespace {
QString option(const QStringList &args, const QString &name) {
    const int at = args.indexOf(name);
    return at >= 0 && at + 1 < args.size() ? args[at + 1] : QString{};
}
void send(const QJsonObject &event) {
    std::cout << QJsonDocument(event).toJson(QJsonDocument::Compact).constData() << std::endl;
}
struct Deadline {
    QElapsedTimer timer;
    qint64 limit = 30000;
    static bool abort(void *data) {
        auto *self = static_cast<Deadline *>(data);
        return self->timer.elapsed() >= self->limit;
    }
};
class SentenceModel {
    using Model = std::unique_ptr<llama_model, decltype(&llama_model_free)>;
    using Context = std::unique_ptr<llama_context, decltype(&llama_free)>;
    Model model{nullptr, llama_model_free};
    Context context{nullptr, llama_free};
    Deadline deadline;
    const llama_vocab *vocab = nullptr;
    void tokenize(std::vector<llama_token> &tokens, const QString &text, bool special) {
        const auto bytes = text.toUtf8();
        const int size = -llama_tokenize(vocab, bytes.constData(), bytes.size(), nullptr, 0, false, special);
        if (size <= 0) return;
        const auto at = tokens.size();
        tokens.resize(at + size);
        if (llama_tokenize(vocab, bytes.constData(), bytes.size(), tokens.data() + at, size, false, special) != size)
            throw std::runtime_error("句子纠错分词失败");
    }
  public:
    explicit SentenceModel(const QString &path) {
#if defined(__GNUC__) && defined(__x86_64__)
        if (!__builtin_cpu_supports("avx2") || !__builtin_cpu_supports("fma") || !__builtin_cpu_supports("f16c") ||
            !__builtin_cpu_supports("bmi2"))
            throw std::runtime_error("此句子纠错模型需要支持 AVX2/FMA/F16C 的处理器，请改用 MacBERT");
#endif
        llama_log_set([](ggml_log_level level, const char *text, void *) {
            if (level == GGML_LOG_LEVEL_WARN || level == GGML_LOG_LEVEL_ERROR) std::cerr << text;
        }, nullptr);
        llama_backend_init();
        auto parameters = llama_model_default_params();
        parameters.n_gpu_layers = 0;
        model.reset(llama_model_load_from_file(path.toUtf8().constData(), parameters));
        if (!model) throw std::runtime_error("句子纠错模型加载失败，请重新下载模型");
        vocab = llama_model_get_vocab(model.get());
        auto config = llama_context_default_params();
        config.n_ctx = 2048;
        config.n_batch = 512;
        config.n_ubatch = 128;
        config.n_threads = config.n_threads_batch = qBound(1, QThread::idealThreadCount() / 2, 6);
        config.abort_callback = Deadline::abort;
        config.abort_callback_data = &deadline;
        deadline.timer.start();
        context.reset(llama_init_from_model(model.get(), config));
        if (!context) throw std::runtime_error("句子纠错运行内存不足，或模型格式不受支持");
    }
    QString generate(const QString &source, qint64 limit, QString &reason) {
        deadline.limit = limit;
        deadline.timer.restart();
        llama_memory_clear(llama_get_memory(context.get()), true);
        std::vector<llama_token> tokens;
        // Qwen3 ChatML with an empty thinking block, equivalent to the model
        // author's enable_thinking=False example. Never parse user text as control tokens.
        tokenize(tokens, "<|im_start|>user\n", true);
        tokenize(tokens, QStringLiteral("你是一个文本纠错专家，纠正输入句子中的语法错误，并输出正确的句子，输入句子为：") + source, false);
        tokenize(tokens, "<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n", true);
        const int maximum = qMin(512, qMax(64, int(source.size() * 2 + 32)));
        if (tokens.size() + maximum >= llama_n_ctx(context.get())) { reason = "context-limit"; return {}; }
        for (size_t at = 0; at < tokens.size(); at += 512) {
            const auto count = int(qMin(size_t(512), tokens.size() - at));
            if (llama_decode(context.get(), llama_batch_get_one(tokens.data() + at, count))) {
                reason = Deadline::abort(&deadline) ? "timeout" : "decode-error";
                return {};
            }
        }
        std::unique_ptr<llama_sampler, decltype(&llama_sampler_free)> sampler(llama_sampler_init_greedy(), llama_sampler_free);
        QByteArray output;
        for (int i = 0; i < maximum; ++i) {
            if (Deadline::abort(&deadline)) { reason = "timeout"; return {}; }
            auto token = llama_sampler_sample(sampler.get(), context.get(), -1);
            if (llama_vocab_is_eog(vocab, token)) return QString::fromUtf8(output);
            char buffer[256];
            const int count = llama_token_to_piece(vocab, token, buffer, sizeof(buffer), 0, true);
            if (count < 0) { reason = "token-error"; return {}; }
            output.append(buffer, count);
            if (llama_decode(context.get(), llama_batch_get_one(&token, 1))) {
                reason = Deadline::abort(&deadline) ? "timeout" : "decode-error";
                return {};
            }
        }
        reason = "output-limit"; // Never apply a truncated completion.
        return {};
    }
};
}

int runSentenceWorker(const QStringList &args) {
    try {
        ModelCatalog catalog(option(args, "--model-dir"));
        const auto entry = catalog.find(option(args, "--model-id"));
        if (entry["kind"] != "correction-gguf" || !catalog.installed(entry))
            throw std::runtime_error("句子纠错模型尚未下载完成");
        SentenceModel model(catalog.file(entry, "model"));
        send({{"type", "ready"}, {"backend", "llama.cpp-cpu"}});
        std::string line;
        while (std::getline(std::cin, line)) {
            const auto request = QJsonDocument::fromJson(QByteArray::fromStdString(line)).object();
            if (request["type"] == "quit") break;
            if (request["type"] != "correct") continue;
            const auto source = request["text"].toString();
            QStringList words;
            for (const auto &word : request["hotwords"].toArray()) words.append(word.toString());
            QElapsedTimer timer;
            timer.start();
            QString result;
            QJsonArray trace;
            int applied = 0;
            for (const auto &chunk : sentenceCorrectionChunks(source)) {
                QString reason, generated, candidate;
                const auto remaining = 120000 - timer.elapsed();
                if (remaining <= 0) reason = "timeout";
                else if (!QRegularExpression("[\\p{Han}]").match(chunk).hasMatch()) reason = "non-chinese";
                else {
                    generated = model.generate(chunk, qMin(qint64(45000), remaining), reason);
                    if (reason.isEmpty()) {
                        candidate = sentenceCorrectionCandidate(chunk, generated);
                        reason = sentenceCorrectionRejection(chunk, candidate, words);
                    }
                }
                const bool accepted = reason.isEmpty();
                result += accepted ? candidate : chunk;
                applied += accepted && candidate != chunk;
                if (request["debugTrace"].toBool()) trace.append(QJsonObject{{"source", chunk},
                    {"generated", generated}, {"text", accepted ? candidate : chunk},
                    {"decision", accepted ? (candidate == chunk ? "unchanged" : "applied") : reason}});
            }
            // Catch protected words/identifiers straddling a chunk boundary too.
            const auto protectedReason = sentenceCorrectionProtectedRejection(source, result, words);
            if (!protectedReason.isEmpty()) { result = source; applied = 0; }
            QJsonObject response{{"type", "result"}, {"id", request["id"]}, {"text", result},
                {"elapsedMs", timer.elapsed()}, {"backend", "llama.cpp-cpu"}, {"appliedChunks", applied}};
            if (!protectedReason.isEmpty()) response["fallback"] = protectedReason;
            if (request["debugTrace"].toBool()) response["correctionTrace"] = trace;
            send(response);
        }
        return 0;
    } catch (const std::exception &error) {
        send({{"type", "error"}, {"message", QString::fromUtf8(error.what())}});
        return 1;
    }
}
