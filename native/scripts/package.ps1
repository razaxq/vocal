param(
    [string]$BuildDirectory = 'data/native-build',
    [string]$OutputDirectory = 'data/native-dist',
    [string]$QtRoot = '',
    [string]$Toolchain = '',
    [string]$NsisPath = '',
    [switch]$Installer
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
if (!$QtRoot) { $QtRoot = Join-Path $repo 'data/native-tools/Qt/6.8.3/mingw_64' }
if (!$Toolchain) { $Toolchain = Join-Path $repo 'data/native-tools/Qt/Tools/mingw1310_64/bin' }
$build = if ([IO.Path]::IsPathRooted($BuildDirectory)) { $BuildDirectory } else { Join-Path $repo $BuildDirectory }
$distribution = if ([IO.Path]::IsPathRooted($OutputDirectory)) { $OutputDirectory } else { Join-Path $repo $OutputDirectory }
$metadata = Get-Content -LiteralPath "$build/native-build.json" -Raw | ConvertFrom-Json
$version = $metadata.version
if ($version -notmatch '^\d+\.\d+\.\d+(-native-dev)?$') { throw 'Invalid build version' }
$env:PATH = "$QtRoot/bin;$Toolchain;$env:PATH"
$reported = (& "$build/bin/vocal-native.exe" --version | Out-String).Trim()
if ($LASTEXITCODE -or $reported -ne "VocalNative $version") { throw "Build metadata/executable version mismatch: $reported" }
if ($Installer -and !$NsisPath) {
    $installed = "${env:ProgramFiles(x86)}/NSIS/makensis.exe"
    if (Test-Path -LiteralPath $installed) { $NsisPath = $installed }
    elseif (Get-Command makensis.exe -ErrorAction SilentlyContinue) { $NsisPath = (Get-Command makensis.exe).Source }
    else { throw 'Install NSIS (choco install nsis --version=3.12 -y) or pass -NsisPath.' }
}
$archive = Join-Path $distribution "Vocal-Native-$version-win-x64.zip"
$installerFile = Join-Path $distribution "Vocal-Native-Setup-$version.exe"
foreach ($target in @($archive, $installerFile, (Join-Path $distribution 'SHA256SUMS.txt'))) {
    if (Test-Path -LiteralPath $target) { throw "Output already exists; use a fresh -OutputDirectory: $target" }
}
$stage = Join-Path $distribution ('stage-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage -Force | Out-Null
foreach ($name in @('vocal-native.exe','sherpa-onnx-c-api.dll','onnxruntime.dll','onnxruntime_providers_shared.dll')) {
    Copy-Item -LiteralPath (Join-Path $build "bin/$name") -Destination $stage
}
& "$QtRoot/bin/windeployqt.exe" --release --qmldir "$repo/native/qml" --no-translations --no-ffmpeg --exclude-plugins ffmpegmediaplugin --no-opengl-sw --verbose 0 "$stage/vocal-native.exe"
if ($LASTEXITCODE) { throw 'Qt deployment failed' }
# Keep Qt's plugin categories together instead of scattering them next to the EXE.
$pluginRoot = Join-Path $stage 'plugins'
New-Item -ItemType Directory -Path $pluginRoot -Force | Out-Null
foreach ($category in Get-ChildItem -LiteralPath "$QtRoot/plugins" -Directory) {
    $deployed = Join-Path $stage $category.Name
    if (Test-Path -LiteralPath $deployed) {
        $resolved = (Resolve-Path -LiteralPath $deployed).Path
        if (!(($resolved + '\').StartsWith($stage + '\', [StringComparison]::OrdinalIgnoreCase))) {
            throw "Plugin path outside package stage: $resolved"
        }
        Move-Item -LiteralPath $resolved -Destination (Join-Path $pluginRoot $category.Name)
    }
}
$dictionary = Join-Path $stage 'resources/dictionaries/rime-ice'
New-Item -ItemType Directory -Path $dictionary -Force | Out-Null
foreach ($name in @('catalog.json','LICENSE','SOURCE.md')) {
    Copy-Item -LiteralPath (Join-Path $repo "resources/dictionaries/rime-ice/$name") -Destination $dictionary
}
$licenses = Join-Path $stage 'licenses'
New-Item -ItemType Directory -Path $licenses -Force | Out-Null
Copy-Item -LiteralPath "$repo/LICENSE" -Destination "$licenses/Vocal-MIT.txt"
Copy-Item -LiteralPath "$repo/native/vendor/sherpa-onnx/LICENSE" -Destination "$licenses/sherpa-onnx-Apache-2.0.txt"
Copy-Item -LiteralPath "$repo/native/vendor/onnxruntime/LICENSE" -Destination "$licenses/onnxruntime-MIT.txt"
Copy-Item -LiteralPath "$repo/native/THIRD-PARTY.md" -Destination $licenses
Copy-Item -LiteralPath "$repo/native/vendor/qt/LGPL-3.0-only.txt" -Destination $licenses
Copy-Item -LiteralPath "$repo/resources/dictionaries/rime-ice/LICENSE" -Destination "$licenses/GPL-3.0.txt"
# Preserve the toolchain's upstream notices and Qt's component/source inventory.
Copy-Item -LiteralPath (Join-Path (Split-Path $Toolchain) 'licenses') -Destination "$licenses/mingw" -Recurse
New-Item -ItemType Directory -Path "$licenses/qt-sbom" -Force | Out-Null
Get-ChildItem -LiteralPath "$QtRoot/sbom" -Filter '*.spdx.json' | Copy-Item -Destination "$licenses/qt-sbom"
Copy-Item -LiteralPath "$build/native-build.json" -Destination "$stage/native-release.json"
"[Paths]`nPrefix=.`nPlugins=plugins`nQmlImports=qml`n" | Set-Content "$stage/qt.conf" -Encoding ascii
$uninstallLines = @()
foreach ($file in Get-ChildItem -LiteralPath $stage -File -Recurse) {
    $relative = $file.FullName.Substring($stage.Length + 1).Replace('$', '$$')
    $uninstallLines += 'Delete "$INSTDIR\{0}"' -f $relative
}
foreach ($directory in Get-ChildItem -LiteralPath $stage -Directory -Recurse | Sort-Object { $_.FullName.Length } -Descending) {
    $relative = $directory.FullName.Substring($stage.Length + 1).Replace('$', '$$')
    $uninstallLines += 'RMDir "$INSTDIR\{0}"' -f $relative
}
$uninstallLines | Set-Content "$stage/uninstall-files.nsh" -Encoding utf8
& 7z a -tzip -mx=9 $archive "$stage/*" '-x!uninstall-files.nsh' | Out-Null
if ($LASTEXITCODE) { throw 'Archive creation failed' }
$artifacts = @($archive)
if ($Installer) {
    $frameDll = & "$PSScriptRoot/installer-frame.ps1" -Toolchain $Toolchain -OutputDirectory "$build/installer-frame"
    & $NsisPath /V2 /INPUTCHARSET UTF8 "/DINSTALLER_FRAME=$frameDll" "/DAPP_DIR=$stage" "/DOUTPUT=$installerFile" "/DVERSION=$version" "/DPRODUCT_VERSION=$($metadata.productVersion)" "$repo/native/installer/windows.nsi"
    if ($LASTEXITCODE) { throw 'Native installer build failed' }
    $artifacts += $installerFile
}
$artifacts | ForEach-Object { '{0}  {1}' -f (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant(), [IO.Path]::GetFileName($_) } | Set-Content "$distribution/SHA256SUMS.txt" -Encoding ascii
$bytes = (Get-ChildItem -LiteralPath $stage -File -Recurse | Measure-Object Length -Sum).Sum
[pscustomobject]@{ directory=$stage; archive=$archive; installer=$installerFile; version=$version; unpackedMB=[math]::Round($bytes/1MB,1); archiveMB=[math]::Round((Get-Item -LiteralPath $archive).Length/1MB,1) } | ConvertTo-Json
