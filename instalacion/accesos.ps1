<#
.SYNOPSIS
  Pone los accesos directos del mostrador en el escritorio.

.DESCRIPTION
  Se abren en "modo aplicacion" de Chrome (--app), no en kiosco: dan una
  ventana limpia sin barra de direcciones, pero se pueden cerrar y minimizar
  como cualquier programa. En una maquina que tambien se usa para otras
  cosas, el kiosco estorba mas de lo que ayuda.
#>
param([string]$Raiz = "C:\alfadeo")

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\comun.ps1"

$cfg = Get-Config -Raiz $Raiz
$url = "http://localhost:" + $cfg.Puerto

$escritorio = [Environment]::GetFolderPath("CommonDesktopDirectory")
if (-not $escritorio -or -not (Test-Path $escritorio)) {
  $escritorio = [Environment]::GetFolderPath("Desktop")
}

$navegador = @(
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "C:\Program Files\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $navegador) {
  Write-Output "no se encontro Chrome ni Edge: no se crearon accesos directos"
  return
}

$ws = New-Object -ComObject WScript.Shell

function Nuevo-Acceso($nombre, $argumentos, $descripcion) {
  $ruta = Join-Path $escritorio ($nombre + ".lnk")
  $a = $ws.CreateShortcut($ruta)
  $a.TargetPath       = $navegador
  $a.Arguments        = $argumentos
  $a.Description      = $descripcion
  $a.WorkingDirectory = Split-Path $navegador
  $a.Save()
  Write-Output ("acceso: " + $nombre)
}

Nuevo-Acceso "Punto de venta ALFA-DEO" ('--app="' + $url + '/pos"') `
  "Punto de venta - descuenta inventario al cobrar"

Nuevo-Acceso "Panel ALFA-DEO" ('--app="' + $url + '/inicio"') `
  "Panel completo: inventario, ventas, cobranza"

# Esta pagina funciona sin internet y sin el sistema arriba: sirve para
# verificar el lector antes de que haya codigos de barras cargados.
$lector = Join-Path $cfg.Panel "instalacion\prueba-lector.html"
if (Test-Path $lector) {
  $uri = "file:///" + ($lector -replace "\\", "/")
  Nuevo-Acceso "Probar lector" ('--app="' + $uri + '"') `
    "Verifica que el lector de codigo de barras teclee bien"
}

Write-Output ("navegador: " + $navegador)
