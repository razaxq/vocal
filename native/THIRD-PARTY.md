# Native distribution

Vocal source is MIT licensed. Native libraries remain separate dynamic libraries.
Users can replace them with compatible builds; the application imposes no signing
or integrity restriction on replacement libraries.

| Component | Version/source | License |
| --- | --- | --- |
| Qt Core, GUI, Widgets, Quick, QML, Controls, Multimedia, Network | 6.8.3 | LGPL-3.0; upstream component notices also apply |
| sherpa-onnx | 1.13.8 | Apache-2.0 |
| ONNX Runtime CPU | DLL supplied by sherpa-onnx-win-x64 1.13.8 | MIT |
| Rime Ice base dictionary | Revision recorded in resources/dictionaries/rime-ice/SOURCE.md | GPL-3.0 |
| MinGW-w64 / GCC runtime | 13.1.0 toolchain | Upstream runtime licenses and GCC Runtime Library Exception |

Qt source: https://download.qt.io/archive/qt/6.8/6.8.3/submodules/
Qt source modules used here: qtbase, qtdeclarative, qtmultimedia, qtsvg,
qtshadertools. Deployment follows https://doc.qt.io/qt-6/windows-deployment.html.
Licensing reference: https://doc.qt.io/qt-6/licensing.html.

sherpa-onnx: https://github.com/k2-fsa/sherpa-onnx/tree/v1.13.8
ONNX Runtime: https://github.com/microsoft/onnxruntime
MinGW runtime: https://github.com/mingw-w64/mingw-w64
GCC runtime: https://gcc.gnu.org/onlinedocs/libstdc++/manual/license.html

Models are downloaded separately, with the source/license metadata from
scripts/models.json. They are not included in the distribution.
The original base.dict.yaml is not deployed; the derived complete catalog is.

Packaging copies the MinGW toolchain license directory and Qt SPDX component
inventories into `licenses/`. The build marker records the source commit and
runtime versions. Before a public native release, verify the exact deployed
component notices/source availability and the installer/upgrade/uninstall path.
Code signing is not configured. Electron-to-native migration is not automatic.
