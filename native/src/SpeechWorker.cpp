#include "SpeechWorker.h"
#include "AudioCapture.h"
#include "Dictionary.h"
#include "ModelCatalog.h"
#include "sherpa-onnx/c-api.h"
#include <QCoreApplication>
#include <QDir>
#include <QElapsedTimer>
#include <QFile>
#include <QJsonArray>
#include <QJsonDocument>
#include <QLibrary>
#include <cstring>
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
class Recognizer {
    QLibrary library;
    const SherpaOnnxOfflineRecognizer *recognizer = nullptr;
    const SherpaOnnxOfflinePunctuation *punctuation = nullptr;
    bool hotwordSupport = false;
    Dictionary dictionary;
    template <class T> T resolve(const char *name) {
        auto symbol = library.resolve(name);
        if (!symbol)
            throw std::runtime_error(library.errorString().toStdString());
        return reinterpret_cast<T>(symbol);
    }
#define API(name) decltype(&name) name = nullptr
    API(SherpaOnnxGetVersionStr);
    API(SherpaOnnxCreateOfflineRecognizer);
    API(SherpaOnnxDestroyOfflineRecognizer);
    API(SherpaOnnxCreateOfflineStream);
    API(SherpaOnnxCreateOfflineStreamWithHotwords);
    API(SherpaOnnxDestroyOfflineStream);
    API(SherpaOnnxAcceptWaveformOffline);
    API(SherpaOnnxDecodeOfflineStream);
    API(SherpaOnnxGetOfflineStreamResult);
    API(SherpaOnnxDestroyOfflineRecognizerResult);
    API(SherpaOnnxReadWave);
    API(SherpaOnnxFreeWave);
    API(SherpaOnnxCreateOfflinePunctuation);
    API(SherpaOnnxDestroyOfflinePunctuation);
    API(SherpaOfflinePunctuationAddPunct);
    API(SherpaOfflinePunctuationFreeText);
#undef API
  public:
    Recognizer(const QString &runtime, const ModelCatalog &catalog, const QString &id) : library(runtime) {
        if (!library.load())
            throw std::runtime_error(library.errorString().toStdString());
#define LOAD(name) name = resolve<decltype(name)>(#name)
        LOAD(SherpaOnnxGetVersionStr);
        LOAD(SherpaOnnxCreateOfflineRecognizer);
        LOAD(SherpaOnnxDestroyOfflineRecognizer);
        LOAD(SherpaOnnxCreateOfflineStream);
        LOAD(SherpaOnnxDestroyOfflineStream);
        LOAD(SherpaOnnxCreateOfflineStreamWithHotwords);
        LOAD(SherpaOnnxAcceptWaveformOffline);
        LOAD(SherpaOnnxDecodeOfflineStream);
        LOAD(SherpaOnnxGetOfflineStreamResult);
        LOAD(SherpaOnnxDestroyOfflineRecognizerResult);
        LOAD(SherpaOnnxReadWave);
        LOAD(SherpaOnnxFreeWave);
        LOAD(SherpaOnnxCreateOfflinePunctuation);
        LOAD(SherpaOnnxDestroyOfflinePunctuation);
        LOAD(SherpaOfflinePunctuationAddPunct);
        LOAD(SherpaOfflinePunctuationFreeText);
#undef LOAD
        const QString version = QString::fromUtf8(SherpaOnnxGetVersionStr());
        if (version != "1.13.8" && version != "v1.13.8")
            throw std::runtime_error(("Expected sherpa-onnx 1.13.8, found " + version).toStdString());
        const auto entry = catalog.find(id);
        if (id != "none" && !catalog.installed(entry))
            throw std::runtime_error("Model files are missing. Select an installed model.");
        const auto model = catalog.file(entry, "model").toUtf8();
        const auto tokens = catalog.file(entry, "tokens").toUtf8();
        const auto encoder = catalog.file(entry, "encoder").toUtf8();
        const auto decoder = catalog.file(entry, "decoder").toUtf8();
        const auto joiner = catalog.file(entry, "joiner").toUtf8();
        const auto bpe = catalog.file(entry, "bpeVocab").toUtf8();
        SherpaOnnxOfflineRecognizerConfig config{};
        config.feat_config.sample_rate = 16000;
        config.feat_config.feature_dim = 80;
        config.model_config.tokens = tokens.constData();
        config.model_config.num_threads = 2;
        config.model_config.provider = "cpu";
        config.decoding_method = "greedy_search";
        const auto kind = entry["kind"].toString();
        if (kind == "offline-paraformer")
            config.model_config.paraformer.model = model.constData();
        else if (kind == "offline-sense-voice") {
            config.model_config.sense_voice.model = model.constData();
            config.model_config.sense_voice.language = "auto";
            config.model_config.sense_voice.use_itn = 1;
        } else if (kind == "offline-transducer") {
            config.model_config.transducer.encoder = encoder.constData();
            config.model_config.transducer.decoder = decoder.constData();
            config.model_config.transducer.joiner = joiner.constData();
            hotwordSupport = !bpe.isEmpty();
            if (hotwordSupport) {
                config.model_config.modeling_unit = "bbpe";
                config.model_config.bpe_vocab = bpe.constData();
                config.decoding_method = "modified_beam_search";
                config.max_active_paths = 4;
                config.hotwords_score = 2.5;
            }
        } else if (id != "none")
            throw std::runtime_error("Unsupported offline model");
        if (id != "none") {
            recognizer = SherpaOnnxCreateOfflineRecognizer(&config);
            if (!recognizer)
                throw std::runtime_error("Failed to initialize recognition model");
        }
        const auto punct = catalog.find("ct-transformer");
        // SenseVoice 2024 emits its own punctuation with ITN enabled; applying
        // CT-Transformer a second time produces duplicated sentence endings.
        if (id != "sensevoice-2024" && catalog.installed(punct)) {
            const auto path = catalog.file(punct, "model").toUtf8();
            SherpaOnnxOfflinePunctuationConfig pc{};
            pc.model.ct_transformer = path.constData();
            pc.model.num_threads = 1;
            pc.model.provider = "cpu";
            punctuation = SherpaOnnxCreateOfflinePunctuation(&pc);
        }
    }
    ~Recognizer() {
        if (punctuation)
            SherpaOnnxDestroyOfflinePunctuation(punctuation);
        if (recognizer)
            SherpaOnnxDestroyOfflineRecognizer(recognizer);
    }
    void loadDictionary(const QString &path) {
        if (hotwordSupport)
            dictionary.load(path);
    }
    QString punctuate(QString text) {
        if (!text.isEmpty() && punctuation) {
            const auto utf8 = text.toUtf8();
            const auto *out = SherpaOfflinePunctuationAddPunct(punctuation, utf8.constData());
            if (out) {
                text = QString::fromUtf8(out);
                SherpaOfflinePunctuationFreeText(out);
            }
        }
        return text;
    }
    QString decode(const QVector<float> &samples, int rate, const QJsonObject &request = {}) {
        if (!recognizer)
            return punctuate(request["streamText"].toString());
        if (!hasVoice(samples, rate))
            return {};
        QStringList words;
        for (auto value : request["hotwords"].toArray()) {
            const auto word = value.toString().trimmed();
            if (!word.isEmpty() && !word.contains('/') && !word.contains(':') && !word.contains('\n'))
                words.append(word);
        }
        auto run = [&](const QStringList &candidates) {
            auto all = words;
            all.append(candidates);
            all.removeDuplicates();
            if (all.size() > 256)
                all = all.first(256);
            const auto hw = all.join('/').toUtf8();
            const auto *stream = hotwordSupport && !hw.isEmpty()
                                     ? SherpaOnnxCreateOfflineStreamWithHotwords(recognizer, hw.constData())
                                     : SherpaOnnxCreateOfflineStream(recognizer);
            if (!stream)
                throw std::runtime_error("Cannot create recognition stream");
            SherpaOnnxAcceptWaveformOffline(stream, rate, samples.constData(), int(samples.size()));
            SherpaOnnxDecodeOfflineStream(recognizer, stream);
            const auto *result = SherpaOnnxGetOfflineStreamResult(stream);
            QString text = result ? QString::fromUtf8(result->text).trimmed() : QString{};
            if (result)
                SherpaOnnxDestroyOfflineRecognizerResult(result);
            SherpaOnnxDestroyOfflineStream(stream);
            return text;
        };
        const bool useDictionary = hotwordSupport && request["dictionaryEnabled"].toBool(true) && dictionary.size();
        const auto preview = request["streamText"].toString();
        QString text = run(useDictionary && !preview.isEmpty() ? dictionary.retrieve(preview) : QStringList{});
        if (useDictionary && preview.isEmpty()) {
            const auto candidates = dictionary.retrieve(text);
            if (!candidates.isEmpty())
                text = run(candidates);
        }
        return punctuate(text);
    }
    QString wave(const QString &path) {
        const auto utf8 = path.toUtf8();
        const auto *wave = SherpaOnnxReadWave(utf8.constData());
        if (!wave)
            throw std::runtime_error("Cannot read WAV file");
        QVector<float> samples(wave->samples, wave->samples + wave->num_samples);
        const int rate = wave->sample_rate;
        SherpaOnnxFreeWave(wave);
        return decode(samples, rate);
    }
};
} // namespace
int runSpeechWorker(const QStringList &args) {
    try {
#if defined(Q_OS_WIN)
        const QString library = "sherpa-onnx-c-api.dll";
#elif defined(Q_OS_MACOS)
        const QString library = "libsherpa-onnx-c-api.dylib";
#else
        const QString library = "libsherpa-onnx-c-api.so";
#endif
        QElapsedTimer timer;
        timer.start();
        ModelCatalog catalog(option(args, "--model-dir"));
        Recognizer recognizer(option(args, "--runtime", QDir(QCoreApplication::applicationDirPath()).filePath(library)),
                              catalog, option(args, "--model-id", "paraformer-yue-offline"));
        recognizer.loadDictionary(option(args, "--dictionary"));
        if (args.contains("--transcribe")) {
            const auto text = recognizer.wave(option(args, "--transcribe"));
            send({{"type", "result"}, {"text", text}, {"elapsedMs", timer.elapsed()}});
            return 0;
        }
        send({{"type", "ready"}, {"elapsedMs", timer.elapsed()}});
        std::string line;
        while (std::getline(std::cin, line)) {
            const auto request = QJsonDocument::fromJson(QByteArray::fromStdString(line)).object();
            if (request["type"] == "quit")
                break;
            if (request["type"] == "dictionary:update") {
                recognizer.loadDictionary(request["path"].toString());
                continue;
            }
            if (request["type"] == "punctuate") {
                send({{"type", "result"},
                      {"id", request["id"]},
                      {"text", recognizer.punctuate(request["text"].toString())}});
                continue;
            }
            const auto path = request["path"].toString();
            const auto rate = request["sampleRate"].toInt();
            QFile input(path);
            if (request["type"] != "decode" || rate < 8000 || rate > 192000 || !input.open(QIODevice::ReadOnly) ||
                input.size() > qint64(rate) * 120 * 4 || input.size() % 4)
                throw std::runtime_error("Invalid audio request");
            const auto bytes = input.readAll();
            input.close();
            QVector<float> samples(bytes.size() / 4);
            memcpy(samples.data(), bytes.constData(), bytes.size());
            timer.restart();
            const auto text = recognizer.decode(samples, rate, request);
            send({{"type", "result"}, {"id", request["id"]}, {"text", text}, {"elapsedMs", timer.elapsed()}});
        }
        return 0;
    } catch (const std::exception &error) {
        send({{"type", "error"}, {"message", QString::fromUtf8(error.what())}});
        return 1;
    }
}
