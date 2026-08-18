<#
.SYNOPSIS
  Reinicia el panel sin traer cambios de GitHub.

.DESCRIPTION
  Para cuando el panel se quedo trabado o alguien lo apago. Si lo que
  quieres es publicar codigo nuevo, usa "actualizar".
#>
param([string]$Raiz = "C:\alfadeo")

$ErrorActionPreference = "Stop"
. "$PSScriptRoot\comun.ps1"

$cfg = Get-Config -Raiz $Raiz

Write-Output "deteniendo..."
Stop-Panel $cfg

Write-Output "arrancando..."
if (Start-Panel -Cfg $cfg -EsperaSeg 90) {
    Write-Output "listo."
} else {
    Write-Output ("El panel no respondio. Revisa el log: " + (Get-LogPath $cfg))
    exit 1
}
