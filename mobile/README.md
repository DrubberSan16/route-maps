# App móvil (Flutter)

Aplicación Android/iOS de la plataforma: mapa vectorial propio (MapLibre +
PMTiles), búsqueda de destinos, rutas con alternativas, mapas offline por
región, rutas guardadas que funcionan sin conexión, grabación de recorridos
con GPS y sincronización offline-first con el backend.

La arquitectura completa está en [`../docs/architecture.md`](../docs/architecture.md)
y el comportamiento sin conexión en
[`../docs/offline-architecture.md`](../docs/offline-architecture.md).

## Requisitos

| Herramienta | Versión |
| --- | --- |
| Flutter | 3.47.5 (Dart 3.13) |
| JDK | 21 (MapLibre Native para Android está compilado para Java 21) |
| Android | SDK 36 para compilar; dispositivos con Android 7.0 (API 24) o superior |
| iOS | Xcode compatible con Flutter 3.47 (`flutter doctor`); dispositivos con iOS 15 o superior |

## Configuración

La app habla solamente con Nginx (el único servicio expuesto). La URL se pasa
al compilar:

```bash
flutter run --dart-define=API_BASE_URL=https://maps.example.com
```

Sin `API_BASE_URL` se usan los valores de desarrollo: el emulador de Android
llega al equipo en `http://10.0.2.2:8080` y el simulador de iOS en
`http://localhost:8080`. En un teléfono físico usa la IP del equipo en la red
local (`http://192.168.1.50:8080`). El tráfico HTTP sin TLS solo está permitido
en compilaciones de depuración (Android) y en la red local (iOS).

## Ejecutar

```bash
cd mobile
flutter pub get
flutter run --dart-define=API_BASE_URL=http://10.0.2.2:8080
```

Usuario de demostración (después de `make seed` en la raíz): `demo@maps.local`,
con la contraseña definida en `SEED_DEMO_PASSWORD` del `.env`.

## Pruebas y calidad

```bash
flutter test                  # unitarias y de widgets
flutter analyze               # flutter_lints + reglas estrictas
dart format $(find lib test -name '*.dart' ! -name '*.g.dart')
dart run build_runner build   # regenera el código de Drift (lib/**/*.g.dart)
```

Las pruebas cubren el parseo de respuestas reales de la API
(`test/fixtures/`), la selección online/offline de rutas, el ruteo con rutas
guardadas, la detección de regiones, la cola de sincronización y el servicio
de sincronización, las descargas reanudables contra un servidor HTTP local
(Range, If-Range, SHA-256, espacio libre, cancelación), la conectividad real
(Wi-Fi sin Internet), la grabación de recorridos y las pantallas principal y de
mapas offline.

## Estructura

```
lib/
├── core/            configuración, errores, utilidades
├── domain/          entidades, contratos de repositorios y servicios, geometría
├── data/            Drift (SQLite), cliente HTTP, implementaciones de repositorios
├── infrastructure/  GPS, conectividad, almacenamiento seguro, archivos, descargas
├── services/        ruteo (online, offline, híbrido), sincronización, regiones,
│                    grabación de recorridos, estilo del mapa
├── presentation/    composición de dependencias (Riverpod), app, widgets comunes
└── features/        pantallas: mapa, búsqueda, mapas offline, rutas, recorridos, cuenta
```

Los widgets no hacen HTTP: leen providers de Riverpod, que usan servicios y
repositorios.

## Permisos

- **Android**: ubicación precisa y aproximada, servicio en primer plano de
  ubicación (grabación con la pantalla apagada), notificaciones e Internet.
- **iOS**: ubicación "al usar la app" y "siempre" (grabación en segundo plano,
  `UIBackgroundModes: location`).

Los tokens se guardan en el Keystore (Android) y el Keychain (iOS). Los mapas
descargados no entran en las copias de seguridad porque se pueden volver a
descargar: Android excluye los datos de la app (`allowBackup="false"`) y en
iOS el directorio `offline/` se marca con `isExcludedFromBackup`, como piden
las pautas de almacenamiento de Apple.

## Compilación de release

Android firma con `android/key.properties` (no se versiona):

```properties
storeFile=/ruta/a/release.jks
storePassword=...
keyAlias=...
keyPassword=...
```

```bash
flutter build apk --release --dart-define=API_BASE_URL=https://maps.example.com
flutter build ipa --release --dart-define=API_BASE_URL=https://maps.example.com
```

## Atribución

Datos del mapa © OpenStreetMap contributors (ODbL). La app muestra la
atribución sobre el mapa en todo momento. Tipografías Noto Sans bajo SIL Open
Font License (`assets/fonts/OFL.txt`).
