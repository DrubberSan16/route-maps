<#
.SYNOPSIS
  Downloads and prepares an offline region into .\storage (STORAGE_PATH).
.DESCRIPTION
  1. Downloads the region's .osm.pbf from Geofabrik (or clips it from its parent
     extract) into storage\imports and verifies it (MD5 + PBF check).
  2. Builds the visual map storage\maps\<dir>\<region>.pmtiles.
  3. Prepares the routing graph storage\routing\<region>\.
  4. Writes the region manifest and registers the region in the backend.
  Regions are defined in infrastructure\regions\regions.json. Everything runs
  inside the data-tools image: the host only needs Docker Desktop.
.EXAMPLE
  .\infrastructure\scripts\download-region.ps1 guayaquil
  .\infrastructure\scripts\download-region.ps1 ecuador -SkipRouting
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [ValidatePattern('^[a-z0-9][a-z0-9-]{1,62}$')]
  [string]$Region,
  [switch]$SkipRouting,
  [switch]$WaterPolygons,
  [switch]$ForceDownload
)

$ErrorActionPreference = 'Stop'
Set-Location (Resolve-Path (Join-Path $PSScriptRoot '..\..'))

$prepareArgs = @('compose', '--profile', 'tools', 'run', '--rm', 'data-tools', 'prepare', $Region)
if ($SkipRouting) { $prepareArgs += '--skip-routing' }
if ($WaterPolygons) { $prepareArgs += '--water-polygons' }
if ($ForceDownload) { $prepareArgs += '--force-download' }

& docker @prepareArgs
if ($LASTEXITCODE -ne 0) { throw "Region preparation failed (exit code $LASTEXITCODE)." }

$backend = (& docker compose ps --status running -q backend 2>$null)
if ($backend) {
  Write-Host 'Registering the region in the backend...'
  & docker compose exec -T backend node dist/src/cli/sync-regions.js
  if ($LASTEXITCODE -ne 0) { throw "Region registration failed (exit code $LASTEXITCODE)." }
} else {
  Write-Host 'The backend is not running: the region is registered when it starts (.\make.ps1 up).'
}

if (-not $SkipRouting) {
  $served = (& docker compose exec -T routing printenv ROUTING_REGION 2>$null)
  if ($served) { $served = $served.Trim() }
  if ($served -eq $Region) {
    Write-Host "Restarting the routing service to load the new graph of $Region..."
    & docker compose restart routing
  } else {
    Write-Host "The routing service serves '$served'. To route in $Region set ROUTING_REGION=$Region in .env and run: docker compose up -d routing"
  }
}
