#!/usr/bin/env python3
"""Publishes the Android app so the viewer's "Instalar app" button offers it for download.

    python3 infrastructure/scripts/publish-app.py mobile/build/app/outputs/flutter-apk/app-release.apk
    python3 infrastructure/scripts/publish-app.py app-release.apk --host ovh-serverSoft
    python3 infrastructure/scripts/publish-app.py app-release.apk --host ovh-serverSoft --remote-dir /opt/route-maps

Nginx serves storage/app at /descargas/ (docker-compose.yml):

    route-maps-<version>-<build>.apk   this release; cached for good, its name changes with every release
    route-maps.apk                     the latest release under a fixed name, for links and QR codes
    android.json                       what the viewer shows: version, size, SHA-256, minimum Android

The version, the build number and the minimum Android version are read from the APK itself (its
binary AndroidManifest.xml), so android.json always describes the file that is published. It is
written last: the button never points at a file that is not in place yet. The previous release is
kept (a download already started can finish); older ones are removed.

Without --host the files go to the local storage (STORAGE_PATH, ./storage by default). With --host
they are copied over SSH to a staging folder on the server, checked there against their SHA-256 and
then moved into <remote dir>/storage/app, like publish-region.sh.

Requirements: Python 3.9+; with --host, ssh/scp on this computer and sudo on the server.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import re
import struct
import subprocess
import sys
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP_NAME = 'Route Maps'
FIXED_NAME = 'route-maps.apk'
DOWNLOADS_URL = '/descargas'
KEEP_RELEASES = 2

# Binary XML (AXML) of a compiled AndroidManifest.xml.
RES_STRING_POOL_TYPE = 0x0001
RES_XML_TYPE = 0x0003
RES_XML_START_ELEMENT_TYPE = 0x0102
RES_XML_RESOURCE_MAP_TYPE = 0x0180
UTF8_FLAG = 0x100
TYPE_STRING = 0x03
NO_ENTRY = 0xFFFFFFFF
# android:versionCode, android:versionName and android:minSdkVersion (by resource id: shrunk APKs
# may drop the attribute names from the string pool).
ATTRIBUTE_IDS = {0x0101021B: 'versionCode', 0x0101021C: 'versionName', 0x0101020C: 'minSdkVersion'}
ANDROID_VERSIONS = {
    21: '5.0', 22: '5.1', 23: '6.0', 24: '7.0', 25: '7.1', 26: '8.0', 27: '8.1', 28: '9', 29: '10',
    30: '11', 31: '12', 32: '12L', 33: '13', 34: '14', 35: '15', 36: '16',
}

REMOTE_SCRIPT = r'''
set -euo pipefail
ROOT=$1 FILE=$2 SHA256=$3 KEEP=$4
STAGING="$ROOT/storage/.publish-app-incoming"
APP="$ROOT/storage/app"
cd "$STAGING"
echo "$SHA256  $FILE" | sha256sum --quiet -c -
sudo mkdir -p "$APP"
# The APKs first, android.json last: the button never points at a file that is not in place yet.
for pair in "$FILE:$FILE" "$FILE:route-maps.apk" "android.json:android.json"; do
  sudo install -m 644 "$STAGING/${pair%%:*}" "$APP/${pair#*:}.publishing"
  sudo mv -f "$APP/${pair#*:}.publishing" "$APP/${pair#*:}"
done
ls -1t "$APP"/route-maps-*.apk | tail -n +$((KEEP + 1)) | xargs -r sudo rm -f --
cd "$ROOT"
rm -rf "$STAGING"
echo "App publicada en $APP"
'''


class PublishError(Exception):
    pass


def read_length8(data: bytes, position: int) -> tuple[int, int]:
    length = data[position]
    if length & 0x80:
        return ((length & 0x7F) << 8) | data[position + 1], position + 2
    return length, position + 1


def read_length16(data: bytes, position: int) -> tuple[int, int]:
    (length,) = struct.unpack_from('<H', data, position)
    if length & 0x8000:
        (low,) = struct.unpack_from('<H', data, position + 2)
        return ((length & 0x7FFF) << 16) | low, position + 4
    return length, position + 2


def read_string_pool(data: bytes, offset: int) -> list[str]:
    _, header_size, _, count, _, flags, strings_start, _ = struct.unpack_from('<HHIIIIII', data, offset)
    starts = struct.unpack_from(f'<{count}I', data, offset + header_size)
    base = offset + strings_start
    strings = []
    for start in starts:
        position = base + start
        if flags & UTF8_FLAG:
            _, position = read_length8(data, position)  # length in UTF-16 units
            length, position = read_length8(data, position)
            strings.append(data[position:position + length].decode('utf-8', 'replace'))
        else:
            length, position = read_length16(data, position)
            strings.append(data[position:position + length * 2].decode('utf-16-le', 'replace'))
    return strings


def read_manifest(data: bytes) -> dict[str, object]:
    """Attributes of <manifest> and <uses-sdk> in a compiled AndroidManifest.xml."""
    if len(data) < 8 or struct.unpack_from('<H', data, 0)[0] != RES_XML_TYPE:
        raise PublishError('AndroidManifest.xml no está compilado: ¿es un APK de Android?')
    strings: list[str] = []
    resource_ids: tuple[int, ...] = ()
    attributes: dict[str, object] = {}
    offset = struct.unpack_from('<H', data, 2)[0]
    while offset + 8 <= len(data):
        kind, header_size, size = struct.unpack_from('<HHI', data, offset)
        if size < 8:
            raise PublishError('AndroidManifest.xml está dañado.')
        if kind == RES_STRING_POOL_TYPE:
            strings = read_string_pool(data, offset)
        elif kind == RES_XML_RESOURCE_MAP_TYPE:
            resource_ids = struct.unpack_from(f'<{(size - header_size) // 4}I', data, offset + header_size)
        elif kind == RES_XML_START_ELEMENT_TYPE:
            extension = offset + header_size
            _, name, first, step, count = struct.unpack_from('<IIHHH', data, extension)
            if name < len(strings) and strings[name] in ('manifest', 'uses-sdk'):
                for index in range(count):
                    _, key, raw, _, _, value_type, value = struct.unpack_from(
                        '<IIIHBBI', data, extension + first + index * step)
                    resource_id = resource_ids[key] if key < len(resource_ids) else None
                    label = ATTRIBUTE_IDS.get(resource_id) or (strings[key] if key < len(strings) else '')
                    if value_type == TYPE_STRING:
                        attributes[label] = strings[raw if raw != NO_ENTRY else value]
                    else:
                        attributes[label] = value
        offset += size
    return attributes


def signing_blocks(data: bytes, archive: zipfile.ZipFile) -> list[bytes]:
    """APK Signature Scheme v2/v3 block and v1 (JAR) signatures, where the certificates are."""
    blocks = [archive.read(name) for name in archive.namelist()
              if re.fullmatch(r'META-INF/[^/]+\.(RSA|DSA|EC)', name)]
    end = data.rfind(b'PK\x05\x06', max(0, len(data) - 65557))
    if end >= 0:
        (directory,) = struct.unpack_from('<I', data, end + 16)
        if data[directory - 16:directory] == b'APK Sig Block 42':
            (size,) = struct.unpack_from('<Q', data, directory - 24)
            blocks.append(data[directory - size - 8:directory])
    return blocks


def describe_apk(path: Path) -> tuple[bytes, dict[str, object], bool]:
    try:
        data = path.read_bytes()
    except OSError as error:
        raise PublishError(f'No se puede leer {path}: {error.strerror}') from error
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
        manifest = read_manifest(archive.read('AndroidManifest.xml'))
    except (zipfile.BadZipFile, KeyError) as error:
        raise PublishError(f'{path} no es un APK de Android.') from error
    except struct.error as error:
        raise PublishError('AndroidManifest.xml está dañado.') from error
    blocks = signing_blocks(data, archive)
    if not blocks:
        raise PublishError(f'{path} no está firmado: Android no lo instalaría.')
    version = str(manifest.get('versionName') or '')
    build = manifest.get('versionCode')
    if not version or not isinstance(build, int):
        raise PublishError('El APK no declara versionName y versionCode.')
    safe_version = re.sub(r'[^A-Za-z0-9._-]', '-', version)
    min_sdk = manifest.get('minSdkVersion')
    release = {
        'platform': 'android',
        'name': APP_NAME,
        'package': manifest.get('package'),
        'version': version,
        'build': build,
        'file': f'route-maps-{safe_version}-{build}.apk',
        'url': f'{DOWNLOADS_URL}/route-maps-{safe_version}-{build}.apk',
        'size': len(data),
        'sha256': hashlib.sha256(data).hexdigest(),
        'minSdk': min_sdk if isinstance(min_sdk, int) else None,
        'minAndroid': ANDROID_VERSIONS.get(min_sdk) if isinstance(min_sdk, int) else None,
        'publishedAt': datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z'),
    }
    debug = any(b'Android Debug' in block for block in blocks)
    return data, release, debug


def write_atomic(path: Path, content: bytes) -> None:
    staging = path.with_name(f'{path.name}.publishing')
    staging.write_bytes(content)
    os.replace(staging, path)


def publish_local(storage: Path, data: bytes, release: dict[str, object], keep: int) -> Path:
    app = storage / 'app'
    app.mkdir(parents=True, exist_ok=True)
    write_atomic(app / str(release['file']), data)
    write_atomic(app / FIXED_NAME, data)
    write_atomic(app / 'android.json', release_json(release))
    releases = sorted(app.glob('route-maps-*.apk'), key=lambda item: item.stat().st_mtime, reverse=True)
    for old in releases[keep:]:
        old.unlink()
    return app


def publish_remote(host: str, remote_root: str, apk: Path, release: dict[str, object], keep: int) -> None:
    staging = f'{remote_root}/storage/.publish-app-incoming'
    with tempfile.TemporaryDirectory() as folder:
        description = Path(folder) / 'android.json'
        description.write_bytes(release_json(release))
        print(f'Copiando {release["file"]} a {host}:{staging}')
        run(['ssh', host, f"rm -rf '{staging}' && mkdir -p '{staging}'"])
        run(['scp', '-q', str(apk), f'{host}:{staging}/{release["file"]}'])
        run(['scp', '-q', str(description), f'{host}:{staging}/android.json'])
    run(['ssh', host, 'bash', '-s', '--', remote_root, str(release['file']), str(release['sha256']), str(keep)],
        stdin=REMOTE_SCRIPT)


def release_json(release: dict[str, object]) -> bytes:
    return (json.dumps(release, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def run(command: list[str], stdin: str | None = None) -> None:
    try:
        subprocess.run(command, input=stdin, text=True, check=True)
    except FileNotFoundError as error:
        raise PublishError(f'Falta {command[0]} en este equipo.') from error
    except subprocess.CalledProcessError as error:
        raise PublishError(f'Falló: {" ".join(command[:3])}… (código {error.returncode})') from error


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Publica el APK de Android para el botón «Instalar app» del visor (/descargas/).')
    parser.add_argument('apk', type=Path, help='APK firmado, p. ej. mobile/build/app/outputs/flutter-apk/app-release.apk')
    parser.add_argument('--host', help='servidor SSH; sin él se publica en el almacenamiento local')
    parser.add_argument('--remote-dir', default='/opt/route-maps', help='carpeta del proyecto en el servidor')
    parser.add_argument('--storage', type=Path, help='almacenamiento local (por defecto STORAGE_PATH o ./storage)')
    parser.add_argument('--keep', type=int, default=KEEP_RELEASES, help='versiones que se conservan (2)')
    args = parser.parse_args()
    if args.host and not re.fullmatch(r'[A-Za-z0-9._@-]+', args.host):
        parser.error('host SSH no válido')
    if not re.fullmatch(r'/[A-Za-z0-9._/-]+', args.remote_dir):
        parser.error('directorio remoto no válido')
    if args.keep < 1:
        parser.error('--keep debe ser 1 o más')

    try:
        data, release, debug = describe_apk(args.apk)
        if debug:
            print('Aviso: el APK está firmado con la clave de depuración. Los teléfonos solo podrán actualizarlo '
                  'con APK firmados con esa misma clave; para distribuirlo configure mobile/android/key.properties.',
                  file=sys.stderr)
        if args.host:
            publish_remote(args.host, args.remote_dir, args.apk, release, args.keep)
            where = f'{args.host}:{args.remote_dir}/storage/app'
        else:
            storage = args.storage or Path(os.environ.get('STORAGE_PATH') or ROOT / 'storage')
            where = str(publish_local(storage, data, release, args.keep))
    except PublishError as error:
        print(error, file=sys.stderr)
        return 1
    minimum = f', Android {release["minAndroid"]} o superior' if release['minAndroid'] else ''
    print(f'{APP_NAME} {release["version"]} ({release["build"]}{minimum}) publicada en {where}: '
          f'el visor la ofrece en «Instalar app» ({release["url"]}).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
