param(
    [string]$Toolchain = '',
    [string]$OutputDirectory = 'data/native-installer'
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path "$PSScriptRoot/../..").Path
if (!$Toolchain) { $Toolchain = "$repo/data/native-tools/Qt/Tools/mingw1310_64/bin" }
$output = if ([IO.Path]::IsPathRooted($OutputDirectory)) { $OutputDirectory } else { Join-Path $repo $OutputDirectory }
New-Item -ItemType Directory -Path $output -Force | Out-Null
$previousPath = $env:PATH
try {
    $env:PATH = "$Toolchain;$env:PATH"
    # The existing Qt toolchain can emit x86 objects. This DLL has no CRT/import
    # libraries, so neither a second compiler nor runtime needs to be downloaded.
    & "$Toolchain/g++.exe" -m32 -std=c++17 -Os -fno-builtin -fno-exceptions -fno-rtti -fno-stack-protector -fno-asynchronous-unwind-tables -Wall -Wextra -Wno-cast-function-type -c "$repo/native/installer/frame.cpp" -o "$output/frame.o"
    if ($LASTEXITCODE) { throw 'Installer frame compilation failed' }
    & "$Toolchain/g++.exe" -m32 -std=c++17 -Os -fno-builtin -fno-exceptions -fno-rtti -fno-stack-protector -fno-asynchronous-unwind-tables -Wall -Wextra -Wno-cast-function-type -c "$repo/native/installer/folder-dialog.cpp" -o "$output/folder-dialog.o"
    if ($LASTEXITCODE) { throw 'Installer folder dialog compilation failed' }
    & "$Toolchain/ld.exe" -m i386pe --dll --entry 0 --kill-at --strip-all "$output/frame.o" "$output/folder-dialog.o" -o "$output/installer-frame.dll"
    if ($LASTEXITCODE) { throw 'Installer frame link failed' }
    Write-Output (Join-Path $output 'installer-frame.dll')
} finally { $env:PATH = $previousPath }
