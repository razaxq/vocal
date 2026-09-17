param([switch]$Release, [string]$NsisPath = '', [string]$OutputDirectory = 'data/native-ci-dist')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
Push-Location $repo
try {
    ./native/scripts/dev.ps1 test -BuildDirectory data/native-ci-build -Release:$Release
    $scripts = "$repo/data/native-tools/python/Scripts"
    & "$scripts/python.exe" native/tests/release_protocol.py
    if ($LASTEXITCODE) { throw 'Release orchestration tests failed' }
    & "$scripts/cmake.exe" --build data/native-ci-build --target vocal-native_qmllint
    if ($LASTEXITCODE) { throw 'QML validation failed' }
    ./native/scripts/package.ps1 -BuildDirectory data/native-ci-build -OutputDirectory $OutputDirectory -Installer -NsisPath $NsisPath
    $env:PYTHONIOENCODING = 'utf-8'
    & "$scripts/python.exe" native/tests/package_smoke.py --dist $OutputDirectory --output data/native-ci-check
    if ($LASTEXITCODE) { throw 'Standalone package validation failed' }
} finally {
    Pop-Location
}
