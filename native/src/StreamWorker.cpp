#include "StreamWorker.h"
#include "ModelCatalog.h"
#include "sherpa-onnx/c-api.h"
#include <QCoreApplication>
#include <QDir>
#include <QJsonDocument>
#include <QLibrary>
#include <QVector>
#include <cmath>
#include <cstring>
#include <iostream>
#include <stdexcept>

namespace {
QString option(const QStringList &args, const QString &key, QString fallback = {}) {
    const int i = args.indexOf(key);
    return i >= 0 && i + 1 < args.size() ? args[i + 1] : fallback;
}
void send(const QJsonObject &event) {
    std::cout << QJsonDocument(event).toJson(QJsonDocument::Compact).constData() << std::endl;
}
class Streaming {
    QLibrary library;
    const SherpaOnnxOnlineRecognizer *recognizer = nullptr;
    const SherpaOnnxOnlineStream *stream = nullptr;
#define API(name) decltype(&name) name = nullptr
    API(SherpaOnnxGetVersionStr);
    API(SherpaOnnxCreateOnlineRecognizer);
    API(SherpaOnnxDestroyOnlineRecognizer);
    API(SherpaOnnxCreateOnlineStream);
    API(SherpaOnnxDestroyOnlineStream);
    API(SherpaOnnxOnlineStreamAcceptWaveform);
    API(SherpaOnnxIsOnlineStreamReady);
    API(SherpaOnnxDecodeOnlineStream);
    API(SherpaOnnxGetOnlineStreamResult);
    API(SherpaOnnxDestroyOnlineRecognizerResult);
    API(SherpaOnnxOnlineStreamInputFinished);
#undef API
  public:
    Streaming(const QString &runtime, const ModelCatalog &catalog, const QString &id) : library(runtime) {
        if (!library.load())
            throw std::runtime_error(library.errorString().toStdString());
#define LOAD(name)                                                                                                     \
    name = reinterpret_cast<decltype(name)>(library.resolve(#name));                                                   \
    if (!name)                                                                                                         \
    throw std::runtime_error("Missing streaming ABI: " #name)
        LOAD(SherpaOnnxGetVersionStr);
        LOAD(SherpaOnnxCreateOnlineRecognizer);
        LOAD(SherpaOnnxDestroyOnlineRecognizer);
        LOAD(SherpaOnnxCreateOnlineStream);
        LOAD(SherpaOnnxDestroyOnlineStream);
        LOAD(SherpaOnnxOnlineStreamAcceptWaveform);
        LOAD(SherpaOnnxIsOnlineStreamReady);
        LOAD(SherpaOnnxDecodeOnlineStream);
        LOAD(SherpaOnnxGetOnlineStreamResult);
        LOAD(SherpaOnnxDestroyOnlineRecognizerResult);
        LOAD(SherpaOnnxOnlineStreamInputFinished);
#undef LOAD
        const auto version = QString::fromUtf8(SherpaOnnxGetVersionStr());
        if (version != "1.13.8" && version != "v1.13.8")
            throw std::runtime_error("Unsupported sherpa ABI");
        const auto entry = catalog.find(id);
        if (!catalog.installed(entry))
            throw std::runtime_error("流式模型尚未下载");
        const auto encoder = catalog.file(entry, "encoder").toUtf8(), decoder = catalog.file(entry, "decoder").toUtf8();
        const auto joiner = catalog.file(entry, "joiner").toUtf8(), tokens = catalog.file(entry, "tokens").toUtf8();
        SherpaOnnxOnlineRecognizerConfig config{};
        config.feat_config.sample_rate = 16000;
        config.feat_config.feature_dim = 80;
        config.model_config.tokens = tokens.constData();
        config.model_config.num_threads = 2;
        config.model_config.provider = "cpu";
        config.decoding_method = "greedy_search";
        if (entry["kind"] == "online-paraformer") {
            config.model_config.paraformer.encoder = encoder.constData();
            config.model_config.paraformer.decoder = decoder.constData();
        } else if (entry["kind"] == "online-zipformer") {
            config.model_config.transducer.encoder = encoder.constData();
            config.model_config.transducer.decoder = decoder.constData();
            config.model_config.transducer.joiner = joiner.constData();
        } else
            throw std::runtime_error("Unsupported streaming model");
        recognizer = SherpaOnnxCreateOnlineRecognizer(&config);
        if (!recognizer)
            throw std::runtime_error("流式模型加载失败");
    }
    ~Streaming() {
        if (stream)
            SherpaOnnxDestroyOnlineStream(stream);
        if (recognizer)
            SherpaOnnxDestroyOnlineRecognizer(recognizer);
    }
    void reset() {
        if (stream)
            SherpaOnnxDestroyOnlineStream(stream);
        stream = SherpaOnnxCreateOnlineStream(recognizer);
        if (!stream)
            throw std::runtime_error("Cannot create stream");
    }
    QString audio(const QJsonObject &request, bool finish) {
        if (!stream)
            throw std::runtime_error("Stream was not started");
        if (!finish) {
            const int rate = request["sampleRate"].toInt();
            const auto bytes = QByteArray::fromBase64(request["samples"].toString().toLatin1());
            if (rate < 8000 || rate > 192000 || bytes.size() % 4 || bytes.size() > rate * 4 * 120)
                throw std::runtime_error("Invalid stream audio");
            QVector<float> samples(bytes.size() / 4);
            memcpy(samples.data(), bytes.data(), bytes.size());
            for (auto &sample : samples)
                if (!std::isfinite(sample))
                    sample = 0;
            SherpaOnnxOnlineStreamAcceptWaveform(stream, rate, samples.data(), samples.size());
        } else {
            QVector<float> silence(8000, 0);
            SherpaOnnxOnlineStreamAcceptWaveform(stream, 16000, silence.data(), silence.size());
            SherpaOnnxOnlineStreamInputFinished(stream);
        }
        while (SherpaOnnxIsOnlineStreamReady(recognizer, stream))
            SherpaOnnxDecodeOnlineStream(recognizer, stream);
        const auto *r = SherpaOnnxGetOnlineStreamResult(recognizer, stream);
        const auto text = r ? QString::fromUtf8(r->text).trimmed() : QString{};
        if (r)
            SherpaOnnxDestroyOnlineRecognizerResult(r);
        return text;
    }
};
} // namespace
int runStreamWorker(const QStringList &args) {
    try {
#if defined(Q_OS_WIN)
        const QString lib = "sherpa-onnx-c-api.dll";
#elif defined(Q_OS_MACOS)
        const QString lib = "libsherpa-onnx-c-api.dylib";
#else
        const QString lib = "libsherpa-onnx-c-api.so";
#endif
        Streaming worker(option(args, "--runtime", QDir(QCoreApplication::applicationDirPath()).filePath(lib)),
                         ModelCatalog(option(args, "--model-dir")), option(args, "--model-id"));
        send({{"type", "ready"}});
        std::string line;
        int id = -1;
        while (std::getline(std::cin, line)) {
            if (line.size() > 32 * 1024 * 1024)
                throw std::runtime_error("Stream request too large");
            const auto request = QJsonDocument::fromJson(QByteArray::fromStdString(line)).object();
            const auto type = request["type"].toString();
            if (type == "quit")
                break;
            if (type == "start") {
                worker.reset();
                id = request["id"].toInt();
                continue;
            }
            if (request["id"].toInt() != id || (type != "audio" && type != "finish"))
                continue;
            send({{"type", type == "finish" ? "result" : "partial"},
                  {"id", id},
                  {"text", worker.audio(request, type == "finish")}});
        }
        return 0;
    } catch (const std::exception &e) {
        send({{"type", "error"}, {"message", QString::fromUtf8(e.what())}});
        return 1;
    }
}
