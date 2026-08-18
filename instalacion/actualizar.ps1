<#
.SYNOPSIS
  Trae los cambios de GitHub, recompila y reinicia el panel.

.DESCRIPTION
  Es el comando del dia a dia. Se usa desde SSH:

    ssh DELL@<ip-de-la-maquina>
    actualizar

  Si no hay nada nuevo no toca nada: en un mostrador no tiene caso tumbar
  la caja para recompilar lo mismo.

  Compila ANTES de reiniciar. Si empujas codigo que no compila, el mostrador
  se queda con la version anterior y aqui te dice por que fallo.

  Esta maquina es un DESTINO de despliegue, no un lugar donde se programa:
  se usa "reset --hard", nunca "pull". Asi no puede quedar un conflicto de
  merge a media manana. Si alguien edito archivos aqui, se enumeran antes
  de descartarlos.

.PARAMETER Forzar
  Recompila y reinicia aunque no haya commits nuevos.
#>
param(
  [string]$Raiz = "C:\alfadeo",
  [switch]$Forzar
)

$ErrorActionPreference = "Stop"

# Este script se copia a tmp antes de correr (ver comandos.ps1), asi que
# $PSScriptRoot puede no ser la carpeta del repo. Las rutas salen de la
# configuracion, no de donde este el archivo.
$cfgPath = Join-Path $Raiz "config.json"
if (-not (Test-Path $cfgPath)) {
  throw "No existe $cfgPath. Corre primero instalacion\instalar.ps1"
}
$c     = Get-Content $cfgPath -Raw | ConvertFrom-Json
$PANEL = $c.panel
$TAREA = $c.tarea
$PUERTO = [int]$c.puerto
$LOG   = Join-Path $Raiz "panel.log"

$GIT = Join-Path $Raiz "git\cmd\git.exe"
if (-not (Test-Path $GIT)) {
  $g = Get-Command git -ErrorAction SilentlyContinue
  if (-not $g) { throw "No hay git. Instalalo o corre instalacion\instalar-git.ps1" }
  $GIT = $g.Source
}
$NPM = Join-Path $Raiz "node\npm.cmd"

$env:Path = "$Raiz\node;$Raiz\git\cmd;" + $env:Path
Set-Location $PANEL

if (-not (Test-Path (Join-Path $PANEL ".git")))        { throw "$PANEL no es un repositorio de git." }
if (-not (Test-Path (Join-Path $PANEL ".env.local")))  { throw "Falta $PANEL\.env.local - sin las llaves de Supabase el panel no arranca." }

# ------------------------------------------------------- que hay de nuevo -
$antes = (& $GIT rev-parse HEAD).Trim()
Write-Output ("commit actual: " + $antes.Substring(0, 7))

Write-Output "buscando cambios..."
& $GIT fetch origin main -q
if ($LASTEXITCODE -ne 0) { throw "No se pudo alcanzar GitHub. Revisa la salida a internet." }

$despues = (& $GIT rev-parse origin/main).Trim()

if ($antes -eq $despues -and -not $Forzar) {
  Write-Output "ya esta al dia. No se toco nada."
  Write-Output "(usa -Forzar si quieres recompilar de todos modos)"
  exit 0
}

if ($antes -ne $despues) {
  Write-Output ""
  Write-Output "cambios que entran:"
  & $GIT log --oneline ($antes + ".." + $despues) | ForEach-Object { Write-Output ("  " + $_) }
  Write-Output ""
}

$sucio = & $GIT status --porcelain
if ($sucio) {
  Write-Output "OJO: hay cambios locales que se van a descartar:"
  $sucio | ForEach-Object { Write-Output ("  " + $_) }
  Write-Output ""
}

# ---------------------------------------------------------------- bajar ---
& $GIT reset --hard origin/main -q
if ($LASTEXITCODE -ne 0) { throw "No se pudo alinear con origin/main." }
Write-Output ("actualizado a: " + (& $GIT rev-parse --short HEAD) + "  " + (& $GIT log -1 --pretty=%s))

# ---------------------------------------------------------------- armar ---
# Solo se reinstala si cambio el lockfile. Lo normal es que un cambio sea
# puro codigo, y ahi reinstalar son 35 segundos tirados.
$lockCambio = $true
if ($antes -ne $despues) {
  & $GIT diff --quiet $antes $despues -- package-lock.json
  $lockCambio = ($LASTEXITCODE -ne 0)
} elseif (Test-Path (Join-Path $PANEL "node_modules")) {
  $lockCambio = $false
}

if ($lockCambio -or -not (Test-Path (Join-Path $PANEL "node_modules"))) {
  # "npm ci" y no "npm install": instala exactamente lo que dice el lockfile
  # y no lo reescribe. Con "install", npm ensuciaba el repo en cada corrida
  # y luego cada actualizacion reportaba cambios locales que no eran tuyos.
  Write-Output "instalando dependencias (cambio el lockfile)..."
  & $NPM ci --no-audit --no-fund --loglevel=error
  if ($LASTEXITCODE -ne 0) { throw "npm ci fallo. Revisa que package-lock.json este al dia con package.json." }
} else {
  Write-Output "dependencias: sin cambios, se saltan"
}

Write-Output "compilando..."
& $NPM run build
if ($LASTEXITCODE -ne 0) { throw "La compilacion fallo. El panel sigue corriendo con la version anterior." }

# ------------------------------------------------------------- reiniciar --
Write-Output "reiniciando el panel..."
try { Stop-ScheduledTask -TaskName $TAREA -ErrorAction SilentlyContinue } catch { }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like "*next*start*" } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2

Start-ScheduledTask -TaskName $TAREA

$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest ("http://localhost:" + $PUERTO + "/inicio") -UseBasicParsing -TimeoutSec 5
    Write-Output ("panel: HTTP " + $r.StatusCode + " en " + (($i + 1) * 2) + "s")
    $ok = $true
    break
  } catch { }
}
if (-not $ok) { throw ("El panel no respondio. Revisa " + $LOG) }

Write-Output ""
Write-Output "listo."
