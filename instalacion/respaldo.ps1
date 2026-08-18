<#
.SYNOPSIS
  Respalda la base de datos.

.DESCRIPTION
  Con la base en la nube esto lo hacia Supabase. Ahora vive en un escritorio
  de la oficina, asi que un disco duro que se muera se lleva las ventas, el
  inventario y la cobranza. Esto no es opcional.

  Guarda un .sql comprimido por corrida y conserva:
    - los ultimos 14 diarios
    - el primero de cada mes, para siempre

  El instalador registra una tarea que lo corre todos los dias a la 1 de la
  manana. Tambien se puede correr a mano antes de algo delicado.

.PARAMETER Raiz
  Por omision C:\alfadeo.

.PARAMETER Destino
  Carpeta de los respaldos. Por omision C:\alfadeo\respaldos.

  MUY RECOMENDABLE apuntarla a un disco distinto o a una carpeta que se
  sincronice sola (OneDrive, Google Drive, un USB). Un respaldo en el mismo
  disco que la base sirve para un borrado por error, no para un disco muerto.

.PARAMETER Restaurar
  Ruta de un archivo de respaldo a restaurar. BORRA lo que haya y lo
  reemplaza. Pide confirmacion escrita.
#>
param(
  [string]$Raiz      = "C:\alfadeo",
  [string]$Destino   = "",
  [string]$Restaurar = ""
)

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\comun.ps1"

$cfg      = Get-Config -Raiz $Raiz
$PGDUMP   = Join-Path $Raiz "pgsql\bin\pg_dump.exe"
$PSQL     = Join-Path $Raiz "pgsql\bin\psql.exe"
if ($Destino -eq "") { $Destino = Join-Path $Raiz "respaldos" }

if (-not (Test-Path $PGDUMP)) { throw "No hay PostgreSQL en $Raiz\pgsql." }

$envLocal = Join-Path $cfg.Panel ".env.local"
$url = $null
foreach ($l in (Get-Content $envLocal -ErrorAction SilentlyContinue)) {
  if ($l -match '^\s*DATABASE_URL\s*=\s*(.+?)\s*$') { $url = $Matches[1].Trim('"').Trim("'") }
}
if (-not $url) { throw "Falta DATABASE_URL en $envLocal" }

# ============================================================ restaurar ===
if ($Restaurar -ne "") {
  if (-not (Test-Path $Restaurar)) { throw "No existe $Restaurar" }

  Write-Output ""
  Write-Output "  ESTO REEMPLAZA LA BASE COMPLETA con el contenido de:"
  Write-Output ("    " + $Restaurar)
  Write-Output "  Todo lo que se haya capturado despues de ese respaldo se pierde."
  Write-Output ""
  $r = Read-Host "  Escribe RESTAURAR para confirmar"
  if ($r -ne "RESTAURAR") { Write-Output "  cancelado."; exit 1 }

  # Antes de pisar nada, un respaldo de lo que hay. Si la restauracion sale
  # mal, todavia hay a donde regresar.
  Write-Output "  respaldando el estado actual antes de reemplazarlo..."
  & "$PSScriptRoot\respaldo.ps1" -Raiz $Raiz -Destino $Destino | Out-Null

  $tmp = Join-Path $Raiz "tmp\restaurar.sql"
  if ($Restaurar -match '\.gz$') {
    $ent = [IO.File]::OpenRead($Restaurar)
    $gz  = New-Object IO.Compression.GzipStream($ent, [IO.Compression.CompressionMode]::Decompress)
    $sal = [IO.File]::Create($tmp)
    $gz.CopyTo($sal); $sal.Close(); $gz.Close(); $ent.Close()
  } else {
    Copy-Item $Restaurar $tmp -Force
  }

  # El panel abajo mientras se restaura: no debe estar escribiendo encima.
  Stop-Panel $cfg
  & $PSQL $url -v ON_ERROR_STOP=1 -q -c "drop schema public cascade; create schema public;"
  & $PSQL $url -v ON_ERROR_STOP=1 -q -f $tmp
  $ok = ($LASTEXITCODE -eq 0)
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  Start-Panel -Cfg $cfg -EsperaSeg 90 | Out-Null

  if (-not $ok) { throw "La restauracion fallo." }
  Write-Output "  restaurado."
  exit 0
}

# ============================================================ respaldar ===
New-Item -ItemType Directory -Force -Path $Destino | Out-Null

$sello   = Get-Date -Format "yyyy-MM-dd_HHmm"
$archivo = Join-Path $Destino ("alfadeo_" + $sello + ".sql")

# --clean --if-exists para que el archivo se pueda restaurar encima de una
# base que ya tiene cosas, sin tener que vaciarla primero a mano.
& $PGDUMP $url --clean --if-exists --no-owner --no-privileges -f $archivo
if ($LASTEXITCODE -ne 0) { throw "pg_dump fallo." }

# Comprimido queda en una fraccion: son puros INSERT y texto repetido.
$gz = $archivo + ".gz"
$ent = [IO.File]::OpenRead($archivo)
$sal = [IO.File]::Create($gz)
$comp = New-Object IO.Compression.GzipStream($sal, [IO.Compression.CompressionLevel]::Optimal)
$ent.CopyTo($comp)
$comp.Close(); $sal.Close(); $ent.Close()
Remove-Item $archivo -Force

$mb = "{0:N1} MB" -f ((Get-Item $gz).Length / 1MB)
Write-Output ("respaldo: " + (Split-Path $gz -Leaf) + "  (" + $mb + ")")

# ------------------------------------------------------------- purgar ----
# Se conservan 14 diarios y el primero de cada mes. Lo segundo importa:
# un error de captura puede tardar semanas en notarse, y sin mensuales ya
# no habria a donde regresar.
$todos = Get-ChildItem $Destino -Filter "alfadeo_*.sql.gz" | Sort-Object Name -Descending
$conservar = New-Object System.Collections.Generic.HashSet[string]

$todos | Select-Object -First 14 | ForEach-Object { [void]$conservar.Add($_.Name) }

$porMes = @{}
foreach ($a in $todos) {
  if ($a.Name -match 'alfadeo_(\d{4})-(\d{2})-') {
    $mes = $Matches[1] + $Matches[2]
    # El mas viejo de cada mes: como vienen en orden descendente, el ultimo
    # que se ve de cada mes es el primero del mes.
    $porMes[$mes] = $a.Name
  }
}
foreach ($n in $porMes.Values) { [void]$conservar.Add($n) }

$borrados = 0
foreach ($a in $todos) {
  if (-not $conservar.Contains($a.Name)) { Remove-Item $a.FullName -Force; $borrados++ }
}

$quedan = (Get-ChildItem $Destino -Filter "alfadeo_*.sql.gz").Count
$total  = "{0:N0} MB" -f (((Get-ChildItem $Destino -Filter "alfadeo_*.sql.gz" | Measure-Object Length -Sum).Sum) / 1MB)
Write-Output ("guardados: " + $quedan + " respaldos, " + $total + $(if ($borrados) { "  (se purgaron " + $borrados + ")" } else { "" }))

if ($Destino -like "$Raiz*") {
  Write-Output ""
  Write-Output "  OJO: los respaldos estan en el MISMO disco que la base."
  Write-Output "  Sirven para un borrado por error, no para un disco muerto."
  Write-Output "  Apunta -Destino a un USB o a una carpeta de OneDrive/Drive."
}
