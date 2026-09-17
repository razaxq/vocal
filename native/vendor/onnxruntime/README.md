# ONNX Runtime C API

The unmodified C API header is from ONNX Runtime v1.20.1 (MIT license):
https://github.com/microsoft/onnxruntime/blob/v1.20.1/include/onnxruntime/core/session/onnxruntime_c_api.h

SHA-256: `573a117ae6b83ead7f53da6cedaa0d7b7d9cdb45c0ba4726bac9081e67696a82`

The correction worker requests API version 20 explicitly from `OrtGetApiBase`.
Newer runtime libraries must provide this API; a null API pointer fails startup.
Both recognition and correction use the CPU runtime shipped with
`sherpa-onnx-win-x64@1.13.8`. Correction runs in its own process, but loads the same
runtime file through the public C API. Real MacBERT/BERT regression fixtures
verify this combination. No Node binding or unused DirectML/DX compiler libraries
are deployed for correction.
