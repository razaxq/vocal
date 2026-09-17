#pragma once
#include <QVector>

// Owns continuous PCM independently of inference. Boundaries are sample offsets
// inside confirmed silence, never the time at which a queued callback executes.
class AudioSegmenter {
  public:
    void reset(int rate = 0);
    QList<QVector<float>> append(const QVector<float> &samples, int rate, int silenceMs, bool automatic = false);
    const QVector<float> &pending() const { return m_samples; }
    QVector<float> finish();
    bool atLimit() const { return m_rate > 0 && m_samples.size() >= qsizetype(m_rate) * 120; }

  private:
    QVector<float> m_samples;
    qsizetype m_scanned = 0, m_speechEnd = 0;
    qsizetype m_voiced = 0;
    double m_typicalGapMs = 100;
    int m_rate = 0;
    bool m_hasSpeech = false;
};
