#pragma once
// MinGW 13.1's Windows headers declare SetThreadInformation and the enum but
// omit this Windows 10 SDK POD. Keep the ABI identical; no runtime shim needed.
#include <windows.h>
#ifndef THREAD_POWER_THROTTLING_CURRENT_VERSION
#define THREAD_POWER_THROTTLING_CURRENT_VERSION 1
#define THREAD_POWER_THROTTLING_EXECUTION_SPEED 0x1
typedef struct _THREAD_POWER_THROTTLING_STATE {
    ULONG Version;
    ULONG ControlMask;
    ULONG StateMask;
} THREAD_POWER_THROTTLING_STATE;
#endif
