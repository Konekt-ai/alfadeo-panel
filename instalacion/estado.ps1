<#
.SYNOPSIS
  Diagnostico del panel: si esta arriba, en que commit y si falta algo.

.DESCRIPTION
  Es lo primero que conviene correr al entrar por SSH. Dice de un vistazo
  si el mostrador esta trabajando, si GitHub tiene commits que no estan en
  la maquina y si la tarea de arranque quedo bien.
#>
param([string]$Raiz = "C:\alfadeo")

$ErrorActionPreference = "Continue"
. "$PSScriptRoot\comun.ps1"

$cfg = Get-Config -Raiz $Raiz
$GIT = Get-GitExe $cfg

Write-Output ""
Write-Output "--- PANEL ---"

$escuchando = Get-NetTCPConnection -LocalPort $cfg.Puerto -State Listen -ErrorAction SilentlyContinue
if ($escuchando) {
  $t0   = Get-Date
  $code = Test-PanelArriba -Cfg $cfg -TimeoutSec 10
  if ($code) {
    Write-Output ("  estado    arriba, HTTP " + $code + " en " + [int]((Get-Date) - $t0).TotalMilliseconds + " ms")
  } else {
    Write-Output "  estado    escuchando pero NO responde - revisa: log"
  }
} else {
  Write-Output "  estado    ABAJO - levantalo con: reiniciar"
}

Write-Output ("  local     http://localhost:" + $cfg.Puerto)
$ip = Get-IpLan
if ($ip) {
  $regla = Get-NetFirewallRule -DisplayName "ALFA-DEO Panel" -ErrorAction SilentlyContinue
  $nota  = if ($regla) { "" } else { "   (cerrado en el firewall)" }
  Write-Output ("  wifi      http://" + $ip + ":" + $cfg.Puerto + $nota)
}

Write-Output ""
Write-Output "--- CODIGO ---"
if ($GIT -and (Test-Path (Join-Path $cfg.Panel ".git"))) {
  Push-Location $cfg.Panel
  Write-Output ("  commit    " + (& $GIT rev-parse --short HEAD) + "  " + (& $GIT log -1 --pretty=%s))
  Write-Output ("  fecha     " + (& $GIT log -1 --pretty=%cd --date=format:"%Y-%m-%d %H:%M"))

  & $GIT fetch origin main -q 2>$null
  $local  = (& $GIT rev-parse HEAD).Trim()
  $remoto = (& $GIT rev-parse origin/main 2>$null)
  if ($remoto) {
    $remoto = $remoto.Trim()
    if ($local -eq $remoto) {
      Write-Output "  github    al dia"
    } else {
      $n = (& $GIT rev-list --count ($local + ".." + $remoto)).Trim()
      Write-Output ("  github    HAY " + $n + " COMMIT(S) NUEVOS - traelos con: actualizar")
      & $GIT log --oneline ($local + ".." + $remoto) | ForEach-Object { Write-Output ("              " + $_) }
    }
  } else {
    Write-Output "  github    no se pudo consultar (sin internet?)"
  }

  $sucio = & $GIT status --porcelain
  if ($sucio) {
    Write-Output "  OJO       hay cambios locales sin versionar:"
    $sucio | ForEach-Object { Write-Output ("              " + $_) }
  }
  Pop-Location
} else {
  Write-Output "  no es un repositorio de git, o no hay git instalado"
}

Write-Output ""
Write-Output "--- ARRANQUE ---"
$tarea = Get-ScheduledTask -TaskName $cfg.Tarea -ErrorAction SilentlyContinue
if ($tarea) {
  Write-Output ("  tarea     " + $tarea.State + " (como " + $tarea.Principal.UserId + ")")
  $disparadores = ($tarea.Triggers | ForEach-Object {
    $_.CimClass.CimClassName -replace "MSFT_Task", "" -replace "Trigger", ""
  }) -join ", "
  Write-Output ("  dispara   " + $disparadores)
  $info = $tarea | Get-ScheduledTaskInfo -ErrorAction SilentlyContinue
  if ($info) { Write-Output ("  ultimo    " + $info.LastRunTime) }
} else {
  Write-Output "  tarea     NO EXISTE - corre instalacion\registrar-tarea.ps1"
}

Write-Output ""
Write-Output "--- BASE DE DATOS ---"
& "$PSScriptRoot\verificar-base.ps1" -Panel $cfg.Panel

Write-Output ""
Write-Output "--- COMANDOS ---"
Write-Output "  actualizar   traer cambios de GitHub, recompilar y reiniciar"
Write-Output "  reiniciar    reiniciar sin traer cambios"
Write-Output "  log          ultimas 40 lineas del log"
Write-Output "  estado       esto"
Write-Output ""
