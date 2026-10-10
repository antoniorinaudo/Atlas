# Atlas Sísmico Panamá

Mapa interactivo 2D + 3D que representa **los eventos del catálogo público del Instituto de Geociencias de la Universidad de Panamá (IGC-UP)**. La aplicación muestra fichas interactivas al seleccionar epicentros o hipocentros, fecha, hora local, magnitud, profundidad, coordenadas, estado y enlace oficial.

## Publicar GRATIS en GitHub Pages

1. Entra a **https://github.com/new**. Crea un repositorio público, por ejemplo `atlas-sismico-panama`, con rama predeterminada `main`.
2. Descomprime el ZIP de distribución y arrastra **el contenido interior** de la carpeta del proyecto (no el archivo ZIP), incluyendo `index.html`, `sismos.json`, `scripts/` y `.github/`, a **Add file → Upload files** en el repositorio. Confirma con **Commit changes**. (Si estás usando Git, puedes hacer `git add .`, `git commit` y `git push`.)
3. En el repositorio, abre **Settings → Pages → Build and deployment → Source** y selecciona **GitHub Actions**. No selecciones *Deploy from a branch*: la actualización continua por token de GitHub no activaría compilaciones de Pages basadas en ramas.
4. Ve a **Actions → Actualizar y publicar atlas sísmico → Run workflow → Run workflow**, para forzar el primer despliegue (solo administradores). Revisa que finalice correctamente. El sitio aparecerá en **Settings → Pages**; normalmente será `https://TU_USUARIO.github.io/atlas-sismico-panama/`.
5. Sin interacción de visitantes, el workflow buscará los datos oficiales cada 10 minutos y **desplegará de nuevo el sitio directamente**; el navegador de cada visitante comprobará el `sismos.json` del mismo dominio cada 10 minutos cuando mantenga abierta la pestaña.

**No necesitas servidor, clave, backend o cron externo.** Las acciones en repositorios públicos son gratuitas con las condiciones actuales de GitHub. El script solo utiliza la librería estándar de Python.

## Estado de la fuente y limitaciones

El panel indica `Actualizado el DD/MM/AAAA a las HH:mm` usando **la fecha/hora real de la descarga oficial** en zona `America/Panama`, no el reloj de quien visita. Si falla IGC-UP, conserva el último `sismos.json` publicado; el estado advertirá que la captura no es reciente. El JSON incluido inicialmente es una captura histórica, no una consulta viva.

La descarga realiza hasta tres intentos ante fallos de red o HTTP transitorios (408, 429, 500, 502, 503 y 504), con pausas de 2 y 4 segundos. Una respuesta inválida no sustituye los datos existentes. El resumen de Actions muestra la fecha real de descarga y el número de registros; si se agotan los intentos, el sitio conserva su última copia válida y el workflow queda marcado como fallido. Un resultado verde confirma que la descarga y la publicación terminaron correctamente, pero no garantiza que GitHub inicie la siguiente ejecución programada.

GitHub Actions **no garantiza periodicidad exacta**; los disparadores programados pueden retrasarse/omitirse y GitHub puede desactivar los schedules de repositorios públicos sin actividad tras 60 días. GitHub Pages tiene su propia latencia de despliegue, por lo que el indicador de última actualización es la referencia de frescura.

**No es un sistema de alerta temprana ni sustituye información oficial de emergencia.** Los valores publicados por el IGC-UP pueden ser revisados posteriormente.

## Contenido

| Archivo | Uso |
| --- | --- |
| `index.html` | Atlas 2D/3D y fichas emergentes, responsive, independiente de paquetes externos |
| `sismos.json` | Captura inicial, sustituida en cada ejecución cuando IGC-UP responde |
| `scripts/actualizar_sismos.py` | Descarga del HTML y extracción de la tabla a JSON |
| `.github/workflows/actualizar-sismos.yml` | Actualización, build y publicación cada 10 minutos, también en `push` y a demanda del administrador |

### Controles para visitantes

Los visitantes pueden pulsar un círculo del mapa 2D, un punto de 3D, o un evento de la lista para mostrar la ficha, cerrarla con × o `Escape`, copiar coordenadas, abrir el registro original, filtrar por magnitud/profundidad/fecha y exportar CSV o GeoJSON. **No pueden forzar una consulta de actualización**: solo las programaciones públicas del workflow y el temporizador de lectura del navegador refrescan datos.

## Licencia y créditos

El código propio del Atlas Sísmico Panamá se distribuye bajo la licencia MIT. Esta licencia no se extiende a los datos sísmicos, mapas, bibliotecas ni otros recursos de terceros, que conservan sus respectivos términos y avisos de autoría.

**Fuente oficial de los datos sísmicos:** Instituto de Geociencias de la Universidad de Panamá (IGC-UP), a través de su [catálogo público de sismos](https://sismosgeociencias.up.ac.pa/).

Se reconoce al IGC-UP por la publicación de la información utilizada en este atlas. Los registros pueden ser revisados por la institución; para consultar la información de origen, visite su página oficial. Este atlas es un proyecto independiente y no implica respaldo ni afiliación oficial con el IGC-UP o la Universidad de Panamá.

## Mapa y último evento

La franja «Última alerta» muestra el evento más reciente de todo el catálogo IGC-UP, independientemente de los filtros. Es información del catálogo, no un aviso oficial de emergencia. Su botón abre el evento en el mapa y, si los filtros lo ocultan, los restablece para mostrarlo. El control «Ampliar mapa» permite dedicar todo el ancho al mapa.


En móviles, la alerta y el mapa aparecen primero. Los filtros se abren con «Filtros» y los detalles se consultan tocando un círculo o un evento de la lista. Las etiquetas y marcadores se ajustan al tamaño de pantalla.

El último registro lleva un pulso suave y una etiqueta con su magnitud en el mapa 2D; el pulso se desactiva si el dispositivo solicita movimiento reducido. En computadora, pasar el cursor ofrece un resumen y hacer clic abre la ficha. En móvil, tocar un círculo o un evento abre una ficha al pie de la pantalla. La imagen social es una captura fija de ejemplo, independiente de las actualizaciones del catálogo.
