<#
.SYNOPSIS
  Enciende el servidor SSH de Windows para poder administrar el panel en
  remoto.

.DESCRIPTION
  Windows 10 trae OpenSSH Server, pero apagado. Esto lo instala, lo deja
  arrancando solo y abre el puerto 22 en redes privadas.

  REQUIERE ADMINISTRADOR. Abre PowerShell con "Ejecutar como administrador".

  Despues de esto, desde tu computadora:

    ssh <usuario>@<ip-de-la-maquina>
    estado

  Ojo con la contrasena: si la cuenta de Windows tiene una contrasena
  facil, encender SSH la expone a toda la red de la oficina. Vale la pena
  cambiarla por una larga antes de encender esto.
#>
param([switch]$ConLlave, [string]$LlavePublica = "")

$ErrorActionPreference = "Stop"

$soyAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
            ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $soyAdmin) {
  Write-Output "Esto necesita permisos de administrador."
  Write-Output "Abre PowerShell con 'Ejecutar como administrador' y vuelve a correrlo."
  exit 1
}

$cap = Get-WindowsCapability -Online -Name "OpenSSH.Server*" | Select-Object -First 1
if ($cap.State -ne "Installed") {
  Write-Output "instalando OpenSSH Server..."
  Add-WindowsCapability -Online -Name $cap.Name | Out-Null
} else {
  Write-Output "OpenSSH Server: ya estaba instalado"
}

Start-Service sshd
Set-Service -Name sshd -StartupType Automatic
Write-Output "servicio sshd: arrancado y en automatico"

if (-not (Get-NetFirewallRule -Name "sshd" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -Name sshd -DisplayName "OpenSSH Server" -Enabled True `
    -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -Profile Private,Domain | Out-Null
  Write-Output "firewall: puerto 22 abierto en redes privadas"
} else {
  Write-Output "firewall: la regla de sshd ya existia"
}

# Con llave publica se puede entrar sin teclear contrasena, que es lo comodo
# para administrar. En Windows, si el usuario es administrador la llave NO
# va en su carpeta personal sino en el archivo comun de administradores:
# es el tropiezo clasico al configurar esto.
if ($ConLlave) {
  if ($LlavePublica -eq "") { throw "Pasa la llave con -LlavePublica 'ssh-ed25519 AAAA...'" }
  $archivo = "C:\ProgramData\ssh\administrators_authorized_keys"
  Add-Content -Path $archivo -Value $LlavePublica -Encoding ASCII
  icacls $archivo /inheritance:r /grant "Administrators:F" /grant "SYSTEM:F" | Out-Null
  Write-Output ("llave agregada a " + $archivo)
}

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -like "192.168.*" -or $_.IPAddress -like "10.*" } |
  Select-Object -First 1).IPAddress

Write-Output ""
Write-Output ("Ya puedes entrar con:  ssh " + $env:USERNAME + "@" + $ip)
