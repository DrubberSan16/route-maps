<#
.SYNOPSIS
  Downloads audited sources and prepares an offline region into .\storage.
.DESCRIPTION
  Downloads and validates the official/public source catalog, builds the PMTiles
  map and the offline pack of the phone (roads and search index, for routes and
  address search without connection; -SkipRouting skips it), and writes the
  manifest registered by the backend. Server routing reads the audited road
  network directly and needs no separate service.
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

Write-Host 'El backend nativo lee la red vial auditada directamente; no requiere un servicio de rutas separado.'
