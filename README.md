# Atlas Sísmico Panamá

Mapa interactivo 2D + 3D que representa **los eventos del catálogo público del Instituto de Geociencias de la Universidad de Panamá (IGC-UP)**. La aplicación muestra fichas interactivas al seleccionar epicentros o hipocentros, fecha, hora local, magnitud, profundidad, coordenadas, estado y enlace oficial.

## Publicar GRATIS en GitHub Pages

1. Entra a **https://github.com/new**. Crea un repositorio público, por ejemplo `atlas-sismico-panama`, con rama predeterminada `main`.
2. Descomprime el ZIP de distribución y arrastra **el contenido interior** de la carpeta del proyecto (no el archivo ZIP), incluyendo `index.html`, `sismos.json`, `scripts/` y `.github/`, a **Add file → Upload files** en el repositorio. Confirma con **Commit changes**. (Si estás usando Git, puedes hacer `git add .`, `git commit` y `git push`.)
3. En el repositorio, abre **Settings → Pages → Build and deployment → Source** y selecciona **GitHub Actions**. No selecciones *Deploy from a branch*: la actualización continua por token de GitHub no activaría compilaciones de Pages basadas en ramas.
4. Ve a **Actions → Publicar atlas sísmico → Run workflow → Run workflow**, para forzar el primer despliegue (solo administradores). Revisa que finalice correctamente. El sitio aparecerá en **Settings → Pages**; normalmente será `https://TU_USUARIO.github.io/atlas-sismico-panama/`.
5. El workflow publica los cambios del sitio en `push` y cuando el administrador lo ejecuta manualmente. La recolección periódica está en Cloudflare y no necesita un despliegue de Pages por cada actualización de datos.

La página permanece en GitHub Pages. `assets/config.js` identifica la API pública de datos, sin credenciales. El código del servicio y su configuración están en `cloudflare/`.

## Servicio asíncrono en Cloudflare y actualización sin recargar

El Worker `atlas-sismico-panama-datos` mantiene una copia del catálogo en un **Durable Object con SQLite**. Una alarma persistente consulta la fuente aproximadamente un minuto después de terminar cada descarga. No utiliza cron de GitHub ni cron de Cloudflare. La alarma continúa aunque no haya visitantes; tras una interrupción, la próxima alarma y la copia guardada permiten recuperarse.

Cuando detecta cambios en los eventos, envía el catálogo por **WebSocket** a las pestañas conectadas. Si solo cambió la fecha de descarga o el estado del servicio, envía un mensaje ligero. No vuelve a dibujar el mapa por una versión idéntica. La conexión utiliza la API de hibernación de Cloudflare para no mantener el objeto ejecutándose mientras espera.

- Datos: `https://atlas-sismico-panama-datos.ptydev.workers.dev/sismos.json`
- Diagnóstico: `https://atlas-sismico-panama-datos.ptydev.workers.dev/diagnostico.json`
- Canal: `wss://atlas-sismico-panama-datos.ptydev.workers.dev/live`

Las rutas públicas son de lectura. Ningún visitante puede iniciar una descarga oficial ni modificar datos. La API HTTP permite CORS, `HEAD` y `If-None-Match` con respuesta `304`. KV conserva la copia anterior como semilla de migración; la copia activa y el diagnóstico se guardan juntos en SQLite.

La página conserva filtros, zoom 2D, selección por fecha/hora/coordenadas y la ficha abierta cuando llegan datos nuevos. Los IDs de fila pueden cambiar. Una revisión actualiza la ficha del mismo evento. Un nuevo registro muestra un aviso con la opción de abrirlo; no mueve automáticamente el mapa ni restablece filtros. `uirevision` mantiene la cámara de Plotly entre actualizaciones.

Una pestaña oculta cierra el canal; al volver, se conecta y recibe la versión vigente. La reconexión automática tiene espera progresiva hasta 30 segundos. Si el canal falla, la pestaña visible consulta la copia HTTP cada minuto y usa el archivo del sitio como respaldo. Una copia más antigua nunca sustituye datos más recientes.

**La entrega al navegador es asíncrona, pero la fuente oficial publica HTML y no ofrece aquí un canal push.** El servicio debe comprobarla centralmente. La demora depende de cuándo publique el IGC–UP, de la próxima consulta y de su duración; no se garantiza información instantánea ni un sistema de alerta temprana.

Ante fallos transitorios, cada consulta tiene hasta tres intentos, timeout de 25 segundos y pausas de 2 y 4 segundos. Un HTTP 403 o HTML inválido no provoca una ráfaga de reintentos. Si la consulta sigue fallando, conserva la copia válida y su fecha real; aumenta la espera entre consultas a 2, 4, 8 y hasta 10 minutos. El canal informa del fallo y el diagnóstico muestra la próxima consulta prevista.

Para desplegar el servicio con una sesión autorizada de Cloudflare:

```powershell
npx.cmd wrangler deploy --config cloudflare/wrangler.jsonc
```

La configuración corresponde a esta cuenta, Worker, Durable Object y namespace KV. En otra cuenta, cambia `account_id`, crea tu propio namespace KV o retira la semilla, y ajusta las URLs en `assets/config.js`. No publiques tokens ni `.dev.vars`. GitHub Actions publica el sitio estático; un cambio del servicio requiere desplegar también Wrangler.

No se ha activado un plan de pago. El consumo depende de consultas, almacenamiento y conexiones; no es ilimitado. La configuración limita a 1.000 conexiones simultáneas al canal y permite recuperación HTTP. Referencias: [WebSocket con hibernación](https://developers.cloudflare.com/durable-objects/best-practices/websockets/), [alarmas persistentes](https://developers.cloudflare.com/durable-objects/api/alarms/) y [precios y límites de Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Estado de la fuente y limitaciones

El panel indica `Actualizado el DD/MM/AAAA a las HH:mm` usando **la fecha/hora real de la descarga oficial** en zona `America/Panama`, no el reloj de quien visita. Si falla IGC-UP, conserva el último `sismos.json` publicado; el estado advertirá que la captura no es reciente. El JSON incluido inicialmente es una captura histórica, no una consulta viva.

La descarga realiza hasta tres intentos ante fallos de red o HTTP transitorios (408, 429, 500, 502, 503 y 504), con pausas de 2 y 4 segundos. Una respuesta inválida no sustituye los datos existentes. El diagnóstico de Cloudflare muestra la fecha real de descarga, el número de registros y los intentos. Un resultado verde de GitHub ahora confirma la publicación del sitio, no la recolección de la fuente.

El cron anterior de GitHub se retiró: la actualización de datos ya no depende de que Actions inicie una tarea o vuelva a desplegar Pages. La fecha mostrada siempre es la de la descarga oficial, no la del despliegue ni la de la consulta del visitante.

**No es un sistema de alerta temprana ni sustituye información oficial de emergencia.** Los valores publicados por el IGC-UP pueden ser revisados posteriormente.

## Contenido

### Distritos y resumen geográfico

Los límites distritales permanecen visibles en el mapa 2D desde que carga la cartografía, sin un botón para activarlos o esconderlos. Las líneas son discretas, los nombres aparecen al acercar el zoom y se evita superponerlos a los controles. Tocar tierra selecciona un distrito, sin interferir con las fichas de epicentros ni el arrastre del mapa.

Debajo de la actividad diaria, **Epicentros por distrito** muestra los cinco primeros con barras pequeñas. En móvil la franja se desliza horizontalmente; **Ver todos** amplía los distritos con registros. Seleccionar una fila filtra mapa, lista, gráfico, métricas e histograma y encuadra el distrito en 2D. El botón con el nombre y × quita la selección. El resumen conserva la comparación entre distritos para el período, estado y búsqueda vigentes, antes del filtro distrital; no cuenta únicamente los puntos que se ven en el encuadre del mapa. Las actualizaciones en vivo recalculan los números y conservan la selección y el zoom.

Se comprueba cada coordenada contra los polígonos terrestres del **IGN Tommy Guardia / ANATI**, DPA 2025, límites actualizados a 2024, escala 1:25.000. La capa oficial contiene 83 unidades terrestres, incluyendo representaciones comarcales a nivel distrital: esta cantidad no debe presentarse como el número de municipios de Panamá. Se excluyen las geometrías cuyo uso es masa de agua. Los puntos sin coincidencia aparecen como **Fuera de distritos terrestres**; pueden estar en el mar, otro país o un área no cubierta. No se asignan al distrito más cercano ni se infieren distritos de la descripción del evento. Los conteos representan epicentros registrados, no población afectada ni intensidad percibida.

La copia estática `assets/distritos.json` no consulta ANATI durante la visita y se incluye en la caché PWA. `scripts/preparar_distritos.py` permite regenerarla desde las consultas públicas oficiales. Las coordenadas de clasificación se conservan con precisión de seis decimales, sin generalizar los polígonos; únicamente las líneas dibujadas se generalizan a 0,00035 grados para reducir trabajo gráfico. Los anillos detallados se decodifican cuando una coordenada entra en su caja geográfica, evitando cargar todos los vértices en memoria al abrir el mapa. La clasificación conserva anillos interiores e islas. Los puntos exactamente sobre una frontera se cuentan una sola vez, según el primer código oficial. Es cartografía informativa y no una determinación legal de límites; puntos muy próximos a una frontera pueden cambiar de asignación con una revisión de las coordenadas o de la cartografía.

Créditos y fuente: [División Política Administrativa — IGN Tommy Guardia](https://ignpanama.anati.gob.pa/index.php/25-cdepartamento/cdepartamentocartografia/268-division-politica-administrativa), [geometrías oficiales](https://sigigntg.anati.gob.pa/arcgisserver/rest/services/Distrito/MapServer/0), [atributos DPA 2025](https://sigigntg.anati.gob.pa/arcgisserver/rest/services/Mapa_Web_Divisi%C3%B3n_Pol%C3%ADtica_Administrativa_2025a_MIL1/MapServer/7). La licencia MIT del código propio no cambia los derechos de la cartografía oficial.

| Archivo | Uso |
| --- | --- |
| `index.html` | Atlas 2D/3D y fichas emergentes, responsive, independiente de paquetes externos |
| `sismos.json` | Copia de respaldo del sitio; el catálogo activo se obtiene de Cloudflare |
| `diagnostico.json` | Copia de diagnóstico para distribución; el panel lee el registro activo de Cloudflare |
| `assets/config.js` | URLs públicas HTTP/WebSocket y tiempo de recuperación HTTP |
| `cloudflare/worker.mjs`, `cloudflare/wrangler.jsonc` | Servicio con alarmas, SQLite, WebSocket y API de lectura condicional |
| `assets/map-render.js`, `assets/map-live.js`, `assets/map-live.css` | Etiquetas, tamaño por magnitud, gestos táctiles, avisos y canal en vivo |
| `assets/diagnostico.js`, `assets/diagnostico.css` | Panel de diagnóstico y consulta pública del historial de Actions |
| `scripts/actualizar_sismos.py` | Descarga del HTML y extracción de la tabla a JSON |
| `scripts/generar_diagnostico.py` | Genera el registro público de descarga, sin credenciales |
| `.github/workflows/actualizar-sismos.yml` | Publicación del sitio en `push` y a demanda del administrador |

### Controles para visitantes

Los visitantes pueden pulsar un círculo del mapa 2D, un punto de 3D, o un evento de la lista para mostrar la ficha, cerrarla con × o `Escape`, copiar coordenadas, abrir el registro original, filtrar por período, estado y localidad, y exportar CSV o GeoJSON. No pueden forzar una descarga de la fuente oficial: la realiza el servicio central. El canal entrega cambios y el temporizador HTTP comprueba la copia guardada si se pierde la conexión.

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

El último registro lleva una etiqueta con magnitud y antigüedad en el mapa 2D. El pulso suave solo aparece con datos verificados para un evento de los últimos 30 minutos o durante 90 segundos al recibir un nuevo registro. Un registro antiguo no parpadea; el movimiento reducido desactiva animaciones. El tamaño y el color representan magnitud. Las etiquetas evitan controles y se limitan en móvil para mantener legibilidad. En computadora, pasar el cursor ofrece un resumen y hacer clic abre la ficha. En móvil, tocar un círculo o un evento abre una ficha al pie de la pantalla. Si varios epicentros quedan demasiado juntos, el toque ofrece una lista para escoger el registro. El mapa permite arrastrar con un dedo, acercar con dos y usar botones de zoom de 44 px; el resto de la página conserva el desplazamiento normal. El botón «M · Magnitudes» reduce etiquetas secundarias sin ocultar el último registro o la selección. La imagen social es una captura fija de ejemplo, independiente de las actualizaciones del catálogo.


## Móvil, instalación y avisos push

La primera pantalla móvil prioriza última alerta y mapa. «Opciones» reúne vista 3D, región y etiquetas; los filtros mantienen su panel independiente. El mapa usa Touch Events en el contenedor HTML y mantiene los nodos SVG mientras se arrastra: un dedo mueve, dos acercan y un toque abre la ficha o el selector de sismos cercanos. La selección inicial móvil corresponde al último registro.

El manifiesto y `sw.js` permiten instalar el Atlas. La caché de la PWA conserva la aplicación para abrirla sin conexión; no cachea la API del catálogo ni presenta una captura histórica como información verificada en vivo. `sw.js` se registra bajo `/Atlas/` en GitHub Pages, sin controlar los demás proyectos de la cuenta.

«Avisos push» permite elegir todas las magnitudes o un umbral desde M 3.0 a M 6.0. El permiso se pide al pulsar «Activar avisos», nunca al cargar. En Android/Chrome se pueden habilitar avisos desde el navegador o la app instalada. En iPhone/iPad deben abrirse desde el icono añadido a la pantalla de inicio (iOS/iPadOS 16.4 o posterior). «Probar en este dispositivo» envía una prueba a esa suscripción; «Desactivar avisos» elimina la suscripción y su cola del servidor, y la revoca en el navegador.

El Durable Object guarda la suscripción y el umbral en SQLite y mantiene una cola de envíos. Solo los nuevos registros posteriores al último evento conocido y publicados dentro de las últimas 24 horas generan avisos: no la primera descarga, una revisión o un relleno histórico. Si aparecen varios a la vez, agrupa los que superan el umbral. Hay hasta tres intentos de envío, una vigencia de 30 minutos y limpieza de suscripciones rechazadas con HTTP 404/410. Una respuesta de aceptación del proveedor no confirma la entrega al teléfono. La demora y disponibilidad dependen de la publicación oficial, el servicio, el proveedor push y el dispositivo; estos son avisos del catálogo, no alerta temprana ni detección mediante sensores del teléfono.

La API `/push/public-key` expone únicamente la clave pública VAPID. `/push/subscribe`, `/push/unsubscribe` y `/push/test` aceptan JSON desde el origen del Atlas; las bajas y pruebas requieren la credencial privada de esa suscripción. Las altas validan proveedores conocidos, claves, magnitud y tamaño, con límites por IP y 500 suscripciones para esta demo. No se solicita ubicación ni cuenta personal. Las claves VAPID del servidor se mantienen en secretos de Cloudflare, no en Git ni en el navegador; las direcciones de suscripción no se incluyen en el diagnóstico público.

Para configurar otro Worker, genera claves VAPID y usa `wrangler secret put VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT`. Instala la dependencia fijada con `npm.cmd ci --prefix cloudflare` antes de desplegar. No reemplaces las claves de una instalación activa sin planificar la renovación de suscripciones. `node --test cloudflare/worker.test.mjs cloudflare/push.test.mjs` verifica extracción, fallos, suscripciones, preferencias, cifrado, firma, cola y caducidad.

Referencias: [Web Push en WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [push con Durable Objects](https://developers.cloudflare.com/agents/communication-channels/webhooks/push-notifications/) y [Web Crypto Web Push](https://github.com/block65/webcrypto-web-push).

## Gráfico de magnitud y selección aproximada de réplicas

El botón **Gráfico**, junto al título del mapa, alterna la vista dentro del mismo espacio. Conserva el zoom del mapa al volver. Los puntos representan magnitud frente a fecha y hora de Panamá (UTC−5); tocar un punto abre su ficha. El gráfico comparte el período, estado y localidad con el mapa, la lista y el resumen, y recibe los cambios del canal en vivo.

La línea de tendencia utiliza regresión **LASSO**, con penalización L1 fija **α = 0.10**, indicada en el gráfico. La fecha es la única variable: se expresa en días desde el primer registro, se centra y se divide por su desviación estándar poblacional. El intercepto no se penaliza. Se minimiza `sum((y - pred)^2) / (2n) + α * abs(coeficiente_estandarizado)` mediante la solución exacta de un predictor. La penalización reduce la pendiente y puede producir una línea horizontal en la magnitud media. Sigue siendo una recta descriptiva, no una predicción ni una curva suavizada. El valor de α es una opción fija para exploración; no se optimiza por validación cruzada. No se calcula con menos de dos fechas/horas distintas. Una selección sin eventos muestra un estado vacío. Referencias: [LASSO](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.Lasso.html) y [estandarización](https://scikit-learn.org/stable/modules/generated/sklearn.preprocessing.StandardScaler.html).

**Réplicas** es una selección aproximada solicitada para exploración: usa como referencia el evento de mayor magnitud de todo el catálogo disponible, siempre que alcance M 5, y muestra eventos estrictamente posteriores hasta 100 km de su epicentro, calculados con distancia geodésica sobre una esfera. En empates de magnitud se utiliza el primero cronológicamente. Excluye el sismo principal y los eventos anteriores o simultáneos. La institución no los ha clasificado como réplicas mediante esta herramienta; la referencia y el radio se muestran junto al filtro. Si no hay una referencia de M 5 o mayor, el filtro queda deshabilitado. Esta selección conserva los filtros de estado y localidad y se limita al catálogo disponible; no crea un archivo histórico.

La vista y sus cálculos están en `assets/chart-view.js` y `assets/chart-view.css`; utilizan el motor Plotly ya incluido y no añaden solicitudes a servicios externos.

### Elegir Recta o LOWESS

El selector **Recta / LOWESS** aparece dentro del gráfico y conserva la elección en el dispositivo. **Recta** mantiene LASSO (α = 0.10). **LOWESS** ajusta regresiones lineales locales sobre el 35% de los registros más cercanos en tiempo, con pesos tricúbicos y dos iteraciones robustas de pesos bicuadrados basados en seis veces la mediana de los residuos absolutos. No extrapola fuera de las fechas disponibles. Incluye empates de tiempo en cada vecindad y usa un promedio local cuando no puede estimar una pendiente; si una vecindad pierde todos los pesos robustos, conserva el ajuste con pesos de distancia. La línea une las estimaciones calculadas, sin aplicar una spline visual adicional. El grado de suavizado es fijo para esta opción de exploración.

El cálculo utiliza los eventos filtrados y se actualiza cuando cambian fechas o magnitudes; cambiar de método conserva el rango elegido por el visitante. Las estimaciones se reutilizan durante desplazamientos, selecciones y cambios de tamaño para mantener la interacción fluida. Ambos métodos son descriptivos. Referencia: [LOWESS y sus parámetros](https://www.statsmodels.org/stable/generated/statsmodels.nonparametric.smoothers_lowess.lowess.html).
