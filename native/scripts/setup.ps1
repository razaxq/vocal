param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
$toolsDir = Join-Path $repo 'data/native-tools'
$venv = Join-Path $toolsDir 'python'
if (!(Test-Path -LiteralPath "$venv/Scripts/python.exe")) {
    & $Python -m venv $venv
    if ($LASTEXITCODE) { throw 'Cannot create the build Python environment' }
}
$buildPython = "$venv/Scripts/python.exe"
& $buildPython -m pip install --disable-pip-version-check -r "$repo/native/requirements-build.txt"
if ($LASTEXITCODE) { throw 'Cannot install build tools' }
$qt = Join-Path $toolsDir 'Qt'
if (!(Test-Path -LiteralPath "$qt/6.8.3/mingw_64/bin/qmake.exe")) {
    & $buildPython -m aqt install-qt windows desktop 6.8.3 win64_mingw -O $qt -m qtmultimedia --archives qtbase qtdeclarative qtsvg qtshadertools qttranslations
    if ($LASTEXITCODE) { throw 'Cannot install Qt 6.8.3' }
}
if (!(Test-Path -LiteralPath "$qt/Tools/mingw1310_64/bin/g++.exe")) {
    & $buildPython -m aqt install-tool windows desktop tools_mingw1310 qt.tools.win64_mingw1310 -O $qt
    if ($LASTEXITCODE) { throw 'Cannot install MinGW 13.1' }
}
& npm ci --prefix "$repo/native/dependencies" --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE) { throw 'Cannot install the locked native SDK' }
