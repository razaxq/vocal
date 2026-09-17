param([string]$ArtifactDirectory, [string]$Tag, [string]$Mode, [string]$LogPath)
# This command stub never invokes gh.exe or makes a network request.
$global:VocalMockPhase = if ($Mode -eq 'draft') { 1 } elseif ($Mode -eq 'published') { 3 } else { 0 }
function global:gh {
    $arguments = @($args)
    ($arguments -join ' ') | Add-Content -LiteralPath $LogPath
    $global:LASTEXITCODE = 0
    if ($arguments[0] -eq 'release' -and $arguments[1] -eq 'view') {
        if ($global:VocalMockPhase -eq 0) { $global:LASTEXITCODE = 1; return 'release not found' }
        return '{"apiUrl":"https://api.github.com/repos/razaxq/vocal/releases/12345"}'
    }
    if ($arguments[0] -eq 'api') {
        if ($arguments[1] -match '/tags/' -and $global:VocalMockPhase -lt 3) {
            $global:LASTEXITCODE = 1; return 'gh: Not Found (HTTP 404)'
        }
        if ($global:VocalMockPhase -eq 0) { $global:LASTEXITCODE = 1; return 'gh: Not Found (HTTP 404)' }
        $assets = @()
        if ($global:VocalMockPhase -ge 2) {
            $assets = @(Get-ChildItem -LiteralPath $ArtifactDirectory -File | ForEach-Object {
                $digest = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                if ($Mode -eq 'tampered') { $digest = '0' * 64 }
                @{name=$_.Name; size=$_.Length; digest="sha256:$digest"}
            })
        }
        return (@{draft=($global:VocalMockPhase -lt 3); assets=$assets} | ConvertTo-Json -Depth 5 -Compress)
    }
    if ($arguments[0] -eq 'release' -and $arguments[1] -eq 'create') { $global:VocalMockPhase = 1; return }
    if ($arguments[0] -eq 'release' -and $arguments[1] -eq 'upload') { $global:VocalMockPhase = 2; return }
    if ($arguments[0] -eq 'release' -and $arguments[1] -eq 'edit') { $global:VocalMockPhase = 3; return }
    throw "Unexpected gh command: $arguments"
}
& "$PSScriptRoot/../scripts/publish.ps1" -Tag $Tag -ArtifactDirectory $ArtifactDirectory
