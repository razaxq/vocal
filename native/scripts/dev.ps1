param(
    [ValidateSet('build', 'run', 'test', 'smoke', 'transcribe', 'integration', 'migration-tests', 'input-probe', 'capture-probe')][string]$Action = 'run',
    [string]$Wave = '',
    [string]$Model = 'paraformer-yue-offline',
    [string]$QtRoot = '',
    [string]$Toolchain = '',
    [string]$BuildDirectory = 'data/native-build',
    [string]$RuntimeDirectory = '',
    [switch]$Release
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
$toolsDir = Join-Path $repo 'data/native-tools'
if (!$QtRoot) { $QtRoot = Join-Path $toolsDir 'Qt/6.8.3/mingw_64' }
if (!$Toolchain) { $Toolchain = Join-Path $toolsDir 'Qt/Tools/mingw1310_64/bin' }
$pythonScripts = Join-Path $toolsDir 'python/Scripts'
foreach ($required in @("$QtRoot/bin/qmake.exe", "$Toolchain/g++.exe", "$pythonScripts/cmake.exe", "$pythonScripts/ninja.exe")) {
    if (!(Test-Path -LiteralPath $required)) { throw "Missing build tool: $required. See native/README.md." }
}
$env:PATH = "$QtRoot/bin;$Toolchain;$pythonScripts;$env:PATH"
# Qt's native Windows backend is enough for microphone capture; no FFmpeg is needed.
$env:QT_MEDIA_BACKEND = 'windows'
$env:QT_FORCE_STDERR_LOGGING = '1'
$buildDir = if ([IO.Path]::IsPathRooted($BuildDirectory)) { $BuildDirectory } else { Join-Path $repo $BuildDirectory }
$app = Join-Path $buildDir 'bin/vocal-native.exe'
$runningBuild = @(Get-Process -Name 'vocal-native' -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and [IO.Path]::GetFullPath($_.Path) -eq [IO.Path]::GetFullPath($app)
})
if ($runningBuild.Count) {
    throw "Vocal is still running from this build directory. Choose Quit in its tray menu, then run this command again. Closing the settings window only hides it to the tray. PID: $($runningBuild.Id -join ', ')"
}
$runtime = $RuntimeDirectory
if (!$runtime) { $runtime = Join-Path $repo 'native/dependencies/node_modules/sherpa-onnx-win-x64' }
if (!(Test-Path -LiteralPath "$runtime/package.json")) { throw 'Run native/scripts/setup.ps1 to install the native SDK.' }
if ((Get-Content "$runtime/package.json" -Raw | ConvertFrom-Json).version -ne '1.13.8') {
    throw 'This native preview requires sherpa-onnx 1.13.8 (matching the vendored C header).'
}
$development = if ($Release) { 'OFF' } else { 'ON' }
& "$pythonScripts/cmake.exe" -S "$repo/native" -B $buildDir -G Ninja "-DCMAKE_PREFIX_PATH=$QtRoot" "-DCMAKE_CXX_COMPILER=$Toolchain/g++.exe" "-DCMAKE_BUILD_TYPE=Release" "-DSHERPA_RUNTIME_DIR=$runtime" "-DVOCAL_DEVELOPMENT=$development"
if ($LASTEXITCODE) { throw 'CMake configuration failed' }
& "$pythonScripts/cmake.exe" --build $buildDir --parallel 4
if ($LASTEXITCODE) { throw 'Native build failed' }
switch ($Action) {
    'test' {
        & "$pythonScripts/ctest.exe" --test-dir $buildDir --output-on-failure
    }
    'smoke' {
        # A pipeline also makes PowerShell wait for GUI-subsystem executables.
        & $app --model-dir "$repo/data/models" --data-dir "$repo/data/native-smoke" --smoke-test "$repo/data/native-smoke.png" | Out-Host
    }
    'transcribe' {
        if (!$Wave) { throw '-Wave must point to a WAV file' }
        & $app --transcribe (Resolve-Path -LiteralPath $Wave).Path --model-dir "$repo/data/models" --model-id $Model | Out-Host
    }
    'integration' {
        & "$pythonScripts/python.exe" "$repo/native/tests/worker_protocol.py" --app $app --models "$repo/data/models"
    }
    'migration-tests' {
        $env:PYTHONIOENCODING = 'utf-8'
        & "$pythonScripts/python.exe" "$repo/native/tests/migration_protocol.py" --app $app --models "$repo/data/models" --screens "$repo/data/native-ui-check/pages"
    }
    'input-probe' { & "$buildDir/bin/vocal-native-probe.exe" }
    'capture-probe' { & "$buildDir/bin/vocal-native-probe.exe" --capture }
    'run' {
        # A GUI-subsystem executable has no console to hide. SW_HIDE can hide
        # Qt's first real window while Qt still considers it visible.
        Start-Process -FilePath $app -ArgumentList @('--model-dir', "`"$repo/data/models`"", '--data-dir', "`"$repo/data/native-preview`"") -WindowStyle Normal
        Write-Output 'Vocal Native started. Close it from the tray menu before rebuilding.'
        $global:LASTEXITCODE = 0
    }
}
if ($LASTEXITCODE) { throw "Native command failed ($LASTEXITCODE)" }
