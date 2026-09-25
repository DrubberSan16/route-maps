<#
.SYNOPSIS
  Creates .env from .env.example, replacing every CHANGE_ME_* value with a random
  secret (the same secret wherever the same placeholder appears).
.EXAMPLE
  .\infrastructure\scripts\init-env.ps1
  .\infrastructure\scripts\init-env.ps1 -Force
#>
[CmdletBinding()]
param([switch]$Force)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$template = Join-Path $root '.env.example'
$target = Join-Path $root '.env'

if ((Test-Path $target) -and -not $Force) {
  Write-Host '.env already exists; keeping it (use -Force to regenerate it).'
  exit 0
}

function New-Secret {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

$content = [System.IO.File]::ReadAllText($template)
$placeholders = [regex]::Matches($content, 'CHANGE_ME_[A-Za-z0-9_]*') | ForEach-Object { $_.Value } | Sort-Object -Unique
foreach ($placeholder in $placeholders) {
  $content = $content.Replace($placeholder, (New-Secret))
}

# UTF-8 without BOM and LF line endings, as Docker Compose expects.
[System.IO.File]::WriteAllText($target, $content.Replace("`r`n", "`n"), (New-Object System.Text.UTF8Encoding $false))
Write-Host 'Created .env with random secrets. Review it before starting the stack.'
