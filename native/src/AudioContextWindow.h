#pragma once
#include <QtGlobal>

// Diagnostic windows contain whole, adjacent cuts. Never trim through a word to
// meet the limit, and never bridge a silent/discontinuous/device-format gap.
class AudioContextWindow {
  public:
    struct Window {
        qint64 samples = 0;
        qint64 start = 0;
        int rate = 0, firstId = 0, lastId = 0;
    };
    Window append(qint64 samples, int rate, qint64 start, int id, bool voiced) {
        Window result;
        if (!voiced || rate <= 0 || samples <= 0 || samples > qint64(rate) * 15) {
            reset();
            return result;
        }
        if (m_previous.rate == rate && m_previous.start + m_previous.samples == start &&
            m_previous.samples + samples <= qint64(rate) * 15) {
            result = m_previous;
            result.samples += samples;
            result.lastId = id;
        }
        m_previous = {samples, start, rate, id, id};
        return result;
    }
    void reset() { m_previous = {}; }
  private:
    Window m_previous;
};
