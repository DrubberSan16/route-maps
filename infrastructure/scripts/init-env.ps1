<#
.SYNOPSIS
  Creates .env from .env.example, replacing every CHANGE_ME_* value with a random
  secret (the same secret wherever the same placeholder appears). When .env already
  exists, adds the variables of .env.example it lacks (new versions add some) and
  keeps everything else.
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
# UTF-8 without BOM and LF line endings, as Docker Compose expects.
$utf8 = New-Object System.Text.UTF8Encoding $false

function New-Secret {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

# Replaces each CHANGE_ME_* placeholder of the text with a random secret.
function Add-Secrets([string]$content) {
  $placeholders = [regex]::Matches($content, 'CHANGE_ME_[A-Za-z0-9_]*') | ForEach-Object { $_.Value } | Sort-Object -Unique
  foreach ($placeholder in $placeholders) {
    $content = $content.Replace($placeholder, (New-Secret))
  }
  return $content.Replace("`r`n", "`n")
}

if ((Test-Path $target) -and -not $Force) {
  $existing = [System.IO.File]::ReadAllText($target)
  $block = New-Object System.Text.StringBuilder
  $added = @()
  $comments = @()
  $section = $null
  $sectionAdded = $false
  foreach ($line in [System.IO.File]::ReadAllLines($template)) {
    if ($line -cmatch '^([A-Z][A-Z0-9_]*)=') {
      $name = $Matches[1]
      # Present, even commented out (someone chose not to use it): left alone.
      if ($existing -cnotmatch "(?m)^[ \t]*#?[ \t]*$name=") {
        if ($section -and -not $sectionAdded) {
          [void]$block.Append("`n$section`n")
          $sectionAdded = $true
        }
        foreach ($comment in $comments) { [void]$block.Append("$comment`n") }
        [void]$block.Append("$line`n")
        $added += $name
      }
      $comments = @()
    } elseif ($line.StartsWith('# ----')) {
      $section = $line
      $sectionAdded = $false
      $comments = @()
    } elseif ($line.StartsWith('#') -and -not $line.StartsWith('# =')) {
      $comments += $line
    } else {
      $comments = @()
    }
  }

  if ($added.Count -eq 0) {
    Write-Host '.env already exists and has every variable of .env.example (use -Force to regenerate it).'
    exit 0
  }
  # Without a final newline, the first added line would join the last one of the file.
  $separator = if ($existing.Length -gt 0 -and -not $existing.EndsWith("`n")) { "`n" } else { '' }
  [System.IO.File]::AppendAllText($target, $separator + (Add-Secrets $block.ToString()), $utf8)
  Write-Host "Added to .env: $($added -join ' ') (secrets generated at random). Review them before starting the stack."
  exit 0
}

$content = Add-Secrets ([System.IO.File]::ReadAllText($template))
[System.IO.File]::WriteAllText($target, $content, $utf8)
Write-Host 'Created .env with random secrets. Review it before starting the stack.'
