<#
.SYNOPSIS
  Maps Platform - comandos habituales para Windows/PowerShell (equivalente al Makefile).
.EXAMPLE
  .\make.ps1 init
  .\make.ps1 up
  .\make.ps1 prepare-region -Region guayaquil
  .\make.ps1 logs -Service backend
  .\make.ps1 help
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = 'help',
  [string]$Region = '',
  [string]$Service = '',
  [switch]$SkipRouting,
  [switch]$WaterPolygons,
  [switch]$ForceDownload
)

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

# Runs docker with the given arguments, skipping empty optional ones.
function Invoke-Docker {
  $filtered = @($args | Where-Object { $null -ne $_ -and "$_" -ne '' })
  & docker @filtered
  if ($LASTEXITCODE -ne 0) { throw "docker $($filtered -join ' ') failed (exit code $LASTEXITCODE)." }
}

function Assert-Region {
  if ($Region -notmatch '^[a-z0-9][a-z0-9-]{1,62}$') {
    throw "Uso: .\make.ps1 $Command -Region <código> (ver: .\make.ps1 regions)"
  }
}

$prod = @('compose', '-f', 'docker-compose.yml', '-f', 'docker-compose.prod.yml')
$tools = @('compose', '--profile', 'tools', 'run', '--rm', 'data-tools')
$backendRun = @('compose', 'run', '--rm', '-e', 'RUN_MIGRATIONS=false', '-e', 'SEED_DEMO_DATA=false', 'backend')

$commands = [ordered]@{
  'help'            = 'Muestra esta ayuda'
  'init'            = 'Crea .env desde .env.example con secretos aleatorios'
  'up'              = 'Construye y levanta nginx, backend, postgres, redis y routing'
  'down'            = 'Detiene el stack (conserva volúmenes y .\storage)'
  'restart'         = 'Reinicia un servicio (-Service backend) o todo el stack'
  'ps'              = 'Estado y salud de los servicios'
  'logs'            = 'Sigue los logs (-Service backend para uno solo)'
  'build'           = 'Construye todas las imágenes, incluida data-tools'
  'config'          = 'Valida docker-compose.yml con las variables de .env'
  'migrate'         = 'Aplica las migraciones pendientes de Prisma'
  'seed'            = 'Carga usuarios y datos de demostración (idempotente)'
  'regions'         = 'Lista las regiones del catálogo y lo ya generado'
  'regions-sync'    = 'Registra en el backend las regiones preparadas'
  'download-region' = 'Descarga (o recorta) el extracto OSM: -Region guayaquil'
  'build-map'       = 'Genera el mapa PMTiles de una región descargada (-WaterPolygons: océanos)'
  'build-routing'   = 'Genera el grafo de routing Valhalla de una región descargada'
  'prepare-region'  = 'Descarga + mapa + routing + manifiesto + registro: -Region guayaquil'
  'geocoding-up'    = 'Levanta Nominatim (la primera vez importa el extracto de NOMINATIM_REGION)'
  'prod-up'         = 'Producción: construye y levanta con docker-compose.prod.yml'
  'prod-down'       = 'Producción: detiene el stack'
  'prod-logs'       = 'Producción: sigue los logs'
  'test-backend'    = 'Pruebas del backend (Jest)'
  'test-e2e'        = 'Pruebas e2e del backend (PostGIS real; requiere $env:E2E_DATABASE_URL a una BD *_e2e)'
  'test-tilegen'    = 'Pruebas del generador de mapas (Maven, Java 21)'
  'test-mobile'     = 'Pruebas de la app Flutter'
}

switch ($Command) {
  'help' {
    foreach ($entry in $commands.GetEnumerator()) { '  {0,-16} {1}' -f $entry.Key, $entry.Value }
    ''
    '  Parámetros: -Region <código> -Service <servicio> -SkipRouting -WaterPolygons -ForceDownload'
  }
  'init' { & (Join-Path $PSScriptRoot 'infrastructure\scripts\init-env.ps1') }
  'up' { Invoke-Docker compose up -d --build }
  'down' { Invoke-Docker compose down }
  'restart' { Invoke-Docker compose restart $Service }
  'ps' { Invoke-Docker compose ps }
  'logs' { Invoke-Docker compose logs -f --tail=200 $Service }
  'build' { Invoke-Docker compose --profile tools build }
  'config' { Invoke-Docker compose config --quiet; 'Configuración de Docker Compose válida' }
  'migrate' { Invoke-Docker @backendRun ./node_modules/.bin/prisma migrate deploy }
  'seed' { Invoke-Docker @backendRun node dist/prisma/seed.js }
  'regions' { Invoke-Docker @tools list }
  'regions-sync' { Invoke-Docker compose exec -T backend node dist/src/cli/sync-regions.js }
  'download-region' {
    Assert-Region
    Invoke-Docker @tools download $Region $(if ($ForceDownload) { '--force-download' })
  }
  'build-map' {
    Assert-Region
    Invoke-Docker @tools map $Region $(if ($WaterPolygons) { '--water-polygons' })
  }
  'build-routing' {
    Assert-Region
    Invoke-Docker @tools routing $Region
  }
  'prepare-region' {
    Assert-Region
    $scriptArgs = @{ Region = $Region; SkipRouting = $SkipRouting; WaterPolygons = $WaterPolygons; ForceDownload = $ForceDownload }
    & (Join-Path $PSScriptRoot 'infrastructure\scripts\download-region.ps1') @scriptArgs
  }
  'geocoding-up' { Invoke-Docker compose --profile geocoding up -d }
  'prod-up' { Invoke-Docker @prod up -d --build }
  'prod-down' { Invoke-Docker @prod down }
  'prod-logs' { Invoke-Docker @prod logs -f --tail=200 $Service }
  'test-backend' {
    Push-Location backend
    try { npm test; if ($LASTEXITCODE -ne 0) { throw 'Backend tests failed.' } } finally { Pop-Location }
  }
  'test-e2e' {
    Push-Location backend
    try { npm run test:e2e; if ($LASTEXITCODE -ne 0) { throw 'Backend e2e tests failed.' } } finally { Pop-Location }
  }
  'test-tilegen' {
    mvn -B -f infrastructure/maps/tilegen/pom.xml test
    if ($LASTEXITCODE -ne 0) { throw 'Tile generator tests failed.' }
  }
  'test-mobile' {
    Push-Location mobile
    try { flutter test; if ($LASTEXITCODE -ne 0) { throw 'Flutter tests failed.' } } finally { Pop-Location }
  }
  default { throw "Comando desconocido '$Command'. Ejecuta: .\make.ps1 help" }
}
