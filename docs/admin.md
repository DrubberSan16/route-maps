# Panel de administración

El panel está en `/admin/` de la misma instalación (por ejemplo
`https://route-map.softwareeasydev.com/admin/`) y también se abre desde el menú
del visor («Administración»). Son páginas estáticas que sirve Nginx: no tienen
paso de compilación, no cargan nada de terceros y solo hablan con la API de la
propia plataforma (`/api/v1/admin/...`). El mapa usa MapLibre y los PMTiles del
mismo servidor.

## Primer administrador

En producción no hay datos de demostración, así que el primer administrador se
crea desde la línea de comandos del servidor, con el stack en marcha:

```bash
make admin-create EMAIL=tu@correo.com NAME="Tu nombre"
# Windows: .\make.ps1 admin-create -Email tu@correo.com -Name "Tu nombre"
```

La contraseña temporal se imprime una sola vez; cámbiala al entrar, en
«Mi cuenta». El mismo comando sobre un correo que ya existe lo convierte en
administrador activo sin tocar su contraseña; con `RESET=1` (`-ResetPassword`)
genera otra temporal. Cada uso queda en la auditoría como «command line».

En desarrollo, con `SEED_DEMO_DATA=true`, existe `admin@maps.local` con la
contraseña `Admin1234!` (rechazada en producción).

## Roles

| Rol | Qué puede hacer |
| --- | --- |
| `ADMIN` | Todo: cuentas, integraciones (llaves de API y webhooks), auditoría, publicar o retirar regiones de mapa y borrar rutas guardadas. |
| `OPERATOR` | La operación diaria: resumen, mapa en vivo, viajes (terminarlos o cancelarlos), dispositivos, geocercas, lugares compartidos, rutas guardadas, sincronización, regiones (solo consulta) y eventos. |
| `USER` | Usa la app y la API; no entra al panel. |

La API aplica los mismos permisos que el panel: ocultar un botón no es la única
barrera. Las cuentas de las integraciones (`svc-…@integrations.invalid`) nunca
inician sesión con contraseña.

## Pantallas

| Pantalla | Para qué sirve |
| --- | --- |
| Resumen | Cifras de la plataforma, actividad de los últimos 14 días, estado de los servicios y avisos (webhooks que fallan, entregas atrasadas, operaciones rechazadas, regiones sin publicar). Se actualiza cada minuto. |
| Mapa en vivo | Viajes en curso con su última posición, cada 15 segundos. |
| Viajes | Búsqueda por nombre, correo o dispositivo, estado, cuenta y fechas; el detalle muestra el recorrido, las geocercas en las que está y permite terminarlo o cancelarlo. |
| Dispositivos | Teléfonos y navegadores de cada cuenta, con su versión de la app y su última conexión. |
| Geocercas | Geocercas de todas las cuentas: crearlas sobre el mapa (círculo o polígono), editarlas, pausarlas o borrarlas. |
| Lugares | Lugares compartidos (visibles para todas las cuentas) y los de cada persona. |
| Rutas guardadas | Rutas de todas las cuentas con su trazado e indicaciones. |
| Sincronización | Operaciones que las apps enviaron desde su cola sin conexión, con el motivo de las rechazadas. |
| Regiones de mapa | Regiones publicadas, sus archivos y cuántos dispositivos las guardan; registrar las preparadas en el servidor y habilitarlas o deshabilitarlas. |
| Eventos | Lo que pasó en la plataforma (viajes, geocercas, regiones) y cómo se entregó a cada webhook. |
| Integraciones | Aplicaciones externas: sus llaves de API, webhooks, entregas y uso. Ver [integración](integration.md#integraciones-llaves-de-api-webhooks-y-eventos). |
| Cuentas | Crear cuentas, cambiar nombre y rol, deshabilitarlas, cerrar sus sesiones, restablecer su contraseña o eliminarlas. |
| Auditoría | Quién cambió qué y cuándo, con la dirección IP. |
| Mi cuenta | Nombre propio, cambio de contraseña y cierre de sesión. |

Las listas se filtran y se recorren por páginas; la dirección de la página
guarda los filtros, así que un enlace copiado abre la misma vista.

## Cuentas y sesiones

- Una cuenta nueva sin contraseña recibe una temporal, que se muestra una sola
  vez. Quien la recibe la cambia en la app («Cuenta y sincronización» >
  «Cambiar contraseña») o, si es del equipo, en «Mi cuenta» del panel.
- Deshabilitar una cuenta o cerrar sus sesiones corta el acceso de inmediato,
  también en la app y en el panel abiertos. La app le explica a la persona qué
  pasó.
- Restablecer la contraseña cierra todas las sesiones de esa cuenta.
- Eliminar una cuenta borra todo lo que guarda (viajes, rutas, geocercas,
  lugares). No se puede eliminar mientras una integración actúe como ella.
- Nadie puede cambiar su propio rol, deshabilitarse, eliminarse ni restablecer
  su propia contraseña desde «Cuentas»: lo propio se cambia en «Mi cuenta».

## Seguridad

- Política de seguridad de contenido estricta: solo scripts, estilos, fuentes y
  datos del mismo servidor, sin código en línea y sin poder abrirse dentro de
  un marco (`frame-ancestors 'none'`).
- El token de acceso vive solo en memoria; el de renovación, en
  `sessionStorage` de la pestaña: cerrarla cierra la sesión. Los tokens rotan en
  cada renovación.
- Los inicios de sesión tienen límite de intentos por dirección IP y la API
  valida cada cambio. Cada cambio de administradores y operadores queda en la
  auditoría.
- Los secretos (llaves de API, secretos de webhooks, contraseñas temporales) se
  muestran una sola vez y no se pueden volver a leer: de las llaves se guarda
  su SHA-256 y los secretos de webhooks se cifran con `INTEGRATIONS_SECRET_KEY`.

## Lo que el panel no hace

- No envía correos: las contraseñas temporales se entregan a mano por un canal
  seguro.
- No tiene inicio de sesión con proveedores externos ni segundo factor.
- No genera mapas: las regiones se preparan con `make prepare-region` o se
  suben con `publish-region.sh`; el panel las registra y las habilita.
- Los eventos se guardan `EVENTS_RETENTION_DAYS` días (30 por defecto).
