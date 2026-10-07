<#
.SYNOPSIS
  Maps Platform - comandos habituales para Windows/PowerShell (equivalente al Makefile).
.EXAMPLE
  .\make.ps1 init
  .\make.ps1 up
  .\make.ps1 admin-create -Email tu@correo -Name "Tu nombre"
  .\make.ps1 prepare-region -Region guayaquil
  .\make.ps1 logs -Service backend
  .\make.ps1 publish-app -Server ovh-serverSoft
  .\make.ps1 help
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Command = 'help',
  [string]$Region = '',
  [string]$Service = '',
  [string]$Apk = '',
  [string]$Server = '',
  [string]$RemoteDir = '',
  [string]$Email = '',
  [string]$Name = '',
  [switch]$ResetPassword,
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

# Python 3 for the helper scripts: the py launcher of python.org first (on a Windows without Python,
# "python" only opens the Microsoft Store).
function Get-Python {
  foreach ($candidate in @(@('py', '-3'), @('python'), @('python3'))) {
    if (-not (Get-Command $candidate[0] -ErrorAction SilentlyContinue)) { continue }
    $rest = @($candidate | Select-Object -Skip 1)
    & $candidate[0] @rest --version *> $null
    if ($LASTEXITCODE -eq 0) { return , $candidate }
  }
  throw 'Falta Python 3: instálalo desde python.org (o con winget install Python.Python.3.13).'
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
  'init'            = 'Crea .env con secretos aleatorios (si existe, le agrega las variables nuevas)'
  'up'              = 'Construye y levanta nginx, backend, worker, postgres y redis'
  'down'            = 'Detiene el stack (conserva volúmenes y .\storage)'
  'restart'         = 'Reinicia un servicio (-Service backend) o todo el stack'
  'ps'              = 'Estado y salud de los servicios'
  'logs'            = 'Sigue los logs (-Service backend para uno solo)'
  'build'           = 'Construye todas las imágenes, incluida data-tools'
  'config'          = 'Valida docker-compose.yml con las variables de .env'
  'migrate'         = 'Aplica las migraciones pendientes de Prisma'
  'seed'            = 'Carga usuarios y datos de demostración (idempotente)'
  'admin-create'    = 'Crea un administrador del panel o reactiva uno: -Email correo [-Name "Nombre"] [-ResetPassword]'
  'regions'         = 'Lista las regiones del catálogo y lo ya generado'
  'regions-sync'    = 'Registra en el backend las regiones preparadas'
  'download-region' = 'Descarga las fuentes oficiales auditadas: -Region ecuador'
  'build-map'       = 'Genera el mapa PMTiles de una región descargada (-WaterPolygons: océanos)'
  'build-routing'   = 'Construye grafo de rutas, índice de búsqueda y capas nativas'
  'prepare-region'  = 'Descarga + mapa + manifiesto + registro: -Region ecuador'
  'publish-app'     = 'Publica el APK para el botón «Instalar app»: [-Apk ruta] [-Server servidor-ssh] [-RemoteDir /opt/route-maps]'
  'geocoding-up'    = 'Informa sobre la geocodificación nativa integrada'
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
    '  Parámetros: -Region <código> -Service <servicio> -Email <correo> -Name <nombre> -ResetPassword'
    '              -SkipRouting -WaterPolygons -ForceDownload'
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
  'admin-create' {
    if ($Email -notmatch '@') { throw 'Uso: .\make.ps1 admin-create -Email correo [-Name "Nombre"] [-ResetPassword: contraseña nueva]' }
    $adminArgs = @('--email', $Email)
    if ($Name) { $adminArgs += @('--name', $Name) }
    if ($ResetPassword) { $adminArgs += '--reset-password' }
    Invoke-Docker compose exec -T backend node dist/src/cli/create-admin.js @adminArgs
  }
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
    Invoke-Docker @tools build $Region
  }
  'prepare-region' {
    Assert-Region
    $scriptArgs = @{ Region = $Region; SkipRouting = $SkipRouting; WaterPolygons = $WaterPolygons; ForceDownload = $ForceDownload }
    & (Join-Path $PSScriptRoot 'infrastructure\scripts\download-region.ps1') @scriptArgs
  }
  'publish-app' {
    $python = Get-Python
    $apkPath = if ($Apk) { $Apk } else { Join-Path $PSScriptRoot 'mobile\build\app\outputs\flutter-apk\app-release.apk' }
    $publishArgs = @($python | Select-Object -Skip 1) +
      @((Join-Path $PSScriptRoot 'infrastructure\scripts\publish-app.py'), $apkPath)
    if ($Server) { $publishArgs += @('--host', $Server) }
    if ($RemoteDir) { $publishArgs += @('--remote-dir', $RemoteDir) }
    & $python[0] @publishArgs
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo publicar la app.' }
  }
  'geocoding-up' { 'La geocodificación nativa forma parte del backend y no requiere un servicio externo.' }
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
