# Rutas, tráfico y clima

La instalación usa `ROUTING_PROVIDER=native`. El backend carga `graph.bin` (generado por
`native-data build`, ~40 MB para todo el país) en arreglos tipados y calcula las rutas en el mismo proceso,
sin consultar servicios cartográficos.

## Grafo

- **Calles**: los ejes viales del Marco Geoestadístico del INEC (todas las áreas amanzanadas del país),
  con su tipo (`AVENIDA`, `CALLE`, `PASAJE`, `PEATONAL`, `ESCALINATA`…) y nombre.
- **Red vial estatal**: completa (nunca se corta), con su numeración (`E40`) y jerarquía. Las calles que
  la duplican dentro de un pueblo heredan su número y clase; en el mapa solo se dibuja una de las dos.
- **Reparaciones topológicas**: las líneas se parten en los vértices compartidos; los extremos sueltos a
  menos de 3 m de otra calle (errores de digitalización) se unen; los extremos de la red estatal se unen a
  la calle o carretera más cercana (60 m, 300 m entre tramos estatales); cada extremo de calle a menos de
  15 m de una carretera se enlaza con ella.
- **Carreteras que terminan antes del pueblo**: la capa estatal omite muchos tramos urbanos (la E30 se
  corta antes de Pelileo). Un extremo estatal suelto se une a la vía más cercana (hasta 1 km) que la red
  no alcanza ya por un camino corto (3 veces la distancia + 1 km); si no hay, al siguiente tramo de la
  misma vía numerada (hasta 6 km). Son tramos aproximados, nunca sobre agua. Sin esta regla, Ambato →
  Baños daba 131 km por Riobamba; ahora 41 km por Pelileo.
- **Pueblos aislados**: si el acceso de un pueblo a la red nacional no está en ninguna fuente, se agrega
  un enlace recto de hasta 6 km, solo si todo el trazo está sobre tierra (parroquias sin ríos ni mar). Estos
  enlaces llevan la marca `approximate`: la respuesta los informa en `approximateSections`, la indicación
  lo dice ("tramo aproximado… sin vía registrada") y el visor los dibuja punteados.

## Cálculo

`POST /api/v1/routes/calculate` acepta `origin`, `destination`, hasta 23 `waypoints`, `alternatives` y los
perfiles `CAR`, `TRUCK`, `MOTORCYCLE`, `BICYCLE` y `PEDESTRIAN`.

- **Ajuste a la vía**: cada punto se proyecta sobre el tramo más cercano utilizable por el perfil (no sobre
  un vértice). Si origen y destino caen en fragmentos distintos de la red, se buscan los tramos cercanos
  (2 km) que compartan red y, si no existen, se usa la red principal más cercana (hasta 30 km).
- **Búsqueda**: A* sobre tiempo de viaje con velocidades por clase de vía y perfil (urbanas y de carretera),
  demora en intersecciones urbanas, vías lastradas más lentas. Peatones y bicicletas usan peatonales y
  escalinatas (bicicletas no suben escaleras); los vehículos no.
- **Alternativas**: método de penalización (las vías de las rutas ya halladas cuestan más); una alternativa
  se acepta si tarda como máximo un 45 % más y comparte menos del 70 % del trayecto.
- **Indicaciones**: en español (o inglés con `language: en`), con nombres oficiales de calles, giros
  (leve, normal, fuerte, en U), redondeles con número de salida y paradas intermedias.

La respuesta incluye además `conditions`:

- tráfico propio: puntos GPS de los últimos 15 minutos a menos de 150 m de la ruta; se requieren al menos
  5 muestras y 3 viajes distintos; si hay retraso, `adjustedDurationSeconds` lo incorpora (máximo 2,5 veces);
- clima: regiones de precipitación anual que cruza la ruta, con avisos para zonas muy lluviosas.

Sin muestra suficiente se devuelve `traffic.status=insufficient_data`; nunca se inventa congestión. El clima
es climatología, no una observación en vivo (`climate.status=climatology`).

## Tráfico y actividad para el mapa

- `GET /api/v1/traffic/flow?bbox=minLng,minLat,maxLng,maxLat`: tramos de vía con velocidad medida en los
  últimos 15 minutos (GeoJSON). Cada punto GPS se asocia al tramo más cercano (25 m); un tramo aparece con
  al menos 3 muestras de 2 viajes distintos, clasificado como `free`, `moderate`, `slow` o `jammed` según
  la relación con la velocidad libre de su clase (`source: live`). Donde no hay datos en vivo se añade el
  tráfico habitual: velocidades del mismo tipo de día (lunes a viernes, sábado o domingo) y de la misma
  hora ±1 en las últimas 4 semanas, con al menos 3 viajes (`source: typical`, hora local de
  `TRAFFIC_TIME_ZONE`). Los clientes los dibujan más tenues.
- `GET /api/v1/traffic/activity?bbox=…`: mapa de calor de las últimas 24 horas en celdas de ~100 m que
  reunieron al menos 3 viajes distintos.
- `GET /api/v1/tracking/traffic`: celdas agregadas de la versión anterior (se mantiene por compatibilidad).

La caja admite como máximo 2,5 grados por lado. Los datos provienen únicamente de los recorridos de esta
plataforma.

## Geocodificación

`GEOCODING_PROVIDER=native` busca en `search.ndjson`: provincias, cantones, parroquias, ciudades y
localidades del censo, barrios de Guayaquil y Quito, calles (una entrada por nombre y parroquia), 130 mil
puntos de interés y los alias populares. Cada palabra de la consulta debe aparecer en el nombre o en su
contexto (parroquia, cantón, provincia), la última puede estar incompleta y los plurales se reducen
("hospitales"). Las palabras de tipo de vía ("calle", "avenida", "parque") no filtran. El orden combina
cobertura del nombre, importancia y distancia al centro del mapa del cliente: una ciudad con el nombre
exacto va antes que las calles homónimas ("Ambato" desde Guayaquil), salvo que se escriba el tipo de vía
("Av. Ambato"), y los lugares del país van antes que sus homónimos del mundo ("Santo Domingo"). Las
respuestas se guardan 24 h en caché con la versión del índice y del grafo en la clave, así que datos
nuevos se usan de inmediato.

Las intersecciones ("Av. 9 de Octubre y Boyacá", "Amazonas & Naciones Unidas") se resuelven en el grafo:
el resultado es el cruce exacto de ambas calles. La búsqueda inversa devuelve la calle más cercana (60 m),
el punto de interés a menos de 25 m y la parroquia, cantón y provincia.

La comprobación pública `./infrastructure/scripts/validate-coverage.sh <url>` prueba la búsqueda de las
24 capitales provinciales, pares de lugares en las principales ciudades, rutas interurbanas y los perfiles
peatonal y bicicleta. Debe ejecutarse contra el mismo URL que usarán los clientes antes de publicar datos.

## Límites conocidos

- La cartografía censal no tiene sentidos de circulación ni restricciones de giro: las rutas pueden usar una
  calle de un solo sentido en contra.
- Las vías rurales que no son estatales ni están dentro de un área amanzanada no existen en las fuentes; por
  eso algunos accesos son tramos aproximados.
- `avoidTolls`, `avoidHighways` y `avoidFerries` se aceptan por compatibilidad, pero las fuentes no tienen
  atributos suficientes para garantizarlos.
