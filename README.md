# Atlas Sísmico Panamá

Mapa interactivo 2D + 3D que representa **los eventos del catálogo público del Instituto de Geociencias de la Universidad de Panamá (IGC-UP)**. La aplicación muestra fichas interactivas al seleccionar epicentros o hipocentros, fecha, hora local, magnitud, profundidad, coordenadas, estado y enlace oficial.

## Publicar GRATIS en GitHub Pages

1. Entra a **https://github.com/new**. Crea un repositorio público, por ejemplo `atlas-sismico-panama`, con rama predeterminada `main`.
2. Descomprime el ZIP de distribución y arrastra **el contenido interior** de la carpeta del proyecto (no el archivo ZIP), incluyendo `index.html`, `sismos.json`, `scripts/` y `.github/`, a **Add file → Upload files** en el repositorio. Confirma con **Commit changes**. (Si estás usando Git, puedes hacer `git add .`, `git commit` y `git push`.)
3. En el repositorio, abre **Settings → Pages → Build and deployment → Source** y selecciona **GitHub Actions**. No selecciones *Deploy from a branch*: la actualización continua por token de GitHub no activaría compilaciones de Pages basadas en ramas.
4. Ve a **Actions → Actualizar y publicar atlas sísmico → Run workflow → Run workflow**, para forzar el primer despliegue (solo administradores). Revisa que finalice correctamente. El sitio aparecerá en **Settings → Pages**; normalmente será `https://TU_USUARIO.github.io/atlas-sismico-panama/`.
5. El workflow publica los cambios del sitio en `push` y cuando el administrador lo ejecuta manualmente. La recolección periódica está en Cloudflare y no necesita un despliegue de Pages por cada actualización de datos.

La página permanece en GitHub Pages. `assets/config.js` identifica la API pública de datos, sin credenciales. El código del colector y su cron están en `cloudflare/`.

## Recolección en Cloudflare y actualización sin recargar

El Worker `atlas-sismico-panama-datos` consulta el catálogo oficial **cada diez minutos**, con hasta tres intentos para errores transitorios y timeout de 25 segundos por intento. Conserva catálogo y diagnóstico juntos en Workers KV. Una descarga fallida mantiene los últimos eventos válidos y su fecha real, publica el error y deja la ejecución programada marcada como fallida. Ninguna ruta pública permite iniciar una descarga ni escribir datos.

API pública: `https://atlas-sismico-panama-datos.ptydev.workers.dev/sismos.json`. El diagnóstico está en `/diagnostico.json`. La API permite lectura CORS, `HEAD`, preflight y peticiones condicionales `If-None-Match`; una versión sin cambios devuelve `304`, sin reenviar el catálogo.

La pestaña visible comprueba la versión **cada minuto** con `fetch()`. Si cambia el catálogo, actualiza mapa, lista y último evento sin recargar la página. Conserva filtros, zoom 2D y selección por fecha/hora/coordenadas; los IDs de fila pueden cambiar. La ficha abierta recibe las correcciones del evento. Una versión idéntica no redibuja marcadores. `uirevision` mantiene la cámara de Plotly entre actualizaciones. La comprobación se pausa con la pestaña oculta y se retoma al regresar; también reintenta al recuperar conexión. Si la API falla, intenta leer `sismos.json` como respaldo y nunca retrocede a una fecha anterior a la que ya muestra.

Esto detecta cambios mediante consultas periódicas, no mediante notificaciones push de la fuente. El intervalo observable depende de la publicación oficial, el cron, la propagación de KV y la comprobación del navegador. No ofrece actualización instantánea. Cloudflare advierte que los cambios de cron pueden tardar hasta 15 minutos en propagarse y KV tiene consistencia eventual.

Para desplegar cambios del colector, con una sesión autorizada de Cloudflare:

```powershell
cd cloudflare
npx.cmd wrangler deploy
```

La configuración incluida corresponde al Worker y namespace KV de este proyecto. Al instalarlo en otra cuenta, crea tu propio namespace y cambia `account_id`, `kv_namespaces[].id` y las URLs de `assets/config.js`. No publiques tokens ni archivos `.dev.vars`. `node --test cloudflare/worker.test.mjs` valida extracción, reintentos, conservación de datos y API condicional.

El cron hace 144 sincronizaciones diarias y una escritura KV por ejecución. Cada comprobación de una pestaña consume una petición al Worker y una lectura KV, incluso si devuelve `304`. Los límites gratuitos publicados son 100.000 peticiones Worker/día, 100.000 lecturas KV/día y 1.000 escrituras KV/día, compartidos con los demás usos de la cuenta. No se ha activado un plan de pago. Referencias: [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/), [Workers KV](https://developers.cloudflare.com/kv/concepts/how-kv-works/), [límites Workers](https://developers.cloudflare.com/workers/platform/limits/) y [límites KV](https://developers.cloudflare.com/kv/platform/limits/).

## Estado de la fuente y limitaciones

El panel indica `Actualizado el DD/MM/AAAA a las HH:mm` usando **la fecha/hora real de la descarga oficial** en zona `America/Panama`, no el reloj de quien visita. Si falla IGC-UP, conserva el último `sismos.json` publicado; el estado advertirá que la captura no es reciente. El JSON incluido inicialmente es una captura histórica, no una consulta viva.

La descarga realiza hasta tres intentos ante fallos de red o HTTP transitorios (408, 429, 500, 502, 503 y 504), con pausas de 2 y 4 segundos. Una respuesta inválida no sustituye los datos existentes. El diagnóstico de Cloudflare muestra la fecha real de descarga, el número de registros y los intentos. Un resultado verde de GitHub ahora confirma la publicación del sitio, no la recolección de la fuente.

El cron anterior de GitHub se retiró: la actualización de datos ya no depende de que Actions inicie una tarea o vuelva a desplegar Pages. La fecha mostrada siempre es la de la descarga oficial, no la del despliegue ni la de la consulta del visitante.

**No es un sistema de alerta temprana ni sustituye información oficial de emergencia.** Los valores publicados por el IGC-UP pueden ser revisados posteriormente.

## Contenido

| Archivo | Uso |
| --- | --- |
| `index.html` | Atlas 2D/3D y fichas emergentes, responsive, independiente de paquetes externos |
| `sismos.json` | Copia de respaldo del sitio; el catálogo activo se obtiene de Cloudflare |
| `diagnostico.json` | Copia de diagnóstico para distribución; el panel lee el registro activo de Cloudflare |
| `assets/config.js` | URLs públicas del colector y tiempo de comprobación |
| `cloudflare/worker.mjs`, `cloudflare/wrangler.jsonc` | Recolección programada, KV y API de lectura condicional |
| `assets/diagnostico.js`, `assets/diagnostico.css` | Panel de diagnóstico y consulta pública del historial de Actions |
| `scripts/actualizar_sismos.py` | Descarga del HTML y extracción de la tabla a JSON |
| `scripts/generar_diagnostico.py` | Genera el registro público de descarga, sin credenciales |
| `.github/workflows/actualizar-sismos.yml` | Publicación del sitio en `push` y a demanda del administrador |

### Controles para visitantes

Los visitantes pueden pulsar un círculo del mapa 2D, un punto de 3D, o un evento de la lista para mostrar la ficha, cerrarla con × o `Escape`, copiar coordenadas, abrir el registro original, filtrar por magnitud/profundidad/fecha y exportar CSV o GeoJSON. No pueden forzar una descarga de la fuente oficial: solo el cron de Cloudflare hace la recolección. El temporizador del navegador comprueba la copia guardada.

## Diagnóstico de actualización

El botón **Diagnóstico de actualización**, al pie del sitio, muestra la fecha real de los datos, el registro de la última descarga en Cloudflare (HTTP, duración, intentos y errores), las últimas 20 publicaciones de GitHub y las consultas de la pestaña actual. Su resumen evalúa la salud de Cloudflare, independientemente del historial de publicación. Cada publicación enlaza con sus registros completos en GitHub; se puede descargar un informe JSON para analizarlo.

El historial se consulta mediante la API pública de GitHub, sin credenciales, únicamente al abrir el panel o solicitar otra consulta, con al menos un minuto entre consultas. Si la API limita o rechaza la lectura, el panel lo indica por separado: ese error no prueba un bloqueo de la fuente sísmica. El panel no inicia workflows ni descargas oficiales. El registro de Cloudflare se guarda en cada recolección, incluso si la descarga falla. Los registros del navegador son de la sesión actual y se reinician al recargar.

## Licencia y créditos

El código propio del Atlas Sísmico Panamá se distribuye bajo la licencia MIT. Esta licencia no se extiende a los datos sísmicos, mapas, bibliotecas ni otros recursos de terceros, que conservan sus respectivos términos y avisos de autoría.

**Fuente oficial de los datos sísmicos:** Instituto de Geociencias de la Universidad de Panamá (IGC-UP), a través de su [catálogo público de sismos](https://sismosgeociencias.up.ac.pa/).

Se reconoce al IGC-UP por la publicación de la información utilizada en este atlas. Los registros pueden ser revisados por la institución; para consultar la información de origen, visite su página oficial. Este atlas es un proyecto independiente y no implica respaldo ni afiliación oficial con el IGC-UP o la Universidad de Panamá.

## Mapa y último evento

La franja «Última alerta» muestra el evento más reciente de todo el catálogo IGC-UP, independientemente de los filtros. Es información del catálogo, no un aviso oficial de emergencia. Su botón abre el evento en el mapa y, si los filtros lo ocultan, los restablece para mostrarlo. El control «Ampliar mapa» permite dedicar todo el ancho al mapa.


En móviles, la alerta y el mapa aparecen primero. Los filtros se abren con «Filtros» y los detalles se consultan tocando un círculo o un evento de la lista. Las etiquetas y marcadores se ajustan al tamaño de pantalla.

El último registro lleva un pulso suave y una etiqueta con su magnitud en el mapa 2D; el pulso se desactiva si el dispositivo solicita movimiento reducido. En computadora, pasar el cursor ofrece un resumen y hacer clic abre la ficha. En móvil, tocar un círculo o un evento abre una ficha al pie de la pantalla. La imagen social es una captura fija de ejemplo, independiente de las actualizaciones del catálogo.
