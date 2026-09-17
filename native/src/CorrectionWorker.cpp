#include "CorrectionWorker.h"
#include "CorrectionGuard.h"
#include "Dictionary.h"
#include "ModelCatalog.h"
#if defined(__MINGW32__) && !defined(_Frees_ptr_opt_)
// MinGW's SAL compatibility header omits this annotation; it has no ABI effect.
#define _Frees_ptr_opt_
#endif
#include "onnxruntime/onnxruntime_c_api.h"
#include <QCoreApplication>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QLibrary>
#include <QRegularExpression>
#include <QSet>
#include <cmath>
#include <iostream>
#include <stdexcept>

namespace {
QString option(const QStringList &args, const QString &name, QString fallback = {}) {
    const int at = args.indexOf(name);
    return at >= 0 && at + 1 < args.size() ? args[at + 1] : fallback;
}
void send(const QJsonObject &value) {
    std::cout << QJsonDocument(value).toJson(QJsonDocument::Compact).constData() << std::endl;
}
struct Token {
    int id, start, end;
};
struct Edit {
    int start;
    QString source, target;
    double margin;
    bool contextual = false;
};
struct WordSpan {
    int at;
    QString text;
};
QList<WordSpan> wordSegments(const QString &text) {
#ifdef Q_OS_WIN
    // Windows ships ICU's word breaker. This is the same segmentation family
    // used by Intl.Segmenter in the previous UI runtime, with no JS dependency.
    static QLibrary icu("icu");
    using Open = void *(*)(int, const char *, const char16_t *, int, int *);
    using Step = int (*)(void *);
    using Close = void (*)(void *);
    static auto open = reinterpret_cast<Open>(icu.resolve("ubrk_open"));
    static auto first = reinterpret_cast<Step>(icu.resolve("ubrk_first"));
    static auto next = reinterpret_cast<Step>(icu.resolve("ubrk_next"));
    static auto close = reinterpret_cast<Close>(icu.resolve("ubrk_close"));
    if (open && first && next && close) {
        int status = 0;
        void *iterator = open(1, "zh", reinterpret_cast<const char16_t *>(text.utf16()), text.size(), &status);
        if (iterator && status <= 0) {
            QList<WordSpan> spans;
            int start = first(iterator);
            for (int end = next(iterator); end >= 0; end = next(iterator)) {
                spans.append({start, text.mid(start, end - start)});
                start = end;
            }
            close(iterator);
            return spans;
        }
        if (iterator)
            close(iterator);
    }
#endif
    // Conservative fallback: without a language word breaker, use no masked
    // word edits. Direct CSC corrections retain their confidence guards.
    return {};
}
class Corrector {
    QLibrary library;
    const OrtApi *api = nullptr;
    OrtEnv *env = nullptr;
    OrtSessionOptions *options = nullptr;
    OrtSession *session = nullptr;
    OrtMemoryInfo *memory = nullptr;
    OrtAllocator *allocator = nullptr;
    QStringList vocab;
    QHash<QString, int> ids;
    QList<QByteArray> inputNames;
    bool csc = true;
    void check(OrtStatus *status) {
        if (!status)
            return;
        const auto message = QString::fromUtf8(api->GetErrorMessage(status));
        api->ReleaseStatus(status);
        throw std::runtime_error(message.toStdString());
    }
    QList<Token> tokenize(const QString &text) const {
        QList<Token> result{{ids["[CLS]"], -1, -1}};
        auto matches = QRegularExpression("[\\p{Han}]|[\\p{P}\\p{S}]|[^\\s\\p{Han}\\p{P}\\p{S}]+").globalMatch(text);
        while (matches.hasNext()) {
            const auto match = matches.next();
            const auto word = match.captured().toLower();
            QList<Token> pieces;
            for (int start = 0; start < word.size();) {
                int end = word.size(), id = -1;
                while (end > start) {
                    id = ids.value((start ? "##" : "") + word.mid(start, end - start), -1);
                    if (id >= 0)
                        break;
                    --end;
                }
                if (id < 0) {
                    pieces = {{ids["[UNK]"], int(match.capturedStart()), int(match.capturedEnd())}};
                    break;
                }
                pieces.append({id, int(match.capturedStart()) + start, int(match.capturedStart()) + end});
                start = end;
            }
            result.append(pieces);
        }
        result.append({ids["[SEP]"], -1, -1});
        return result;
    }
    QVector<float> predict(const QList<Token> &tokens, int maskStart = -1, int maskEnd = -1) {
        QVector<int64_t> input, attention(tokens.size(), 1), types(tokens.size(), 0);
        for (const auto &token : tokens)
            input.append(maskStart >= 0 && token.start >= maskStart && token.end <= maskEnd ? ids["[MASK]"] : token.id);
        int64_t shape[]{1, tokens.size()};
        QVector<OrtValue *> feeds;
        QVector<const char *> names;
        OrtValue *out = nullptr;
        try {
            for (const auto &name : inputNames) {
                auto &data = name == "input_ids" ? input : name == "attention_mask" ? attention : types;
                OrtValue *tensor = nullptr;
                check(api->CreateTensorWithDataAsOrtValue(memory, data.data(), data.size() * sizeof(int64_t), shape, 2,
                                                          ONNX_TENSOR_ELEMENT_DATA_TYPE_INT64, &tensor));
                feeds.append(tensor);
                names.append(name.constData());
            }
            const char *output = "logits";
            check(api->Run(session, nullptr, names.data(), const_cast<const OrtValue *const *>(feeds.data()),
                           feeds.size(), &output, 1, &out));
            OrtTensorTypeAndShapeInfo *info = nullptr;
            check(api->GetTensorTypeAndShape(out, &info));
            size_t size = 0;
            check(api->GetTensorShapeElementCount(info, &size));
            api->ReleaseTensorTypeAndShapeInfo(info);
            if (size != size_t(tokens.size() * vocab.size()))
                throw std::runtime_error("Unexpected correction output shape");
            float *values = nullptr;
            check(api->GetTensorMutableData(out, reinterpret_cast<void **>(&values)));
            QVector<float> result(values, values + size);
            api->ReleaseValue(out);
            for (auto *feed : feeds)
                api->ReleaseValue(feed);
            return result;
        } catch (...) {
            if (out)
                api->ReleaseValue(out);
            for (auto *feed : feeds)
                api->ReleaseValue(feed);
            throw;
        }
    }

  public:
    Corrector(const QString &runtime, const ModelCatalog &catalog, const QString &id) : library(runtime) {
        if (!library.load())
            throw std::runtime_error(library.errorString().toStdString());
        const auto getApi = reinterpret_cast<decltype(&OrtGetApiBase)>(library.resolve("OrtGetApiBase"));
        if (!getApi || !(api = getApi()->GetApi(ORT_API_VERSION)))
            throw std::runtime_error("Unsupported ONNX Runtime C API");
        const auto entry = catalog.find(id);
        if (!catalog.installed(entry))
            throw std::runtime_error("Correction model files missing");
        QFile vocabulary(catalog.file(entry, "vocab"));
        if (!vocabulary.open(QIODevice::ReadOnly))
            throw std::runtime_error("Cannot read vocabulary");
        vocab = QString::fromUtf8(vocabulary.readAll()).trimmed().split(QRegularExpression("\\r?\\n"));
        for (int i = 0; i < vocab.size(); ++i)
            ids[vocab[i]] = i;
        for (const auto &token : {"[CLS]", "[SEP]", "[MASK]", "[UNK]"})
            if (!ids.contains(token))
                throw std::runtime_error("Invalid vocabulary");
        csc = entry["correctionMode"].toString() == "csc";
        check(api->CreateEnv(ORT_LOGGING_LEVEL_ERROR, "Vocal", &env));
        check(api->CreateSessionOptions(&options));
        check(api->SetIntraOpNumThreads(options, 2));
        check(api->SetInterOpNumThreads(options, 1));
        check(api->SetSessionGraphOptimizationLevel(options, ORT_ENABLE_ALL));
        const auto path = catalog.file(entry, "model");
#ifdef Q_OS_WIN
        check(api->CreateSession(env, reinterpret_cast<const wchar_t *>(path.utf16()), options, &session));
#else
        check(api->CreateSession(env, path.toUtf8().constData(), options, &session));
#endif
        check(api->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault, &memory));
        check(api->GetAllocatorWithDefaultOptions(&allocator));
        size_t count = 0;
        check(api->SessionGetInputCount(session, &count));
        for (size_t i = 0; i < count; ++i) {
            char *name = nullptr;
            check(api->SessionGetInputName(session, i, allocator, &name));
            const QByteArray copy(name);
            allocator->Free(allocator, name);
            if (copy != "input_ids" && copy != "attention_mask" && copy != "token_type_ids")
                throw std::runtime_error("Unsupported correction input");
            inputNames.append(copy);
        }
    }
    ~Corrector() {
        if (memory)
            api->ReleaseMemoryInfo(memory);
        if (session)
            api->ReleaseSession(session);
        if (options)
            api->ReleaseSessionOptions(options);
        if (env)
            api->ReleaseEnv(env);
    }
    QString correct(const QString &text, const QStringList &protectedWords, const Dictionary &dictionary,
                    bool useDictionary, bool fullContext = false) {
        QSet<int> protectedAt;
        auto mark = [&](int at, int length) {
            for (int i = at; i < at + length; ++i)
                protectedAt.insert(i);
        };
        for (const auto &pattern :
             {QString("`[^`]*`|https?://\\S+|[\\w.+-]+@[\\w.-]+|[A-Za-z0-9_][A-Za-z0-9_.:+/#@-]*"),
              QString("[零〇一二三四五六七八九十百千万亿两]+(?:[点年月日号时分秒元块个岁度成倍%％])?")}) {
            auto matches = QRegularExpression(pattern).globalMatch(text);
            while (matches.hasNext()) {
                auto m = matches.next();
                mark(m.capturedStart(), m.capturedLength());
            }
        }
        for (const auto &word : protectedWords)
            if (!word.isEmpty())
                for (int at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1))
                    mark(at, word.size());
        QList<Edit> edits;
        QElapsedTimer budget;
        budget.start();
        for (int offset = 0; offset < text.size() && (fullContext || budget.elapsed() < 2000); offset += 96) {
            // The final pass covers every context window, rather than spending
            // the entire latency budget on the beginning of a long transcript.
            if (fullContext)
                budget.restart();
            const int start = qMax(0, offset - 16);
            const auto chunk = text.mid(start, offset + 112 - start);
            const auto tokens = tokenize(chunk);
            auto eligible = [&](int at, int length) {
                if (at < offset || at + length > offset + 96)
                    return false;
                for (int j = at; j < at + length; ++j)
                    if (protectedAt.contains(j))
                        return false;
                return true;
            };
            if (csc) {
                const auto logits = predict(tokens);
                for (int i = 0; i < tokens.size(); ++i) {
                    auto token = tokens[i];
                    if (token.start < 0 || token.end - token.start != 1 || !eligible(start + token.start, 1))
                        continue;
                    const auto source = chunk.mid(token.start, 1);
                    const float *row = logits.constData() + i * vocab.size();
                    int best = int(std::max_element(row, row + vocab.size()) - row);
                    const auto target = vocab[best];
                    // CSC is trained to correct spelling using context, including
                    // non-homophones. Only permit single Han tokens: special tokens,
                    // WordPieces, punctuation and Latin text are not replacements.
                    if (target == source || !isHanCharacterEdit(source, target))
                        continue;
                    const bool homophone = dictionary.similarSound(source, target);
                    const double margin = row[best] - row[token.id];
                    double sum = 0;
                    for (int j = 0; j < vocab.size(); ++j)
                        sum += std::exp(row[j] - row[best]);
                    // Require stronger evidence without a phonetic match. These
                    // thresholds are model scores, not calibrated accuracy rates.
                    if (1 / sum >= (homophone ? .98 : .995) && margin >= (homophone ? 4 : 6))
                        edits.append({start + token.start, source, target, margin, true});
                }
            }
            if (!useDictionary)
                continue;
            struct Span {
                int at;
                QString source;
                bool known;
            };
            QList<Span> spans;
            const auto segments = wordSegments(chunk);
            static const QRegularExpression hanWord("^[\\p{Han}]{2,4}$"), hanChar("^[\\p{Han}]$");
            for (int i = 0; i < segments.size(); ++i) {
                const auto &segment = segments[i];
                if (hanWord.match(segment.text).hasMatch())
                    spans.append({segment.at, segment.text, true});
                if (hanChar.match(segment.text).hasMatch() && i + 1 < segments.size() &&
                    hanChar.match(segments[i + 1].text).hasMatch())
                    spans.append({segment.at, segment.text + segments[i + 1].text, false});
            }
            std::stable_sort(spans.begin(), spans.end(), [](auto a, auto b) { return a.known < b.known; });
            int evaluated = 0;
            for (const auto &span : spans) {
                if (budget.elapsed() >= 2000 || evaluated >= 12)
                    break;
                if (!eligible(start + span.at, span.source.size()))
                    continue;
                auto candidates = dictionary.homophones(span.source);
                candidates.prepend(span.source);
                candidates.erase(std::remove_if(candidates.begin(), candidates.end(),
                                                [&](const auto &w) {
                                                    for (auto ch : w)
                                                        if (!ids.contains(QString(ch)))
                                                            return true;
                                                    return false;
                                                }),
                                 candidates.end());
                if (candidates.size() < 2)
                    continue;
                QList<int> positions;
                for (int i = 0; i < tokens.size(); ++i)
                    if (tokens[i].start >= span.at && tokens[i].end <= span.at + span.source.size() &&
                        tokens[i].end - tokens[i].start == 1)
                        positions.append(i);
                if (positions.size() != span.source.size())
                    continue;
                ++evaluated;
                const auto logits = predict(tokens, span.at, span.at + span.source.size());
                QList<QPair<double, QString>> scores;
                double original = 0;
                for (const auto &candidate : candidates) {
                    double score = 0;
                    for (int i = 0; i < candidate.size(); ++i)
                        score += logits[positions[i] * vocab.size() + ids[QString(candidate[i])]];
                    scores.append({score, candidate});
                    if (candidate == span.source)
                        original = score;
                }
                std::sort(scores.begin(), scores.end(), [](auto a, auto b) { return a.first > b.first; });
                const double margin = scores[0].first - original;
                if (scores[0].second != span.source && margin >= (span.known ? 8 : 3.8) &&
                    scores[0].first - scores[1].first >= 2.5)
                    edits.append({start + span.at, span.source, scores[0].second, margin});
            }
        }
        std::sort(edits.begin(), edits.end(), [](auto a, auto b) { return a.margin > b.margin; });
        QList<Edit> accepted;
        for (const auto &edit : edits) {
            bool occupied = false;
            for (int i = edit.start; i < edit.start + edit.source.size(); ++i)
                occupied |= protectedAt.contains(i);
            if (occupied || !preservesNumericCharacters(edit.source, edit.target) ||
                (!edit.contextual && !dictionary.similarSound(edit.source, edit.target)))
                continue;
            accepted.append(edit);
            mark(edit.start, edit.source.size());
        }
        std::sort(accepted.begin(), accepted.end(), [](auto a, auto b) { return a.start > b.start; });
        QString output = text;
        for (const auto &edit : accepted)
            output.replace(edit.start, edit.source.size(), edit.target);
        return output;
    }
};
} // namespace
int runCorrectionWorker(const QStringList &args) {
    try {
        ModelCatalog catalog(option(args, "--model-dir"));
#ifdef Q_OS_WIN
        const QString library = "onnxruntime.dll";
#elif defined(Q_OS_MACOS)
        const QString library = "libonnxruntime.dylib";
#else
        const QString library = "libonnxruntime.so";
#endif
        const auto runtime = option(args, "--runtime", QDir(QCoreApplication::applicationDirPath()).filePath(library));
        Corrector corrector(runtime, catalog, option(args, "--model-id", "macbert4csc"));
        Dictionary dictionary;
        if (!dictionary.load(option(args, "--dictionary")))
            throw std::runtime_error("纠错词库未找到");
        send({{"type", "ready"}});
        std::string line;
        while (std::getline(std::cin, line)) {
            const auto request = QJsonDocument::fromJson(QByteArray::fromStdString(line)).object();
            if (request["type"] == "quit")
                break;
            if (request["type"] == "dictionary:update") {
                Dictionary next;
                if (next.load(request["path"].toString()))
                    dictionary = std::move(next);
                continue;
            }
            if (request["type"] != "correct")
                continue;
            QStringList words;
            for (auto word : request["hotwords"].toArray())
                words.append(word.toString());
            QElapsedTimer timer;
            timer.start();
            const auto text = corrector.correct(request["text"].toString(), words, dictionary,
                                                request["dictionaryEnabled"].toBool(true),
                                                request["fullContext"].toBool(false));
            send({{"type", "result"}, {"id", request["id"]}, {"text", text}, {"elapsedMs", timer.elapsed()}});
        }
        return 0;
    } catch (const std::exception &error) {
        send({{"type", "error"}, {"message", QString::fromUtf8(error.what())}});
        return 1;
    }
}
