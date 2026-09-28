# Rutas, tráfico y clima

La instalación usa `ROUTING_PROVIDER=native`. El backend carga
`storage/imports/native/ecuador/roads.geojson`, construye un grafo dirigido en
memoria y calcula el camino mínimo sin consultar servicios cartográficos en
tiempo de ejecución.

## Cálculo

`POST /api/v1/routes/calculate` acepta `origin`, `destination`, `waypoints` y
los perfiles `CAR`, `TRUCK` y `MOTORCYCLE`. La respuesta incluye distancia,
geometría, instrucciones y el bloque `conditions`.

El tiempo base se deriva del perfil. Después, la misma geometría se valida con:

- tráfico propio: puntos GPS de los últimos 15 minutos a menos de 150 m de la
  ruta; se requieren al menos 5 muestras y 3 viajes distintos;
- clima local: regiones de precipitación del inventario nacional almacenadas en
  `climate-precipitation-regions.geojson`.

Si hay tráfico suficiente, `adjustedDurationSeconds` incorpora el retraso
observado, limitado a 2,5 veces el tiempo base. Sin muestra suficiente se
devuelve `traffic.status=insufficient_data`; nunca se inventa congestión. El
clima actual disponible es climatología anual, no una observación meteorológica
en vivo, y se identifica como `climate.status=climatology`.

## Tráfico por zona

`GET /api/v1/tracking/traffic` requiere una caja `minLat`, `minLng`, `maxLat` y
`maxLng`. Devuelve celdas de aproximadamente 0,001 grados únicamente cuando se
cumple el umbral de privacidad de 5 muestras y 3 viajes. Los datos salen de los
viajes de esta plataforma y no de un proveedor de tráfico.

## Geocodificación

`GEOCODING_PROVIDER=native` indexa localidades, salud, educación y turismo desde
`storage/imports/native/ecuador`. La búsqueda inversa devuelve el punto oficial
más cercano dentro de 25 km. No hay un proceso externo de geocodificación.

## Límites conocidos

La red disponible es la Red Vial Estatal publicada a nivel nacional. No incluye
automáticamente cada calle municipal ni restricciones de giro que no estén en
esa publicación. Las opciones `avoidTolls`, `avoidHighways` y `avoidFerries` se
aceptan por compatibilidad, pero el grafo oficial actual no tiene atributos
suficientes para garantizar esos filtros.
