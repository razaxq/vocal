#pragma once

enum class InputReadiness { Ready, FocusChanged, ModifierHeld };

// SendInput queues events; our own Ctrl/Shift key-up may still be in flight.
// Wait briefly for the observed state, never bypass a held modifier or focus check.
template <class Focus, class Released, class Pause>
InputReadiness awaitInputReadiness(Focus focus, Released released, Pause pause) {
    for (int attempt = 0; attempt <= 50; ++attempt) {
        if (!focus()) return InputReadiness::FocusChanged;
        if (released()) return focus() ? InputReadiness::Ready : InputReadiness::FocusChanged;
        if (attempt < 50) pause();
    }
    return InputReadiness::ModifierHeld;
}
