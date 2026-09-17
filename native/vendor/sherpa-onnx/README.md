# sherpa-onnx C ABI

`c-api.h` is unmodified from tag **v1.13.8**:

- https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/sherpa-onnx/c-api/c-api.h
- SHA-256: `2a1b95084be8fd1deb3228fcad2fd3f7f0258b64582f7402281ec174c7b7f4ce`
- Copyright and Apache-2.0 license: see `LICENSE` and the header notices.

The worker dynamically resolves the C API and verifies the library version before
passing configuration structs. Do not change the header and runtime independently.
The Windows development build copies the three native DLLs from the project's
locked `native/dependencies/sherpa-onnx-win-x64@1.13.8` build SDK. It does not use the Node binding.
Packaging includes its Apache-2.0 license and the deployment component inventory.
