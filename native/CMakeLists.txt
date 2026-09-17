cmake_minimum_required(VERSION 3.24)
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/../package.json" VOCAL_PACKAGE_JSON)
string(JSON VOCAL_VERSION GET "${VOCAL_PACKAGE_JSON}" version)
project(VocalNative VERSION ${VOCAL_VERSION} LANGUAGES CXX)
option(VOCAL_DEVELOPMENT "Disable native release updates in local preview builds" ON)
set(VOCAL_APP_VERSION "${PROJECT_VERSION}")
set(VOCAL_DEVELOPMENT_JSON false)
if(VOCAL_DEVELOPMENT)
    string(APPEND VOCAL_APP_VERSION "-native-dev")
    set(VOCAL_DEVELOPMENT_JSON true)
endif()
execute_process(COMMAND git rev-parse HEAD WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    OUTPUT_VARIABLE VOCAL_SOURCE_COMMIT OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
configure_file(resources/native-build.json.in native-build.json @ONLY)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(MSVC)
    add_compile_options(/utf-8)
endif()
find_package(Qt6 6.8 REQUIRED COMPONENTS Core Gui Widgets Quick QuickControls2 Multimedia Network Test)
qt_standard_project_setup(REQUIRES 6.8)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")

qt_add_library(vocal_core STATIC
    src/AudioCapture.cpp src/AudioCapture.h
    src/Settings.cpp src/Settings.h
    src/TextCleanup.cpp src/TextCleanup.h
    src/ModelManager.cpp src/ModelManager.h
    src/Dictionary.cpp src/Dictionary.h src/CorrectionWorker.cpp src/CorrectionWorker.h
    src/WorkerProcess.cpp src/WorkerProcess.h src/TextOutput.cpp src/TextOutput.h src/LlmService.cpp src/LlmService.h
    src/ModelCatalog.cpp src/ModelCatalog.h
    src/SpeechWorker.cpp src/SpeechWorker.h
    src/StreamWorker.cpp src/StreamWorker.h
    src/DesktopServices.cpp src/DesktopServices.h
    src/Platform.h src/TriggerController.cpp src/TriggerController.h)
target_include_directories(vocal_core PUBLIC src PRIVATE vendor)
target_link_libraries(vocal_core PUBLIC Qt6::Core Qt6::Gui Qt6::Multimedia Qt6::Network)
qt_add_resources(vocal_core catalog PREFIX "/vocal" BASE "${CMAKE_CURRENT_SOURCE_DIR}/.."
    FILES ../scripts/models.json)
if(WIN32)
    target_sources(vocal_core PRIVATE src/platform/WindowsPlatform.cpp)
    target_link_libraries(vocal_core PUBLIC user32)
    target_compile_definitions(vocal_core PUBLIC NOMINMAX WIN32_LEAN_AND_MEAN)
else()
    target_sources(vocal_core PRIVATE src/platform/UnsupportedPlatform.cpp)
endif()

qt_add_executable(vocal-native src/main.cpp src/AppController.cpp src/AppController.h)
target_compile_definitions(vocal-native PRIVATE VOCAL_APP_VERSION="${VOCAL_APP_VERSION}")
target_link_libraries(vocal-native PRIVATE vocal_core Qt6::Widgets Qt6::Quick Qt6::QuickControls2)
qt_add_qml_module(vocal-native URI Vocal VERSION 1.0 QML_FILES qml/Main.qml qml/VoiceOverlay.qml)
qt_add_resources(vocal-native branding PREFIX "/vocal" BASE "${CMAKE_CURRENT_SOURCE_DIR}/.."
    FILES ../resources/icon.png ../resources/tray.png ../resources/changelog.json)
if(WIN32)
    configure_file(resources/app.rc.in app.rc @ONLY)
    target_sources(vocal-native PRIVATE "${CMAKE_CURRENT_BINARY_DIR}/app.rc")
    target_link_libraries(vocal-native PRIVATE dwmapi gdi32)
    # This is an interactive GUI app. Hide no window at process startup; the
    # Windows GUI subsystem prevents an extra console window instead.
    set_target_properties(vocal-native PROPERTIES WIN32_EXECUTABLE TRUE)
endif()

# Only the development kit uses the existing npm distribution as a C ABI SDK.
# No Node/Electron binary is linked or started by the native application.
set(SHERPA_RUNTIME_DIR "" CACHE PATH "Directory containing sherpa-onnx 1.13.8 C API and ONNX Runtime libraries")
if(WIN32 AND SHERPA_RUNTIME_DIR)
    foreach(dll sherpa-onnx-c-api.dll onnxruntime.dll onnxruntime_providers_shared.dll)
        if(NOT EXISTS "${SHERPA_RUNTIME_DIR}/${dll}")
            message(FATAL_ERROR "Missing sherpa runtime: ${SHERPA_RUNTIME_DIR}/${dll}")
        endif()
        add_custom_command(TARGET vocal-native POST_BUILD COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${SHERPA_RUNTIME_DIR}/${dll}" "$<TARGET_FILE_DIR:vocal-native>/${dll}")
    endforeach()
endif()
# ASR and correction workers share the same CPU ONNX Runtime distribution.
# Separate processes retain independent loading/unloading without shipping a
# second runtime plus unused DirectML/DX compiler DLLs.

include(CTest)
if(BUILD_TESTING)
    qt_add_executable(vocal-feature-tests tests/FeatureTests.cpp)
    target_link_libraries(vocal-feature-tests PRIVATE vocal_core Qt6::Test Qt6::Widgets)
    add_test(NAME native-features COMMAND vocal-feature-tests -platform offscreen)
    qt_add_executable(vocal-native-tests tests/CoreTests.cpp)
    target_link_libraries(vocal-native-tests PRIVATE vocal_core Qt6::Test Qt6::Widgets)
    add_test(NAME native-core COMMAND vocal-native-tests -platform offscreen)
    qt_add_executable(vocal-tray-tests tests/TrayTests.cpp)
    target_include_directories(vocal-tray-tests PRIVATE src)
    target_link_libraries(vocal-tray-tests PRIVATE Qt6::Gui Qt6::Widgets Qt6::Test)
    add_test(NAME native-tray COMMAND vocal-tray-tests -platform offscreen)
    if(WIN32)
        qt_add_executable(vocal-native-probe tests/PlatformProbe.cpp)
        target_link_libraries(vocal-native-probe PRIVATE vocal_core Qt6::Test Qt6::Widgets)
    endif()
endif()
