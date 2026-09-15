param([Parameter(Mandatory = $true)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'

function Assert-ChildPath([string]$Parent, [string]$Candidate) {
    $parentPath = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    $candidatePath = [IO.Path]::GetFullPath($Candidate)
    if (-not $candidatePath.StartsWith($parentPath, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Update path is outside the application directory.'
    }
    return $candidatePath
}

function Move-WithRetry([string]$Source, [string]$Destination) {
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        try { Move-Item -LiteralPath $Source -Destination $Destination; return }
        catch { if ($attempt -eq 59) { throw }; Start-Sleep -Milliseconds 500 }
    }
}

$settings = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$appDir = [IO.Path]::GetFullPath($settings.appDir).TrimEnd('\')
if ($appDir -eq [IO.Path]::GetPathRoot($appDir).TrimEnd('\')) { throw 'Cannot update a drive root.' }
$stage = Assert-ChildPath $appDir $settings.stage
if ([IO.Path]::GetFileName($stage) -notlike '.vocal-update-*') { throw 'Invalid staging directory.' }
$payload = Assert-ChildPath $stage (Join-Path $stage 'payload')
$backup = Assert-ChildPath $stage (Join-Path $stage 'backup')
if (-not (Test-Path -LiteralPath (Join-Path $payload 'Vocal.exe'))) { throw 'Missing executable.' }
if (-not (Test-Path -LiteralPath (Join-Path $payload 'resources\app.asar'))) { throw 'Missing application.' }
$entries = @(Get-ChildItem -LiteralPath $payload -Force)
foreach ($entry in $entries) {
    if ($entry.Name -ieq 'data' -or $entry.Name -like '.vocal-update-*') { throw 'Reserved directory in update.' }
    $null = Assert-ChildPath $payload $entry.FullName
    $null = Assert-ChildPath $appDir (Join-Path $appDir $entry.Name)
}
$links = @(Get-ChildItem -LiteralPath $payload -Recurse -Force | Where-Object {
    ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
})
if ($links.Count -gt 0) { throw 'Links are not allowed in update payload.' }
New-Item -ItemType Directory -Path $backup -Force | Out-Null
Set-Content -LiteralPath (Join-Path $stage 'ready') -Value 'ready' -NoNewline
if ($settings.parentPid -gt 0) {
    $parent = Get-Process -Id $settings.parentPid -ErrorAction SilentlyContinue
    if ($parent -and -not $parent.WaitForExit(60000)) { throw 'Application did not exit.' }
}

$changed = [Collections.Generic.List[string]]::new()
try {
    foreach ($entry in $entries) {
        $target = Assert-ChildPath $appDir (Join-Path $appDir $entry.Name)
        $saved = Assert-ChildPath $backup (Join-Path $backup $entry.Name)
        if (Test-Path -LiteralPath $target) { Move-WithRetry $target $saved }
        $changed.Add($entry.Name)
        Move-WithRetry $entry.FullName $target
    }
    if ($settings.restart) {
        Start-Process -FilePath (Join-Path $appDir 'Vocal.exe') -WorkingDirectory $appDir -WindowStyle Hidden
    }
    Set-Content -LiteralPath (Join-Path $stage 'result.json') -Value '{"ok":true}'
} catch {
    $failure = $_.Exception.Message
    for ($index = $changed.Count - 1; $index -ge 0; $index--) {
        $target = Assert-ChildPath $appDir (Join-Path $appDir $changed[$index])
        $saved = Assert-ChildPath $backup (Join-Path $backup $changed[$index])
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
        if (Test-Path -LiteralPath $saved) { Move-WithRetry $saved $target }
    }
    @{ ok = $false; message = $failure } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stage 'result.json')
    if ($settings.restart) {
        Start-Process -FilePath (Join-Path $appDir 'Vocal.exe') -WorkingDirectory $appDir -WindowStyle Hidden
    }
    exit 1
}
