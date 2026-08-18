# Rutas y utilidades que comparten todos los scripts de instalacion.
#
# Se carga con:  . "$PSScriptRoot\comun.ps1"
#
# Todo en ASCII a proposito: PowerShell 5.1 lee los .ps1 sin BOM como ANSI,
# y un acento se corrompe al copiarse entre maquinas y puede romper una
# cadena a medias. No se usan acentos en estos archivos.

# El repo es la carpeta que contiene a instalacion/.
$script:PANEL = Split-Path $PSScriptRoot -Parent

# Donde viven Node, los logs y los comandos cortos. Fuera del repo, para que
# `git reset --hard` nunca los toque.
function Get-Config {
    param([string]$Raiz = "C:\alfadeo")

    $cfgPath = Join-Path $Raiz "config.json"
    if (Test-Path $cfgPath) {
        $c = Get-Content $cfgPath -Raw | ConvertFrom-Json
        return [pscustomobject]@{
            Panel  = $c.panel
            Raiz   = $c.raiz
            Puerto = [int]$c.puerto
            Tarea  = $c.tarea
        }
    }
    return [pscustomobject]@{
        Panel  = $script:PANEL
        Raiz   = $Raiz
        Puerto = 3002
        Tarea  = "ALFA-DEO Panel"
    }
}

function Save-Config {
    param($Cfg)
    New-Item -ItemType Directory -Force -Path $Cfg.Raiz | Out-Null
    @{
        panel  = $Cfg.Panel
        raiz   = $Cfg.Raiz
        puerto = $Cfg.Puerto
        tarea  = $Cfg.Tarea
    } | ConvertTo-Json | Set-Content -Path (Join-Path $Cfg.Raiz "config.json") -Encoding UTF8
}

function Get-NodeExe   { param($Cfg) Join-Path $Cfg.Raiz "node\node.exe" }
function Get-NpmCmd    { param($Cfg) Join-Path $Cfg.Raiz "node\npm.cmd" }
function Get-LogPath   { param($Cfg) Join-Path $Cfg.Raiz "panel.log" }

# git puede ser el portable que instalamos o el que ya tenga la maquina.
function Get-GitExe {
    param($Cfg)
    $portable = Join-Path $Cfg.Raiz "git\cmd\git.exe"
    if (Test-Path $portable) { return $portable }
    $delSistema = Get-Command git -ErrorAction SilentlyContinue
    if ($delSistema) { return $delSistema.Source }
    return $null
}

function Test-PanelArriba {
    param($Cfg, [int]$TimeoutSec = 5)
    try {
        $r = Invoke-WebRequest ("http://localhost:{0}/inicio" -f $Cfg.Puerto) -UseBasicParsing -TimeoutSec $TimeoutSec
        return $r.StatusCode
    } catch { return $null }
}

function Stop-Panel {
    param($Cfg)
    try { Stop-ScheduledTask -TaskName $Cfg.Tarea -ErrorAction SilentlyContinue } catch { }
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*next*start*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

# Arranca y espera a que conteste. Devuelve $true si contesto.
function Start-Panel {
    param($Cfg, [int]$EsperaSeg = 60)
    Start-ScheduledTask -TaskName $Cfg.Tarea
    $limite = [int]($EsperaSeg / 2)
    for ($i = 0; $i -lt $limite; $i++) {
        Start-Sleep -Seconds 2
        $code = Test-PanelArriba -Cfg $Cfg
        if ($code) {
            Write-Output ("panel: HTTP {0} en {1}s" -f $code, (($i + 1) * 2))
            return $true
        }
    }
    return $false
}

function Get-IpLan {
    $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" -or $_.IPAddress -like "172.*" } |
        Select-Object -First 1
    if ($ip) { return $ip.IPAddress }
    return $null
}

# Agrega una carpeta al PATH sin duplicar ni pisar lo que ya habia.
function Add-AlPath {
    param([string]$Carpeta, [string]$Ambito = "User")
    try {
        $p = [Environment]::GetEnvironmentVariable("Path", $Ambito)
        if ($null -eq $p) { $p = "" }
        if ($p -like "*$Carpeta*") { return "ya estaba" }
        $partes = $p -split ";" | Where-Object { $_ -ne "" }
        [Environment]::SetEnvironmentVariable("Path", ((@($Carpeta) + $partes) -join ";"), $Ambito)
        return "agregado"
    } catch {
        return "no se pudo ($Ambito requiere admin)"
    }
}

# ---------------------------------------------------------- ejecutables ---
# PowerShell 5.1 convierte el stderr de un .exe en un ErrorRecord, y con
# $ErrorActionPreference = "Stop" eso ABORTA el script aunque el programa
# haya terminado bien. psql avisa por stderr en cada NOTICE, initdb avisa del
# metodo de autenticacion... y la instalacion moria a media obra.
#
# Este ayudante los corre con la preferencia relajada y juzga por el codigo
# de salida, que es lo unico que de verdad dice si funciono.
#
# OJO: el parametro NO se puede llamar $Args. Es una variable automatica de
# PowerShell y el enlace se rompe en silencio: el .exe corre SIN argumentos.
function Nativo {
  param([string]$Exe, [string[]]$Argumentos, [switch]$Silencioso)
  $previo = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    $salida = & $Exe @Argumentos 2>&1
    $codigo = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previo
  }
  if (-not $Silencioso) {
    foreach ($l in $salida) {
      $t = "$l".Trim()
      if ($t) { Write-Output ("      " + $t) }
    }
  }
  return [pscustomobject]@{ codigo = $codigo; salida = ($salida -join "`n") }
}
