<#
.SYNOPSIS
  Crea (o actualiza) las tablas, vistas y funciones del panel.

.DESCRIPTION
  Corre las migraciones en orden contra la base local. Las cuatro son
  aditivas e idempotentes: se pueden volver a correr sin romper nada, y es
  la forma normal de aplicar un cambio de esquema.

  DONDE ESTAN LOS .sql
  --------------------
  No viajan en el repositorio: describen la operacion del negocio y el repo
  es publico (ver PENDIENTES.md, seccion "Seguridad"). Este script los busca,
  en orden:

    1. instalacion\sql\     <- si algun dia se deciden a versionarlos
    2. supabase\            <- donde estan en la maquina de desarrollo

  Si no aparecen, te dice exactamente cuales faltan y donde ponerlos.

.PARAMETER Raiz
  Por omision C:\alfadeo.

.PARAMETER Carpeta
  Ruta alterna donde buscar los .sql.
#>
param(
  [string]$Raiz    = "C:\alfadeo",
  [string]$Carpeta = ""
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\comun.ps1"

$cfg  = Get-Config -Raiz $Raiz
$PSQL = Join-Path $Raiz "pgsql\bin\psql.exe"

if (-not (Test-Path $PSQL)) {
  throw "No hay PostgreSQL en $Raiz\pgsql. Corre primero instalacion\instalar-postgres.ps1"
}

# El orden IMPORTA: cada archivo da por hecho lo que creo el anterior.
$MIGRACIONES = @(
  "00-esquema-base.sql",
  "cotizador-inteligente.sql",
  "reunion-catalogo-sucursales.sql",
  "reunion-operacion.sql",
  "99-llaves-foraneas.sql"
)

# ------------------------------------------------------- donde estan ------
$candidatas = @()
if ($Carpeta -ne "") { $candidatas += $Carpeta }
$candidatas += (Join-Path $cfg.Panel "instalacion\sql")
$candidatas += (Join-Path $cfg.Panel "supabase")
$candidatas += (Join-Path $Raiz "sql")

$origen = $null
foreach ($c in $candidatas) {
  if (-not (Test-Path $c)) { continue }
  $tiene = $true
  foreach ($m in $MIGRACIONES) { if (-not (Test-Path (Join-Path $c $m))) { $tiene = $false } }
  if ($tiene) { $origen = $c; break }
}

if (-not $origen) {
  Write-Output ""
  Write-Output "  NO ESTAN LOS ARCHIVOS DE LA BASE"
  Write-Output ""
  Write-Output "  Se buscaron en:"
  foreach ($c in $candidatas) { Write-Output ("    " + $c) }
  Write-Output ""
  Write-Output "  Hacen falta estos cuatro, en este orden:"
  foreach ($m in $MIGRACIONES) {
    $d = $null
    foreach ($c in $candidatas) { if (Test-Path (Join-Path $c $m)) { $d = $c } }
    Write-Output ("    " + $(if ($d) { "ok   " } else { "FALTA" }) + "  " + $m)
  }
  Write-Output ""
  Write-Output "  No vienen en el repositorio a proposito (es publico y describen"
  Write-Output "  la operacion). Pidelos a quien administra el proyecto y ponlos en:"
  Write-Output ("    " + (Join-Path $cfg.Panel "instalacion\sql"))
  Write-Output ""
  exit 1
}

Write-Output ("archivos: " + $origen)

# --------------------------------------------------------- conexion ------
$envLocal = Join-Path $cfg.Panel ".env.local"
if (-not (Test-Path $envLocal)) { throw "Falta $envLocal. Corre instalacion\instalar-postgres.ps1" }

$url = $null
foreach ($l in (Get-Content $envLocal)) {
  if ($l -match '^\s*DATABASE_URL\s*=\s*(.+?)\s*$') { $url = $Matches[1].Trim('"').Trim("'") }
}
if (-not $url) { throw "Falta DATABASE_URL en .env.local. Corre instalacion\instalar-postgres.ps1" }

# --------------------------------------------------------- correrlas -----
Write-Output ""
$fallo = $false
foreach ($m in $MIGRACIONES) {
  $ruta = Join-Path $origen $m
  Write-Output ("  corriendo " + $m + " ...")

  # ON_ERROR_STOP para que se detenga en el primer error en vez de seguir
  # dejando la base a medias. -1 mete todo el archivo en UNA transaccion:
  # si truena a la mitad, no queda nada aplicado.
  $r = Nativo $PSQL @($url, "-v", "ON_ERROR_STOP=1", "-1", "-q", "-f", $ruta) -Silencioso

  # Los NOTICE no son errores: la migracion de operacion usa uno para avisar
  # de lotes duplicados sin abortar. Se muestran como aviso.
  foreach ($l in ($r.salida -split "`n")) {
    $t = $l.Trim()
    if (-not $t) { continue }
    if ($t -match 'NOTICE') { Write-Output ("      aviso: " + ($t -replace '^.*NOTICE:\s*', '')) }
    else { Write-Output ("      " + $t) }
  }

  if ($r.codigo -ne 0) {
    Write-Output ("  FALLO en " + $m)
    $fallo = $true
    break
  }
}

if ($fallo) {
  Write-Output ""
  Write-Output "  La base quedo SIN esos cambios (cada archivo va en una transaccion)."
  exit 1
}

# --------------------------------------------------------- verificar -----
Write-Output ""
& "$PSScriptRoot\verificar-base.ps1" -Raiz $Raiz
exit $LASTEXITCODE
