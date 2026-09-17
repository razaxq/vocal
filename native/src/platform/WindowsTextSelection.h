#pragma once
#include <QString>
#include <windows.h>

// Select only the expected suffix immediately before the caret. Never select all.
bool selectPreviousWindowsText(HWND window, const QString &expected, QString *error, QString *method = nullptr);

// 1 = present at caret, 0 = not yet present, -1 = editor cannot expose text.
int previousWindowsTextMatches(HWND window, const QString &expected);
