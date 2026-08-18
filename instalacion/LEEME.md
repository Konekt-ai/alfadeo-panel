# Instalar el panel en la computadora de la empresa

Windows 10, 64 bits. No hace falta instalar nada a mano: Node va portable
dentro de `C:\alfadeo` y se quita borrando la carpeta.

---

## Instalación

### 1. Clonar

```powershell
git clone https://github.com/Konekt-ai/alfadeo-panel.git C:\alfadeo\panel
cd C:\alfadeo\panel
```

Puedes clonarlo donde quieras; los scripts se orientan solos. `C:\alfadeo\panel`
es simplemente lo que asume el resto de la documentación.

### 2. Correr el instalador

```powershell
powershell -ExecutionPolicy Bypass -File instalacion\instalar.ps1
```

La primera vez se va a detener pidiéndote las llaves de Supabase. Crea
`.env.local` a partir de `.env.example`, lo llenas y lo vuelves a correr:

```powershell
notepad .env.local
powershell -ExecutionPolicy Bypass -File instalacion\instalar.ps1
```

Las dos variables salen de Supabase → *Project Settings → API*. Tiene que ser
la **service role key**, no la anon.

Tarda unos minutos: baja Node (~30 MB), instala dependencias y compila.

### 3. Listo

Al terminar te dice las direcciones. En esa computadora `http://localhost:3002`,
y desde el WiFi de la oficina `http://<ip>:3002`.

En el escritorio quedan tres accesos: **Punto de venta**, **Panel** y
**Probar lector**.

---

## Qué deja instalado

```text
C:\alfadeo\
  node\               Node LTS portable
  panel\              este repo
  config.json         rutas y puerto
  iniciar-panel.ps1   lo que corre la tarea de arranque
  panel.log           log del servidor, se rota solo a los 5 MB
  actualizar.cmd  estado.cmd  reiniciar.cmd  log.cmd
```

- **Arranca solo al prender la computadora**, como tarea programada corriendo
  como `SYSTEM`. No hace falta que nadie inicie sesión — importa si
  administras por SSH y reinicias en remoto.
- **Puerto 3002 abierto** en el firewall para redes privadas, y la red se
  marca como privada si venía como pública (en perfil público Windows bloquea
  todo lo entrante y la regla no aplicaría).
- **`C:\alfadeo` en el PATH**, para que los comandos cortos funcionen apenas
  entras por SSH.

Si no quieres que los celulares de la oficina entren:

```powershell
powershell -ExecutionPolicy Bypass -File instalacion\instalar.ps1 -SinRed
```

---

## Publicar cambios

El ciclo del día a día: programas en tu computadora, pruebas en local,
commiteas y empujas. Luego entras por SSH y corres **un comando**.

```bash
ssh DELL@<ip-de-la-maquina>
estado        # ¿está arriba? ¿en qué commit? ¿hay algo nuevo en GitHub?
actualizar    # traer, recompilar y reiniciar
```

| Comando | Qué hace |
| --- | --- |
| `estado` | Si responde, en qué commit está, si GitHub tiene commits nuevos, cómo va la tarea de arranque y si la base tiene todo |
| `actualizar` | `git fetch` → `reset --hard` → `npm ci` (sólo si cambió el lockfile) → `build` → reiniciar |
| `actualizar -Forzar` | Igual, pero recompila aunque no haya nada nuevo |
| `reiniciar` | Reiniciar sin traer cambios |
| `log` | Últimas 40 líneas de `panel.log` |

Tres cosas que hace a propósito:

- **Si no hay nada nuevo, no toca nada.** No tiene caso tumbar la caja para
  recompilar lo mismo.
- **Compila antes de reiniciar.** Si empujas algo que no compila, el mostrador
  se queda con la versión anterior y el comando te dice por qué falló.
- **Usa `reset --hard`, nunca `pull`.** Esa máquina es un destino de
  despliegue, no un lugar donde se programa: así no puede quedar un conflicto
  de merge a media mañana. Si alguien editó archivos ahí, los enumera antes
  de descartarlos.

---

## La base de datos

**Las migraciones `.sql` no están en este repositorio.** Describen la
operación del negocio y el repo es público — la decisión está en
`PENDIENTES.md`, sección *Seguridad*.

El instalador **verifica** cuáles faltan y te lo dice. Si te reporta alguna,
pídesela a quien administra el proyecto y pégala en Supabase → *SQL Editor*,
en este orden:

1. `cotizador-inteligente.sql`
2. `reunion-catalogo-sucursales.sql`
3. `reunion-operacion.sql`

Las tres son aditivas e idempotentes: se pueden volver a correr sin romper
nada.

Puedes verificar cuando quieras:

```powershell
powershell -ExecutionPolicy Bypass -File instalacion\verificar-base.ps1
```

Después de la tercera, da de alta a las personas que van a operar. **Sin esto
el POS no deja cobrar**, porque exige elegir cajero:

```sql
insert into usuarios_panel (nombre, rol) values
  ('Ana',    'ventas'),
  ('Carlos', 'almacen'),
  ('Diego',  'admin');
```

---

## Administrar por SSH

Windows 10 trae servidor SSH, pero apagado. Para encenderlo, en esa
computadora, con PowerShell **como administrador**:

```powershell
powershell -ExecutionPolicy Bypass -File instalacion\habilitar-ssh.ps1
```

Si prefieres entrar con llave en vez de contraseña:

```powershell
powershell -ExecutionPolicy Bypass -File instalacion\habilitar-ssh.ps1 -ConLlave -LlavePublica "ssh-ed25519 AAAA..."
```

Ojo: si la cuenta de Windows tiene una contraseña floja, encender SSH la
expone a toda la red de la oficina. Vale la pena cambiarla por una larga
antes.

---

## Cuando algo falla

| Síntoma | Qué hacer |
| --- | --- |
| `estado` dice ABAJO | `reiniciar`. Si no sube, `log` |
| Las páginas muestran «Falta correr `reunion-operacion.sql`» | Falta esa migración en Supabase |
| El POS no deja cobrar | No hay usuarios en `usuarios_panel`, o no elegiste cajero en el header |
| La pistola no encuentra nada | `productos.codigo_barras` está vacío. Súbelos en `/inventario/importar` |
| Los precios salen en cero | `productos.precio_base` está vacío |
| Los celulares no entran | El módem cambió la IP por DHCP. Resérvala en el router |
| `actualizar` dice que no alcanza GitHub | Sin internet, o el repo pasó a privado y ahora pide credenciales |
| El comando `estado` no existe | Abre una consola nueva: el PATH se toma al abrirla |

Para reparar sin recompilar todo:

```powershell
# regenerar sólo la tarea de arranque
powershell -ExecutionPolicy Bypass -File instalacion\registrar-tarea.ps1

# regenerar sólo los comandos cortos y los accesos del escritorio
powershell -ExecutionPolicy Bypass -File instalacion\comandos.ps1
powershell -ExecutionPolicy Bypass -File instalacion\accesos.ps1
```

Volver a correr `instalar.ps1` completo también es seguro: es idempotente.

---

## Desinstalar

```powershell
Unregister-ScheduledTask -TaskName "ALFA-DEO Panel" -Confirm:$false
Remove-NetFirewallRule -DisplayName "ALFA-DEO Panel"
Remove-Item C:\alfadeo -Recurse -Force
```

Y quitar `C:\alfadeo` del PATH. No queda nada más: Node y Git eran portables.
