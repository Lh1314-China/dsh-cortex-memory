[CmdletBinding()]
param(
  [string]$Dsh = 'dsh',
  [string]$Profile = 'desktop',
  [string]$Package = 'dsh-cortex',
  [switch]$KeepPatch
)

$ErrorActionPreference = 'Stop'
$dshCommand = Get-Command $Dsh -ErrorAction SilentlyContinue
if (-not $dshCommand) { throw "dsh command not found: $Dsh. Pass -Dsh with the path to dsh.cmd." }
$dshPath = $dshCommand.Source
$profilePath = Join-Path (Join-Path $HOME '.dsh\profiles') $Profile
if (-not (Test-Path $profilePath)) { throw "profile not found: $profilePath" }

$packageJson = Join-Path $profilePath 'package.json'
$installed = $false
if (Test-Path $packageJson) {
  try {
    $manifest = Get-Content -LiteralPath $packageJson -Raw | ConvertFrom-Json
    $installed = $null -ne $manifest.dependencies.$Package
  } catch { $installed = $false }
}
if ($installed) {
  & $dshPath plugin --profile $Profile remove $Package
  if ($LASTEXITCODE -ne 0) { throw "plugin remove failed with exit code $LASTEXITCODE" }
} else {
  Write-Host "$Package is not installed in $Profile; skipping remove"
}

$patchFile = Join-Path $profilePath 'cordis.patch.yml'
$configuredDataRoot = $null
if (Test-Path $patchFile) {
  foreach ($line in [System.IO.File]::ReadAllLines($patchFile)) {
    if ($line -match '^\s*dataRoot:\s*(.+)$') {
      $configuredDataRoot = $matches[1].Trim().Trim("'").Trim('"')
      break
    }
  }
}
if (-not $configuredDataRoot) {
  $dshHome = Join-Path $HOME '.dsh'
  $configuredDataRoot = if ($Profile -eq 'desktop') { Join-Path $dshHome 'cortex' } else { Join-Path (Join-Path $dshHome 'cortex\profiles') $Profile }
}

if (-not $KeepPatch) {
  if (Test-Path $patchFile) {
    $lines = [System.IO.File]::ReadAllLines($patchFile)
    $ranges = New-Object System.Collections.Generic.List[object]
    $start = -1
    for ($i = 0; $i -lt $lines.Count; $i += 1) {
      if ($lines[$i] -match '^- ') {
        if ($start -ge 0) { $ranges.Add([pscustomobject]@{ From = $start; To = ($i - 1) }) }
        $start = $i
      }
    }
    if ($start -ge 0) { $ranges.Add([pscustomobject]@{ From = $start; To = ($lines.Count - 1) }) }

    $drop = @{}
    foreach ($range in $ranges) {
      $from = [int]$range.From
      $to = [int]$range.To
      $header = $lines[$from]
      $body = ($lines[$from..$to] -join "`n")
      if ($header -match '^- id:\s*cortex\s*$' -and $body -match 'name:\s*[''"]?dsh-cortex') {
        for ($i = $from; $i -le $to; $i += 1) { $drop[$i] = $true }
      }
    }

    if ($drop.Count -gt 0) {
      $remaining = @()
      for ($i = 0; $i -lt $lines.Count; $i += 1) {
        if (-not $drop.ContainsKey($i)) { $remaining += $lines[$i] }
      }
      $meaningful = @($remaining | Where-Object { $_.Trim() -and -not $_.Trim().StartsWith('#') })
      $text = if ($meaningful.Count -eq 0) { "[]`n" } else { ($remaining -join "`n") + "`n" }
      $utf8 = New-Object System.Text.UTF8Encoding($false)
      [System.IO.File]::WriteAllText($patchFile, $text, $utf8)
      Write-Host "removed cortex patch block from $patchFile"
    } else {
      Write-Host "no cortex patch block found in $patchFile"
    }
  }

  & $dshPath --profile $Profile --dump-config | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Warning "dump-config still fails; inspect $profilePath\cordis.patch.yml" }
  else { Write-Host "dump-config ok" }
}

Write-Host "profile left in place: $profilePath"
Write-Host "cortex data was NOT deleted: $configuredDataRoot"

