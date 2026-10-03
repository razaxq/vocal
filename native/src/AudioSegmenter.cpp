#include "AudioSegmenter.h"
#include <cmath>
#include <utility>

void AudioSegmenter::reset(int rate) {
    m_samples.clear();
    m_scanned = m_speechEnd = 0;
    m_voiced = 0;
    m_rejected = 0;
    m_typicalGapMs = 100;
    m_rate = rate;
    m_hasSpeech = false;
}

QList<QVector<float>> AudioSegmenter::append(const QVector<float> &samples, int rate, int silenceMs, bool automatic) {
    QList<QVector<float>> ready;
    if (rate <= 0 || samples.isEmpty())
        return ready;
    if (!m_rate)
        m_rate = rate;
    Q_ASSERT(rate == m_rate);
    const qsizetype frame = qMax(1, rate / 50); // 20 ms, regardless of device packet size.
    const qsizetype padding = rate / 5;
    // Scan each bounded batch before consuming more input: a pause can free
    // space for the remainder of a delayed capture packet. Only an unbroken
    // segment may hit the two-minute decoder limit.
    qsizetype consumed = 0;
    while (consumed < samples.size()) {
        const qsizetype room = qsizetype(rate) * 120 - m_samples.size();
        if (room <= 0) {
            m_rejected += samples.size() - consumed;
            break;
        }
        const qsizetype count = qMin(room, samples.size() - consumed);
        m_samples.append(samples.mid(consumed, count));
        consumed += count;
        while (m_scanned + frame <= m_samples.size()) {
            double energy = 0;
            for (qsizetype i = m_scanned; i < m_scanned + frame; ++i)
                energy += double(m_samples[i]) * m_samples[i];
            m_scanned += frame;
            if (std::sqrt(energy / frame) > .005) {
                // Learn only pauses followed by speech within the same phrase.
                // Padding carried across a committed boundary is not a word gap.
                const double precedingGapMs = 1000. * (m_scanned - frame - m_speechEnd) / rate;
                if (m_hasSpeech && precedingGapMs >= 40 && precedingGapMs <= 600)
                    m_typicalGapMs = .75 * m_typicalGapMs + .25 * precedingGapMs;
                m_voiced += frame;
                // A brief click/onset alone must not trigger a short-pause decode.
                // Keep it buffered so actual speech can provide recognition context.
                m_hasSpeech = !automatic || m_voiced >= rate / 10;
                m_speechEnd = m_scanned;
                continue;
            }
            int requiredGapMs = qBound(400, silenceMs, 5000);
            if (automatic) {
                // A phrase pause should stand out from this speaker's word gaps.
                // Longer phrases become more eager to commit, while very short
                // fragments wait longer so hesitations do not become tiny jobs.
                requiredGapMs = qBound(220, qRound(m_typicalGapMs * 2.2 + 80), 480);
                if (m_speechEnd >= qsizetype(rate) * 6)
                    requiredGapMs = qMax(220, requiredGapMs - 80);
                if (m_voiced < rate * 4 / 5)
                    requiredGapMs = qMax(requiredGapMs, m_voiced < rate * 2 / 5 ? 650 : 450);
                if (!m_hasSpeech)
                    requiredGapMs = 1500; // Quiet capture produces no inference jobs.
            }
            const qsizetype gap = qint64(rate) * requiredGapMs / 1000;
            if (m_scanned - m_speechEnd < gap)
                continue;
            // Leave silence on both sides, including pre-roll for the next onset.
            // Audio after this offset remains buffered even if it already contains
            // the next utterance in the same microphone packet.
            const qsizetype cut = m_hasSpeech ? m_speechEnd + (m_scanned - m_speechEnd) / 2
                                             : m_scanned - padding;
            ready.append(m_samples.first(cut));
            m_samples.remove(0, cut);
            m_scanned -= cut;
            m_speechEnd = 0;
            m_voiced = 0;
            m_hasSpeech = false;
        }
    }
    return ready;
}

QVector<float> AudioSegmenter::finish() {
    auto result = std::exchange(m_samples, {});
    reset();
    return result;
}
