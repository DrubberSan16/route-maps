// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'app_database.dart';

// ignore_for_file: type=lint
class $CatalogRegionsTable extends CatalogRegions
    with TableInfo<$CatalogRegionsTable, CatalogRegionRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $CatalogRegionsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _codeMeta = const VerificationMeta('code');
  @override
  late final GeneratedColumn<String> code = GeneratedColumn<String>(
    'code',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
    'name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _countryMeta = const VerificationMeta(
    'country',
  );
  @override
  late final GeneratedColumn<String> country = GeneratedColumn<String>(
    'country',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _provinceMeta = const VerificationMeta(
    'province',
  );
  @override
  late final GeneratedColumn<String> province = GeneratedColumn<String>(
    'province',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _cityMeta = const VerificationMeta('city');
  @override
  late final GeneratedColumn<String> city = GeneratedColumn<String>(
    'city',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _versionMeta = const VerificationMeta(
    'version',
  );
  @override
  late final GeneratedColumn<String> version = GeneratedColumn<String>(
    'version',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _mapSizeMeta = const VerificationMeta(
    'mapSize',
  );
  @override
  late final GeneratedColumn<int> mapSize = GeneratedColumn<int>(
    'map_size',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _routingSizeMeta = const VerificationMeta(
    'routingSize',
  );
  @override
  late final GeneratedColumn<int> routingSize = GeneratedColumn<int>(
    'routing_size',
    aliasedName,
    true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _checksumMeta = const VerificationMeta(
    'checksum',
  );
  @override
  late final GeneratedColumn<String> checksum = GeneratedColumn<String>(
    'checksum',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _routingChecksumMeta = const VerificationMeta(
    'routingChecksum',
  );
  @override
  late final GeneratedColumn<String> routingChecksum = GeneratedColumn<String>(
    'routing_checksum',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _westMeta = const VerificationMeta('west');
  @override
  late final GeneratedColumn<double> west = GeneratedColumn<double>(
    'west',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _southMeta = const VerificationMeta('south');
  @override
  late final GeneratedColumn<double> south = GeneratedColumn<double>(
    'south',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _eastMeta = const VerificationMeta('east');
  @override
  late final GeneratedColumn<double> east = GeneratedColumn<double>(
    'east',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _northMeta = const VerificationMeta('north');
  @override
  late final GeneratedColumn<double> north = GeneratedColumn<double>(
    'north',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _minZoomMeta = const VerificationMeta(
    'minZoom',
  );
  @override
  late final GeneratedColumn<int> minZoom = GeneratedColumn<int>(
    'min_zoom',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _maxZoomMeta = const VerificationMeta(
    'maxZoom',
  );
  @override
  late final GeneratedColumn<int> maxZoom = GeneratedColumn<int>(
    'max_zoom',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _mapDownloadUrlMeta = const VerificationMeta(
    'mapDownloadUrl',
  );
  @override
  late final GeneratedColumn<String> mapDownloadUrl = GeneratedColumn<String>(
    'map_download_url',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _routingDownloadUrlMeta =
      const VerificationMeta('routingDownloadUrl');
  @override
  late final GeneratedColumn<String> routingDownloadUrl =
      GeneratedColumn<String>(
        'routing_download_url',
        aliasedName,
        true,
        type: DriftSqlType.string,
        requiredDuringInsert: false,
      );
  static const VerificationMeta _tilesUrlMeta = const VerificationMeta(
    'tilesUrl',
  );
  @override
  late final GeneratedColumn<String> tilesUrl = GeneratedColumn<String>(
    'tiles_url',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _fetchedAtMeta = const VerificationMeta(
    'fetchedAt',
  );
  @override
  late final GeneratedColumn<DateTime> fetchedAt = GeneratedColumn<DateTime>(
    'fetched_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    code,
    name,
    country,
    province,
    city,
    version,
    mapSize,
    routingSize,
    checksum,
    routingChecksum,
    west,
    south,
    east,
    north,
    minZoom,
    maxZoom,
    mapDownloadUrl,
    routingDownloadUrl,
    tilesUrl,
    updatedAt,
    fetchedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'catalog_regions';
  @override
  VerificationContext validateIntegrity(
    Insertable<CatalogRegionRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('code')) {
      context.handle(
        _codeMeta,
        code.isAcceptableOrUnknown(data['code']!, _codeMeta),
      );
    } else if (isInserting) {
      context.missing(_codeMeta);
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('country')) {
      context.handle(
        _countryMeta,
        country.isAcceptableOrUnknown(data['country']!, _countryMeta),
      );
    } else if (isInserting) {
      context.missing(_countryMeta);
    }
    if (data.containsKey('province')) {
      context.handle(
        _provinceMeta,
        province.isAcceptableOrUnknown(data['province']!, _provinceMeta),
      );
    }
    if (data.containsKey('city')) {
      context.handle(
        _cityMeta,
        city.isAcceptableOrUnknown(data['city']!, _cityMeta),
      );
    }
    if (data.containsKey('version')) {
      context.handle(
        _versionMeta,
        version.isAcceptableOrUnknown(data['version']!, _versionMeta),
      );
    } else if (isInserting) {
      context.missing(_versionMeta);
    }
    if (data.containsKey('map_size')) {
      context.handle(
        _mapSizeMeta,
        mapSize.isAcceptableOrUnknown(data['map_size']!, _mapSizeMeta),
      );
    } else if (isInserting) {
      context.missing(_mapSizeMeta);
    }
    if (data.containsKey('routing_size')) {
      context.handle(
        _routingSizeMeta,
        routingSize.isAcceptableOrUnknown(
          data['routing_size']!,
          _routingSizeMeta,
        ),
      );
    }
    if (data.containsKey('checksum')) {
      context.handle(
        _checksumMeta,
        checksum.isAcceptableOrUnknown(data['checksum']!, _checksumMeta),
      );
    } else if (isInserting) {
      context.missing(_checksumMeta);
    }
    if (data.containsKey('routing_checksum')) {
      context.handle(
        _routingChecksumMeta,
        routingChecksum.isAcceptableOrUnknown(
          data['routing_checksum']!,
          _routingChecksumMeta,
        ),
      );
    }
    if (data.containsKey('west')) {
      context.handle(
        _westMeta,
        west.isAcceptableOrUnknown(data['west']!, _westMeta),
      );
    }
    if (data.containsKey('south')) {
      context.handle(
        _southMeta,
        south.isAcceptableOrUnknown(data['south']!, _southMeta),
      );
    }
    if (data.containsKey('east')) {
      context.handle(
        _eastMeta,
        east.isAcceptableOrUnknown(data['east']!, _eastMeta),
      );
    }
    if (data.containsKey('north')) {
      context.handle(
        _northMeta,
        north.isAcceptableOrUnknown(data['north']!, _northMeta),
      );
    }
    if (data.containsKey('min_zoom')) {
      context.handle(
        _minZoomMeta,
        minZoom.isAcceptableOrUnknown(data['min_zoom']!, _minZoomMeta),
      );
    } else if (isInserting) {
      context.missing(_minZoomMeta);
    }
    if (data.containsKey('max_zoom')) {
      context.handle(
        _maxZoomMeta,
        maxZoom.isAcceptableOrUnknown(data['max_zoom']!, _maxZoomMeta),
      );
    } else if (isInserting) {
      context.missing(_maxZoomMeta);
    }
    if (data.containsKey('map_download_url')) {
      context.handle(
        _mapDownloadUrlMeta,
        mapDownloadUrl.isAcceptableOrUnknown(
          data['map_download_url']!,
          _mapDownloadUrlMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_mapDownloadUrlMeta);
    }
    if (data.containsKey('routing_download_url')) {
      context.handle(
        _routingDownloadUrlMeta,
        routingDownloadUrl.isAcceptableOrUnknown(
          data['routing_download_url']!,
          _routingDownloadUrlMeta,
        ),
      );
    }
    if (data.containsKey('tiles_url')) {
      context.handle(
        _tilesUrlMeta,
        tilesUrl.isAcceptableOrUnknown(data['tiles_url']!, _tilesUrlMeta),
      );
    } else if (isInserting) {
      context.missing(_tilesUrlMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    if (data.containsKey('fetched_at')) {
      context.handle(
        _fetchedAtMeta,
        fetchedAt.isAcceptableOrUnknown(data['fetched_at']!, _fetchedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_fetchedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {code};
  @override
  CatalogRegionRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return CatalogRegionRow(
      code: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}code'],
      )!,
      name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}name'],
      )!,
      country: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}country'],
      )!,
      province: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}province'],
      ),
      city: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}city'],
      ),
      version: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}version'],
      )!,
      mapSize: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}map_size'],
      )!,
      routingSize: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}routing_size'],
      ),
      checksum: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}checksum'],
      )!,
      routingChecksum: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}routing_checksum'],
      ),
      west: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}west'],
      ),
      south: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}south'],
      ),
      east: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}east'],
      ),
      north: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}north'],
      ),
      minZoom: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}min_zoom'],
      )!,
      maxZoom: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}max_zoom'],
      )!,
      mapDownloadUrl: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}map_download_url'],
      )!,
      routingDownloadUrl: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}routing_download_url'],
      ),
      tilesUrl: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}tiles_url'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
      fetchedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}fetched_at'],
      )!,
    );
  }

  @override
  $CatalogRegionsTable createAlias(String alias) {
    return $CatalogRegionsTable(attachedDatabase, alias);
  }
}

class CatalogRegionRow extends DataClass
    implements Insertable<CatalogRegionRow> {
  final String code;
  final String name;
  final String country;
  final String? province;
  final String? city;
  final String version;
  final int mapSize;
  final int? routingSize;
  final String checksum;
  final String? routingChecksum;
  final double? west;
  final double? south;
  final double? east;
  final double? north;
  final int minZoom;
  final int maxZoom;
  final String mapDownloadUrl;
  final String? routingDownloadUrl;
  final String tilesUrl;
  final DateTime updatedAt;
  final DateTime fetchedAt;
  const CatalogRegionRow({
    required this.code,
    required this.name,
    required this.country,
    this.province,
    this.city,
    required this.version,
    required this.mapSize,
    this.routingSize,
    required this.checksum,
    this.routingChecksum,
    this.west,
    this.south,
    this.east,
    this.north,
    required this.minZoom,
    required this.maxZoom,
    required this.mapDownloadUrl,
    this.routingDownloadUrl,
    required this.tilesUrl,
    required this.updatedAt,
    required this.fetchedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['code'] = Variable<String>(code);
    map['name'] = Variable<String>(name);
    map['country'] = Variable<String>(country);
    if (!nullToAbsent || province != null) {
      map['province'] = Variable<String>(province);
    }
    if (!nullToAbsent || city != null) {
      map['city'] = Variable<String>(city);
    }
    map['version'] = Variable<String>(version);
    map['map_size'] = Variable<int>(mapSize);
    if (!nullToAbsent || routingSize != null) {
      map['routing_size'] = Variable<int>(routingSize);
    }
    map['checksum'] = Variable<String>(checksum);
    if (!nullToAbsent || routingChecksum != null) {
      map['routing_checksum'] = Variable<String>(routingChecksum);
    }
    if (!nullToAbsent || west != null) {
      map['west'] = Variable<double>(west);
    }
    if (!nullToAbsent || south != null) {
      map['south'] = Variable<double>(south);
    }
    if (!nullToAbsent || east != null) {
      map['east'] = Variable<double>(east);
    }
    if (!nullToAbsent || north != null) {
      map['north'] = Variable<double>(north);
    }
    map['min_zoom'] = Variable<int>(minZoom);
    map['max_zoom'] = Variable<int>(maxZoom);
    map['map_download_url'] = Variable<String>(mapDownloadUrl);
    if (!nullToAbsent || routingDownloadUrl != null) {
      map['routing_download_url'] = Variable<String>(routingDownloadUrl);
    }
    map['tiles_url'] = Variable<String>(tilesUrl);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    map['fetched_at'] = Variable<DateTime>(fetchedAt);
    return map;
  }

  CatalogRegionsCompanion toCompanion(bool nullToAbsent) {
    return CatalogRegionsCompanion(
      code: Value(code),
      name: Value(name),
      country: Value(country),
      province: province == null && nullToAbsent
          ? const Value.absent()
          : Value(province),
      city: city == null && nullToAbsent ? const Value.absent() : Value(city),
      version: Value(version),
      mapSize: Value(mapSize),
      routingSize: routingSize == null && nullToAbsent
          ? const Value.absent()
          : Value(routingSize),
      checksum: Value(checksum),
      routingChecksum: routingChecksum == null && nullToAbsent
          ? const Value.absent()
          : Value(routingChecksum),
      west: west == null && nullToAbsent ? const Value.absent() : Value(west),
      south: south == null && nullToAbsent
          ? const Value.absent()
          : Value(south),
      east: east == null && nullToAbsent ? const Value.absent() : Value(east),
      north: north == null && nullToAbsent
          ? const Value.absent()
          : Value(north),
      minZoom: Value(minZoom),
      maxZoom: Value(maxZoom),
      mapDownloadUrl: Value(mapDownloadUrl),
      routingDownloadUrl: routingDownloadUrl == null && nullToAbsent
          ? const Value.absent()
          : Value(routingDownloadUrl),
      tilesUrl: Value(tilesUrl),
      updatedAt: Value(updatedAt),
      fetchedAt: Value(fetchedAt),
    );
  }

  factory CatalogRegionRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return CatalogRegionRow(
      code: serializer.fromJson<String>(json['code']),
      name: serializer.fromJson<String>(json['name']),
      country: serializer.fromJson<String>(json['country']),
      province: serializer.fromJson<String?>(json['province']),
      city: serializer.fromJson<String?>(json['city']),
      version: serializer.fromJson<String>(json['version']),
      mapSize: serializer.fromJson<int>(json['mapSize']),
      routingSize: serializer.fromJson<int?>(json['routingSize']),
      checksum: serializer.fromJson<String>(json['checksum']),
      routingChecksum: serializer.fromJson<String?>(json['routingChecksum']),
      west: serializer.fromJson<double?>(json['west']),
      south: serializer.fromJson<double?>(json['south']),
      east: serializer.fromJson<double?>(json['east']),
      north: serializer.fromJson<double?>(json['north']),
      minZoom: serializer.fromJson<int>(json['minZoom']),
      maxZoom: serializer.fromJson<int>(json['maxZoom']),
      mapDownloadUrl: serializer.fromJson<String>(json['mapDownloadUrl']),
      routingDownloadUrl: serializer.fromJson<String?>(
        json['routingDownloadUrl'],
      ),
      tilesUrl: serializer.fromJson<String>(json['tilesUrl']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
      fetchedAt: serializer.fromJson<DateTime>(json['fetchedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'code': serializer.toJson<String>(code),
      'name': serializer.toJson<String>(name),
      'country': serializer.toJson<String>(country),
      'province': serializer.toJson<String?>(province),
      'city': serializer.toJson<String?>(city),
      'version': serializer.toJson<String>(version),
      'mapSize': serializer.toJson<int>(mapSize),
      'routingSize': serializer.toJson<int?>(routingSize),
      'checksum': serializer.toJson<String>(checksum),
      'routingChecksum': serializer.toJson<String?>(routingChecksum),
      'west': serializer.toJson<double?>(west),
      'south': serializer.toJson<double?>(south),
      'east': serializer.toJson<double?>(east),
      'north': serializer.toJson<double?>(north),
      'minZoom': serializer.toJson<int>(minZoom),
      'maxZoom': serializer.toJson<int>(maxZoom),
      'mapDownloadUrl': serializer.toJson<String>(mapDownloadUrl),
      'routingDownloadUrl': serializer.toJson<String?>(routingDownloadUrl),
      'tilesUrl': serializer.toJson<String>(tilesUrl),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
      'fetchedAt': serializer.toJson<DateTime>(fetchedAt),
    };
  }

  CatalogRegionRow copyWith({
    String? code,
    String? name,
    String? country,
    Value<String?> province = const Value.absent(),
    Value<String?> city = const Value.absent(),
    String? version,
    int? mapSize,
    Value<int?> routingSize = const Value.absent(),
    String? checksum,
    Value<String?> routingChecksum = const Value.absent(),
    Value<double?> west = const Value.absent(),
    Value<double?> south = const Value.absent(),
    Value<double?> east = const Value.absent(),
    Value<double?> north = const Value.absent(),
    int? minZoom,
    int? maxZoom,
    String? mapDownloadUrl,
    Value<String?> routingDownloadUrl = const Value.absent(),
    String? tilesUrl,
    DateTime? updatedAt,
    DateTime? fetchedAt,
  }) => CatalogRegionRow(
    code: code ?? this.code,
    name: name ?? this.name,
    country: country ?? this.country,
    province: province.present ? province.value : this.province,
    city: city.present ? city.value : this.city,
    version: version ?? this.version,
    mapSize: mapSize ?? this.mapSize,
    routingSize: routingSize.present ? routingSize.value : this.routingSize,
    checksum: checksum ?? this.checksum,
    routingChecksum: routingChecksum.present
        ? routingChecksum.value
        : this.routingChecksum,
    west: west.present ? west.value : this.west,
    south: south.present ? south.value : this.south,
    east: east.present ? east.value : this.east,
    north: north.present ? north.value : this.north,
    minZoom: minZoom ?? this.minZoom,
    maxZoom: maxZoom ?? this.maxZoom,
    mapDownloadUrl: mapDownloadUrl ?? this.mapDownloadUrl,
    routingDownloadUrl: routingDownloadUrl.present
        ? routingDownloadUrl.value
        : this.routingDownloadUrl,
    tilesUrl: tilesUrl ?? this.tilesUrl,
    updatedAt: updatedAt ?? this.updatedAt,
    fetchedAt: fetchedAt ?? this.fetchedAt,
  );
  CatalogRegionRow copyWithCompanion(CatalogRegionsCompanion data) {
    return CatalogRegionRow(
      code: data.code.present ? data.code.value : this.code,
      name: data.name.present ? data.name.value : this.name,
      country: data.country.present ? data.country.value : this.country,
      province: data.province.present ? data.province.value : this.province,
      city: data.city.present ? data.city.value : this.city,
      version: data.version.present ? data.version.value : this.version,
      mapSize: data.mapSize.present ? data.mapSize.value : this.mapSize,
      routingSize: data.routingSize.present
          ? data.routingSize.value
          : this.routingSize,
      checksum: data.checksum.present ? data.checksum.value : this.checksum,
      routingChecksum: data.routingChecksum.present
          ? data.routingChecksum.value
          : this.routingChecksum,
      west: data.west.present ? data.west.value : this.west,
      south: data.south.present ? data.south.value : this.south,
      east: data.east.present ? data.east.value : this.east,
      north: data.north.present ? data.north.value : this.north,
      minZoom: data.minZoom.present ? data.minZoom.value : this.minZoom,
      maxZoom: data.maxZoom.present ? data.maxZoom.value : this.maxZoom,
      mapDownloadUrl: data.mapDownloadUrl.present
          ? data.mapDownloadUrl.value
          : this.mapDownloadUrl,
      routingDownloadUrl: data.routingDownloadUrl.present
          ? data.routingDownloadUrl.value
          : this.routingDownloadUrl,
      tilesUrl: data.tilesUrl.present ? data.tilesUrl.value : this.tilesUrl,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
      fetchedAt: data.fetchedAt.present ? data.fetchedAt.value : this.fetchedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('CatalogRegionRow(')
          ..write('code: $code, ')
          ..write('name: $name, ')
          ..write('country: $country, ')
          ..write('province: $province, ')
          ..write('city: $city, ')
          ..write('version: $version, ')
          ..write('mapSize: $mapSize, ')
          ..write('routingSize: $routingSize, ')
          ..write('checksum: $checksum, ')
          ..write('routingChecksum: $routingChecksum, ')
          ..write('west: $west, ')
          ..write('south: $south, ')
          ..write('east: $east, ')
          ..write('north: $north, ')
          ..write('minZoom: $minZoom, ')
          ..write('maxZoom: $maxZoom, ')
          ..write('mapDownloadUrl: $mapDownloadUrl, ')
          ..write('routingDownloadUrl: $routingDownloadUrl, ')
          ..write('tilesUrl: $tilesUrl, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('fetchedAt: $fetchedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hashAll([
    code,
    name,
    country,
    province,
    city,
    version,
    mapSize,
    routingSize,
    checksum,
    routingChecksum,
    west,
    south,
    east,
    north,
    minZoom,
    maxZoom,
    mapDownloadUrl,
    routingDownloadUrl,
    tilesUrl,
    updatedAt,
    fetchedAt,
  ]);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is CatalogRegionRow &&
          other.code == this.code &&
          other.name == this.name &&
          other.country == this.country &&
          other.province == this.province &&
          other.city == this.city &&
          other.version == this.version &&
          other.mapSize == this.mapSize &&
          other.routingSize == this.routingSize &&
          other.checksum == this.checksum &&
          other.routingChecksum == this.routingChecksum &&
          other.west == this.west &&
          other.south == this.south &&
          other.east == this.east &&
          other.north == this.north &&
          other.minZoom == this.minZoom &&
          other.maxZoom == this.maxZoom &&
          other.mapDownloadUrl == this.mapDownloadUrl &&
          other.routingDownloadUrl == this.routingDownloadUrl &&
          other.tilesUrl == this.tilesUrl &&
          other.updatedAt == this.updatedAt &&
          other.fetchedAt == this.fetchedAt);
}

class CatalogRegionsCompanion extends UpdateCompanion<CatalogRegionRow> {
  final Value<String> code;
  final Value<String> name;
  final Value<String> country;
  final Value<String?> province;
  final Value<String?> city;
  final Value<String> version;
  final Value<int> mapSize;
  final Value<int?> routingSize;
  final Value<String> checksum;
  final Value<String?> routingChecksum;
  final Value<double?> west;
  final Value<double?> south;
  final Value<double?> east;
  final Value<double?> north;
  final Value<int> minZoom;
  final Value<int> maxZoom;
  final Value<String> mapDownloadUrl;
  final Value<String?> routingDownloadUrl;
  final Value<String> tilesUrl;
  final Value<DateTime> updatedAt;
  final Value<DateTime> fetchedAt;
  final Value<int> rowid;
  const CatalogRegionsCompanion({
    this.code = const Value.absent(),
    this.name = const Value.absent(),
    this.country = const Value.absent(),
    this.province = const Value.absent(),
    this.city = const Value.absent(),
    this.version = const Value.absent(),
    this.mapSize = const Value.absent(),
    this.routingSize = const Value.absent(),
    this.checksum = const Value.absent(),
    this.routingChecksum = const Value.absent(),
    this.west = const Value.absent(),
    this.south = const Value.absent(),
    this.east = const Value.absent(),
    this.north = const Value.absent(),
    this.minZoom = const Value.absent(),
    this.maxZoom = const Value.absent(),
    this.mapDownloadUrl = const Value.absent(),
    this.routingDownloadUrl = const Value.absent(),
    this.tilesUrl = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.fetchedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  CatalogRegionsCompanion.insert({
    required String code,
    required String name,
    required String country,
    this.province = const Value.absent(),
    this.city = const Value.absent(),
    required String version,
    required int mapSize,
    this.routingSize = const Value.absent(),
    required String checksum,
    this.routingChecksum = const Value.absent(),
    this.west = const Value.absent(),
    this.south = const Value.absent(),
    this.east = const Value.absent(),
    this.north = const Value.absent(),
    required int minZoom,
    required int maxZoom,
    required String mapDownloadUrl,
    this.routingDownloadUrl = const Value.absent(),
    required String tilesUrl,
    required DateTime updatedAt,
    required DateTime fetchedAt,
    this.rowid = const Value.absent(),
  }) : code = Value(code),
       name = Value(name),
       country = Value(country),
       version = Value(version),
       mapSize = Value(mapSize),
       checksum = Value(checksum),
       minZoom = Value(minZoom),
       maxZoom = Value(maxZoom),
       mapDownloadUrl = Value(mapDownloadUrl),
       tilesUrl = Value(tilesUrl),
       updatedAt = Value(updatedAt),
       fetchedAt = Value(fetchedAt);
  static Insertable<CatalogRegionRow> custom({
    Expression<String>? code,
    Expression<String>? name,
    Expression<String>? country,
    Expression<String>? province,
    Expression<String>? city,
    Expression<String>? version,
    Expression<int>? mapSize,
    Expression<int>? routingSize,
    Expression<String>? checksum,
    Expression<String>? routingChecksum,
    Expression<double>? west,
    Expression<double>? south,
    Expression<double>? east,
    Expression<double>? north,
    Expression<int>? minZoom,
    Expression<int>? maxZoom,
    Expression<String>? mapDownloadUrl,
    Expression<String>? routingDownloadUrl,
    Expression<String>? tilesUrl,
    Expression<DateTime>? updatedAt,
    Expression<DateTime>? fetchedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (code != null) 'code': code,
      if (name != null) 'name': name,
      if (country != null) 'country': country,
      if (province != null) 'province': province,
      if (city != null) 'city': city,
      if (version != null) 'version': version,
      if (mapSize != null) 'map_size': mapSize,
      if (routingSize != null) 'routing_size': routingSize,
      if (checksum != null) 'checksum': checksum,
      if (routingChecksum != null) 'routing_checksum': routingChecksum,
      if (west != null) 'west': west,
      if (south != null) 'south': south,
      if (east != null) 'east': east,
      if (north != null) 'north': north,
      if (minZoom != null) 'min_zoom': minZoom,
      if (maxZoom != null) 'max_zoom': maxZoom,
      if (mapDownloadUrl != null) 'map_download_url': mapDownloadUrl,
      if (routingDownloadUrl != null)
        'routing_download_url': routingDownloadUrl,
      if (tilesUrl != null) 'tiles_url': tilesUrl,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (fetchedAt != null) 'fetched_at': fetchedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  CatalogRegionsCompanion copyWith({
    Value<String>? code,
    Value<String>? name,
    Value<String>? country,
    Value<String?>? province,
    Value<String?>? city,
    Value<String>? version,
    Value<int>? mapSize,
    Value<int?>? routingSize,
    Value<String>? checksum,
    Value<String?>? routingChecksum,
    Value<double?>? west,
    Value<double?>? south,
    Value<double?>? east,
    Value<double?>? north,
    Value<int>? minZoom,
    Value<int>? maxZoom,
    Value<String>? mapDownloadUrl,
    Value<String?>? routingDownloadUrl,
    Value<String>? tilesUrl,
    Value<DateTime>? updatedAt,
    Value<DateTime>? fetchedAt,
    Value<int>? rowid,
  }) {
    return CatalogRegionsCompanion(
      code: code ?? this.code,
      name: name ?? this.name,
      country: country ?? this.country,
      province: province ?? this.province,
      city: city ?? this.city,
      version: version ?? this.version,
      mapSize: mapSize ?? this.mapSize,
      routingSize: routingSize ?? this.routingSize,
      checksum: checksum ?? this.checksum,
      routingChecksum: routingChecksum ?? this.routingChecksum,
      west: west ?? this.west,
      south: south ?? this.south,
      east: east ?? this.east,
      north: north ?? this.north,
      minZoom: minZoom ?? this.minZoom,
      maxZoom: maxZoom ?? this.maxZoom,
      mapDownloadUrl: mapDownloadUrl ?? this.mapDownloadUrl,
      routingDownloadUrl: routingDownloadUrl ?? this.routingDownloadUrl,
      tilesUrl: tilesUrl ?? this.tilesUrl,
      updatedAt: updatedAt ?? this.updatedAt,
      fetchedAt: fetchedAt ?? this.fetchedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (code.present) {
      map['code'] = Variable<String>(code.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (country.present) {
      map['country'] = Variable<String>(country.value);
    }
    if (province.present) {
      map['province'] = Variable<String>(province.value);
    }
    if (city.present) {
      map['city'] = Variable<String>(city.value);
    }
    if (version.present) {
      map['version'] = Variable<String>(version.value);
    }
    if (mapSize.present) {
      map['map_size'] = Variable<int>(mapSize.value);
    }
    if (routingSize.present) {
      map['routing_size'] = Variable<int>(routingSize.value);
    }
    if (checksum.present) {
      map['checksum'] = Variable<String>(checksum.value);
    }
    if (routingChecksum.present) {
      map['routing_checksum'] = Variable<String>(routingChecksum.value);
    }
    if (west.present) {
      map['west'] = Variable<double>(west.value);
    }
    if (south.present) {
      map['south'] = Variable<double>(south.value);
    }
    if (east.present) {
      map['east'] = Variable<double>(east.value);
    }
    if (north.present) {
      map['north'] = Variable<double>(north.value);
    }
    if (minZoom.present) {
      map['min_zoom'] = Variable<int>(minZoom.value);
    }
    if (maxZoom.present) {
      map['max_zoom'] = Variable<int>(maxZoom.value);
    }
    if (mapDownloadUrl.present) {
      map['map_download_url'] = Variable<String>(mapDownloadUrl.value);
    }
    if (routingDownloadUrl.present) {
      map['routing_download_url'] = Variable<String>(routingDownloadUrl.value);
    }
    if (tilesUrl.present) {
      map['tiles_url'] = Variable<String>(tilesUrl.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (fetchedAt.present) {
      map['fetched_at'] = Variable<DateTime>(fetchedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('CatalogRegionsCompanion(')
          ..write('code: $code, ')
          ..write('name: $name, ')
          ..write('country: $country, ')
          ..write('province: $province, ')
          ..write('city: $city, ')
          ..write('version: $version, ')
          ..write('mapSize: $mapSize, ')
          ..write('routingSize: $routingSize, ')
          ..write('checksum: $checksum, ')
          ..write('routingChecksum: $routingChecksum, ')
          ..write('west: $west, ')
          ..write('south: $south, ')
          ..write('east: $east, ')
          ..write('north: $north, ')
          ..write('minZoom: $minZoom, ')
          ..write('maxZoom: $maxZoom, ')
          ..write('mapDownloadUrl: $mapDownloadUrl, ')
          ..write('routingDownloadUrl: $routingDownloadUrl, ')
          ..write('tilesUrl: $tilesUrl, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('fetchedAt: $fetchedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $DownloadedRegionsTable extends DownloadedRegions
    with TableInfo<$DownloadedRegionsTable, DownloadedRegionRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $DownloadedRegionsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _codeMeta = const VerificationMeta('code');
  @override
  late final GeneratedColumn<String> code = GeneratedColumn<String>(
    'code',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
    'name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _versionMeta = const VerificationMeta(
    'version',
  );
  @override
  late final GeneratedColumn<String> version = GeneratedColumn<String>(
    'version',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _checksumMeta = const VerificationMeta(
    'checksum',
  );
  @override
  late final GeneratedColumn<String> checksum = GeneratedColumn<String>(
    'checksum',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _sizeBytesMeta = const VerificationMeta(
    'sizeBytes',
  );
  @override
  late final GeneratedColumn<int> sizeBytes = GeneratedColumn<int>(
    'size_bytes',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _relativePathMeta = const VerificationMeta(
    'relativePath',
  );
  @override
  late final GeneratedColumn<String> relativePath = GeneratedColumn<String>(
    'relative_path',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _westMeta = const VerificationMeta('west');
  @override
  late final GeneratedColumn<double> west = GeneratedColumn<double>(
    'west',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _southMeta = const VerificationMeta('south');
  @override
  late final GeneratedColumn<double> south = GeneratedColumn<double>(
    'south',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _eastMeta = const VerificationMeta('east');
  @override
  late final GeneratedColumn<double> east = GeneratedColumn<double>(
    'east',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _northMeta = const VerificationMeta('north');
  @override
  late final GeneratedColumn<double> north = GeneratedColumn<double>(
    'north',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _minZoomMeta = const VerificationMeta(
    'minZoom',
  );
  @override
  late final GeneratedColumn<int> minZoom = GeneratedColumn<int>(
    'min_zoom',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _maxZoomMeta = const VerificationMeta(
    'maxZoom',
  );
  @override
  late final GeneratedColumn<int> maxZoom = GeneratedColumn<int>(
    'max_zoom',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _downloadedAtMeta = const VerificationMeta(
    'downloadedAt',
  );
  @override
  late final GeneratedColumn<DateTime> downloadedAt = GeneratedColumn<DateTime>(
    'downloaded_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _latestVersionMeta = const VerificationMeta(
    'latestVersion',
  );
  @override
  late final GeneratedColumn<String> latestVersion = GeneratedColumn<String>(
    'latest_version',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _checkedAtMeta = const VerificationMeta(
    'checkedAt',
  );
  @override
  late final GeneratedColumn<DateTime> checkedAt = GeneratedColumn<DateTime>(
    'checked_at',
    aliasedName,
    true,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    code,
    name,
    version,
    checksum,
    sizeBytes,
    relativePath,
    west,
    south,
    east,
    north,
    minZoom,
    maxZoom,
    downloadedAt,
    latestVersion,
    checkedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'downloaded_regions';
  @override
  VerificationContext validateIntegrity(
    Insertable<DownloadedRegionRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('code')) {
      context.handle(
        _codeMeta,
        code.isAcceptableOrUnknown(data['code']!, _codeMeta),
      );
    } else if (isInserting) {
      context.missing(_codeMeta);
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('version')) {
      context.handle(
        _versionMeta,
        version.isAcceptableOrUnknown(data['version']!, _versionMeta),
      );
    } else if (isInserting) {
      context.missing(_versionMeta);
    }
    if (data.containsKey('checksum')) {
      context.handle(
        _checksumMeta,
        checksum.isAcceptableOrUnknown(data['checksum']!, _checksumMeta),
      );
    } else if (isInserting) {
      context.missing(_checksumMeta);
    }
    if (data.containsKey('size_bytes')) {
      context.handle(
        _sizeBytesMeta,
        sizeBytes.isAcceptableOrUnknown(data['size_bytes']!, _sizeBytesMeta),
      );
    } else if (isInserting) {
      context.missing(_sizeBytesMeta);
    }
    if (data.containsKey('relative_path')) {
      context.handle(
        _relativePathMeta,
        relativePath.isAcceptableOrUnknown(
          data['relative_path']!,
          _relativePathMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_relativePathMeta);
    }
    if (data.containsKey('west')) {
      context.handle(
        _westMeta,
        west.isAcceptableOrUnknown(data['west']!, _westMeta),
      );
    }
    if (data.containsKey('south')) {
      context.handle(
        _southMeta,
        south.isAcceptableOrUnknown(data['south']!, _southMeta),
      );
    }
    if (data.containsKey('east')) {
      context.handle(
        _eastMeta,
        east.isAcceptableOrUnknown(data['east']!, _eastMeta),
      );
    }
    if (data.containsKey('north')) {
      context.handle(
        _northMeta,
        north.isAcceptableOrUnknown(data['north']!, _northMeta),
      );
    }
    if (data.containsKey('min_zoom')) {
      context.handle(
        _minZoomMeta,
        minZoom.isAcceptableOrUnknown(data['min_zoom']!, _minZoomMeta),
      );
    } else if (isInserting) {
      context.missing(_minZoomMeta);
    }
    if (data.containsKey('max_zoom')) {
      context.handle(
        _maxZoomMeta,
        maxZoom.isAcceptableOrUnknown(data['max_zoom']!, _maxZoomMeta),
      );
    } else if (isInserting) {
      context.missing(_maxZoomMeta);
    }
    if (data.containsKey('downloaded_at')) {
      context.handle(
        _downloadedAtMeta,
        downloadedAt.isAcceptableOrUnknown(
          data['downloaded_at']!,
          _downloadedAtMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_downloadedAtMeta);
    }
    if (data.containsKey('latest_version')) {
      context.handle(
        _latestVersionMeta,
        latestVersion.isAcceptableOrUnknown(
          data['latest_version']!,
          _latestVersionMeta,
        ),
      );
    }
    if (data.containsKey('checked_at')) {
      context.handle(
        _checkedAtMeta,
        checkedAt.isAcceptableOrUnknown(data['checked_at']!, _checkedAtMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {code};
  @override
  DownloadedRegionRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return DownloadedRegionRow(
      code: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}code'],
      )!,
      name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}name'],
      )!,
      version: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}version'],
      )!,
      checksum: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}checksum'],
      )!,
      sizeBytes: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}size_bytes'],
      )!,
      relativePath: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}relative_path'],
      )!,
      west: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}west'],
      ),
      south: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}south'],
      ),
      east: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}east'],
      ),
      north: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}north'],
      ),
      minZoom: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}min_zoom'],
      )!,
      maxZoom: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}max_zoom'],
      )!,
      downloadedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}downloaded_at'],
      )!,
      latestVersion: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}latest_version'],
      ),
      checkedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}checked_at'],
      ),
    );
  }

  @override
  $DownloadedRegionsTable createAlias(String alias) {
    return $DownloadedRegionsTable(attachedDatabase, alias);
  }
}

class DownloadedRegionRow extends DataClass
    implements Insertable<DownloadedRegionRow> {
  final String code;
  final String name;
  final String version;
  final String checksum;
  final int sizeBytes;

  /// Relative to the offline storage root.
  final String relativePath;
  final double? west;
  final double? south;
  final double? east;
  final double? north;
  final int minZoom;
  final int maxZoom;
  final DateTime downloadedAt;

  /// Latest version on the server at the last update check.
  final String? latestVersion;
  final DateTime? checkedAt;
  const DownloadedRegionRow({
    required this.code,
    required this.name,
    required this.version,
    required this.checksum,
    required this.sizeBytes,
    required this.relativePath,
    this.west,
    this.south,
    this.east,
    this.north,
    required this.minZoom,
    required this.maxZoom,
    required this.downloadedAt,
    this.latestVersion,
    this.checkedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['code'] = Variable<String>(code);
    map['name'] = Variable<String>(name);
    map['version'] = Variable<String>(version);
    map['checksum'] = Variable<String>(checksum);
    map['size_bytes'] = Variable<int>(sizeBytes);
    map['relative_path'] = Variable<String>(relativePath);
    if (!nullToAbsent || west != null) {
      map['west'] = Variable<double>(west);
    }
    if (!nullToAbsent || south != null) {
      map['south'] = Variable<double>(south);
    }
    if (!nullToAbsent || east != null) {
      map['east'] = Variable<double>(east);
    }
    if (!nullToAbsent || north != null) {
      map['north'] = Variable<double>(north);
    }
    map['min_zoom'] = Variable<int>(minZoom);
    map['max_zoom'] = Variable<int>(maxZoom);
    map['downloaded_at'] = Variable<DateTime>(downloadedAt);
    if (!nullToAbsent || latestVersion != null) {
      map['latest_version'] = Variable<String>(latestVersion);
    }
    if (!nullToAbsent || checkedAt != null) {
      map['checked_at'] = Variable<DateTime>(checkedAt);
    }
    return map;
  }

  DownloadedRegionsCompanion toCompanion(bool nullToAbsent) {
    return DownloadedRegionsCompanion(
      code: Value(code),
      name: Value(name),
      version: Value(version),
      checksum: Value(checksum),
      sizeBytes: Value(sizeBytes),
      relativePath: Value(relativePath),
      west: west == null && nullToAbsent ? const Value.absent() : Value(west),
      south: south == null && nullToAbsent
          ? const Value.absent()
          : Value(south),
      east: east == null && nullToAbsent ? const Value.absent() : Value(east),
      north: north == null && nullToAbsent
          ? const Value.absent()
          : Value(north),
      minZoom: Value(minZoom),
      maxZoom: Value(maxZoom),
      downloadedAt: Value(downloadedAt),
      latestVersion: latestVersion == null && nullToAbsent
          ? const Value.absent()
          : Value(latestVersion),
      checkedAt: checkedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(checkedAt),
    );
  }

  factory DownloadedRegionRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return DownloadedRegionRow(
      code: serializer.fromJson<String>(json['code']),
      name: serializer.fromJson<String>(json['name']),
      version: serializer.fromJson<String>(json['version']),
      checksum: serializer.fromJson<String>(json['checksum']),
      sizeBytes: serializer.fromJson<int>(json['sizeBytes']),
      relativePath: serializer.fromJson<String>(json['relativePath']),
      west: serializer.fromJson<double?>(json['west']),
      south: serializer.fromJson<double?>(json['south']),
      east: serializer.fromJson<double?>(json['east']),
      north: serializer.fromJson<double?>(json['north']),
      minZoom: serializer.fromJson<int>(json['minZoom']),
      maxZoom: serializer.fromJson<int>(json['maxZoom']),
      downloadedAt: serializer.fromJson<DateTime>(json['downloadedAt']),
      latestVersion: serializer.fromJson<String?>(json['latestVersion']),
      checkedAt: serializer.fromJson<DateTime?>(json['checkedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'code': serializer.toJson<String>(code),
      'name': serializer.toJson<String>(name),
      'version': serializer.toJson<String>(version),
      'checksum': serializer.toJson<String>(checksum),
      'sizeBytes': serializer.toJson<int>(sizeBytes),
      'relativePath': serializer.toJson<String>(relativePath),
      'west': serializer.toJson<double?>(west),
      'south': serializer.toJson<double?>(south),
      'east': serializer.toJson<double?>(east),
      'north': serializer.toJson<double?>(north),
      'minZoom': serializer.toJson<int>(minZoom),
      'maxZoom': serializer.toJson<int>(maxZoom),
      'downloadedAt': serializer.toJson<DateTime>(downloadedAt),
      'latestVersion': serializer.toJson<String?>(latestVersion),
      'checkedAt': serializer.toJson<DateTime?>(checkedAt),
    };
  }

  DownloadedRegionRow copyWith({
    String? code,
    String? name,
    String? version,
    String? checksum,
    int? sizeBytes,
    String? relativePath,
    Value<double?> west = const Value.absent(),
    Value<double?> south = const Value.absent(),
    Value<double?> east = const Value.absent(),
    Value<double?> north = const Value.absent(),
    int? minZoom,
    int? maxZoom,
    DateTime? downloadedAt,
    Value<String?> latestVersion = const Value.absent(),
    Value<DateTime?> checkedAt = const Value.absent(),
  }) => DownloadedRegionRow(
    code: code ?? this.code,
    name: name ?? this.name,
    version: version ?? this.version,
    checksum: checksum ?? this.checksum,
    sizeBytes: sizeBytes ?? this.sizeBytes,
    relativePath: relativePath ?? this.relativePath,
    west: west.present ? west.value : this.west,
    south: south.present ? south.value : this.south,
    east: east.present ? east.value : this.east,
    north: north.present ? north.value : this.north,
    minZoom: minZoom ?? this.minZoom,
    maxZoom: maxZoom ?? this.maxZoom,
    downloadedAt: downloadedAt ?? this.downloadedAt,
    latestVersion: latestVersion.present
        ? latestVersion.value
        : this.latestVersion,
    checkedAt: checkedAt.present ? checkedAt.value : this.checkedAt,
  );
  DownloadedRegionRow copyWithCompanion(DownloadedRegionsCompanion data) {
    return DownloadedRegionRow(
      code: data.code.present ? data.code.value : this.code,
      name: data.name.present ? data.name.value : this.name,
      version: data.version.present ? data.version.value : this.version,
      checksum: data.checksum.present ? data.checksum.value : this.checksum,
      sizeBytes: data.sizeBytes.present ? data.sizeBytes.value : this.sizeBytes,
      relativePath: data.relativePath.present
          ? data.relativePath.value
          : this.relativePath,
      west: data.west.present ? data.west.value : this.west,
      south: data.south.present ? data.south.value : this.south,
      east: data.east.present ? data.east.value : this.east,
      north: data.north.present ? data.north.value : this.north,
      minZoom: data.minZoom.present ? data.minZoom.value : this.minZoom,
      maxZoom: data.maxZoom.present ? data.maxZoom.value : this.maxZoom,
      downloadedAt: data.downloadedAt.present
          ? data.downloadedAt.value
          : this.downloadedAt,
      latestVersion: data.latestVersion.present
          ? data.latestVersion.value
          : this.latestVersion,
      checkedAt: data.checkedAt.present ? data.checkedAt.value : this.checkedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('DownloadedRegionRow(')
          ..write('code: $code, ')
          ..write('name: $name, ')
          ..write('version: $version, ')
          ..write('checksum: $checksum, ')
          ..write('sizeBytes: $sizeBytes, ')
          ..write('relativePath: $relativePath, ')
          ..write('west: $west, ')
          ..write('south: $south, ')
          ..write('east: $east, ')
          ..write('north: $north, ')
          ..write('minZoom: $minZoom, ')
          ..write('maxZoom: $maxZoom, ')
          ..write('downloadedAt: $downloadedAt, ')
          ..write('latestVersion: $latestVersion, ')
          ..write('checkedAt: $checkedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    code,
    name,
    version,
    checksum,
    sizeBytes,
    relativePath,
    west,
    south,
    east,
    north,
    minZoom,
    maxZoom,
    downloadedAt,
    latestVersion,
    checkedAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is DownloadedRegionRow &&
          other.code == this.code &&
          other.name == this.name &&
          other.version == this.version &&
          other.checksum == this.checksum &&
          other.sizeBytes == this.sizeBytes &&
          other.relativePath == this.relativePath &&
          other.west == this.west &&
          other.south == this.south &&
          other.east == this.east &&
          other.north == this.north &&
          other.minZoom == this.minZoom &&
          other.maxZoom == this.maxZoom &&
          other.downloadedAt == this.downloadedAt &&
          other.latestVersion == this.latestVersion &&
          other.checkedAt == this.checkedAt);
}

class DownloadedRegionsCompanion extends UpdateCompanion<DownloadedRegionRow> {
  final Value<String> code;
  final Value<String> name;
  final Value<String> version;
  final Value<String> checksum;
  final Value<int> sizeBytes;
  final Value<String> relativePath;
  final Value<double?> west;
  final Value<double?> south;
  final Value<double?> east;
  final Value<double?> north;
  final Value<int> minZoom;
  final Value<int> maxZoom;
  final Value<DateTime> downloadedAt;
  final Value<String?> latestVersion;
  final Value<DateTime?> checkedAt;
  final Value<int> rowid;
  const DownloadedRegionsCompanion({
    this.code = const Value.absent(),
    this.name = const Value.absent(),
    this.version = const Value.absent(),
    this.checksum = const Value.absent(),
    this.sizeBytes = const Value.absent(),
    this.relativePath = const Value.absent(),
    this.west = const Value.absent(),
    this.south = const Value.absent(),
    this.east = const Value.absent(),
    this.north = const Value.absent(),
    this.minZoom = const Value.absent(),
    this.maxZoom = const Value.absent(),
    this.downloadedAt = const Value.absent(),
    this.latestVersion = const Value.absent(),
    this.checkedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  DownloadedRegionsCompanion.insert({
    required String code,
    required String name,
    required String version,
    required String checksum,
    required int sizeBytes,
    required String relativePath,
    this.west = const Value.absent(),
    this.south = const Value.absent(),
    this.east = const Value.absent(),
    this.north = const Value.absent(),
    required int minZoom,
    required int maxZoom,
    required DateTime downloadedAt,
    this.latestVersion = const Value.absent(),
    this.checkedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : code = Value(code),
       name = Value(name),
       version = Value(version),
       checksum = Value(checksum),
       sizeBytes = Value(sizeBytes),
       relativePath = Value(relativePath),
       minZoom = Value(minZoom),
       maxZoom = Value(maxZoom),
       downloadedAt = Value(downloadedAt);
  static Insertable<DownloadedRegionRow> custom({
    Expression<String>? code,
    Expression<String>? name,
    Expression<String>? version,
    Expression<String>? checksum,
    Expression<int>? sizeBytes,
    Expression<String>? relativePath,
    Expression<double>? west,
    Expression<double>? south,
    Expression<double>? east,
    Expression<double>? north,
    Expression<int>? minZoom,
    Expression<int>? maxZoom,
    Expression<DateTime>? downloadedAt,
    Expression<String>? latestVersion,
    Expression<DateTime>? checkedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (code != null) 'code': code,
      if (name != null) 'name': name,
      if (version != null) 'version': version,
      if (checksum != null) 'checksum': checksum,
      if (sizeBytes != null) 'size_bytes': sizeBytes,
      if (relativePath != null) 'relative_path': relativePath,
      if (west != null) 'west': west,
      if (south != null) 'south': south,
      if (east != null) 'east': east,
      if (north != null) 'north': north,
      if (minZoom != null) 'min_zoom': minZoom,
      if (maxZoom != null) 'max_zoom': maxZoom,
      if (downloadedAt != null) 'downloaded_at': downloadedAt,
      if (latestVersion != null) 'latest_version': latestVersion,
      if (checkedAt != null) 'checked_at': checkedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  DownloadedRegionsCompanion copyWith({
    Value<String>? code,
    Value<String>? name,
    Value<String>? version,
    Value<String>? checksum,
    Value<int>? sizeBytes,
    Value<String>? relativePath,
    Value<double?>? west,
    Value<double?>? south,
    Value<double?>? east,
    Value<double?>? north,
    Value<int>? minZoom,
    Value<int>? maxZoom,
    Value<DateTime>? downloadedAt,
    Value<String?>? latestVersion,
    Value<DateTime?>? checkedAt,
    Value<int>? rowid,
  }) {
    return DownloadedRegionsCompanion(
      code: code ?? this.code,
      name: name ?? this.name,
      version: version ?? this.version,
      checksum: checksum ?? this.checksum,
      sizeBytes: sizeBytes ?? this.sizeBytes,
      relativePath: relativePath ?? this.relativePath,
      west: west ?? this.west,
      south: south ?? this.south,
      east: east ?? this.east,
      north: north ?? this.north,
      minZoom: minZoom ?? this.minZoom,
      maxZoom: maxZoom ?? this.maxZoom,
      downloadedAt: downloadedAt ?? this.downloadedAt,
      latestVersion: latestVersion ?? this.latestVersion,
      checkedAt: checkedAt ?? this.checkedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (code.present) {
      map['code'] = Variable<String>(code.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (version.present) {
      map['version'] = Variable<String>(version.value);
    }
    if (checksum.present) {
      map['checksum'] = Variable<String>(checksum.value);
    }
    if (sizeBytes.present) {
      map['size_bytes'] = Variable<int>(sizeBytes.value);
    }
    if (relativePath.present) {
      map['relative_path'] = Variable<String>(relativePath.value);
    }
    if (west.present) {
      map['west'] = Variable<double>(west.value);
    }
    if (south.present) {
      map['south'] = Variable<double>(south.value);
    }
    if (east.present) {
      map['east'] = Variable<double>(east.value);
    }
    if (north.present) {
      map['north'] = Variable<double>(north.value);
    }
    if (minZoom.present) {
      map['min_zoom'] = Variable<int>(minZoom.value);
    }
    if (maxZoom.present) {
      map['max_zoom'] = Variable<int>(maxZoom.value);
    }
    if (downloadedAt.present) {
      map['downloaded_at'] = Variable<DateTime>(downloadedAt.value);
    }
    if (latestVersion.present) {
      map['latest_version'] = Variable<String>(latestVersion.value);
    }
    if (checkedAt.present) {
      map['checked_at'] = Variable<DateTime>(checkedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('DownloadedRegionsCompanion(')
          ..write('code: $code, ')
          ..write('name: $name, ')
          ..write('version: $version, ')
          ..write('checksum: $checksum, ')
          ..write('sizeBytes: $sizeBytes, ')
          ..write('relativePath: $relativePath, ')
          ..write('west: $west, ')
          ..write('south: $south, ')
          ..write('east: $east, ')
          ..write('north: $north, ')
          ..write('minZoom: $minZoom, ')
          ..write('maxZoom: $maxZoom, ')
          ..write('downloadedAt: $downloadedAt, ')
          ..write('latestVersion: $latestVersion, ')
          ..write('checkedAt: $checkedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $RegionDownloadsTable extends RegionDownloads
    with TableInfo<$RegionDownloadsTable, RegionDownloadRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $RegionDownloadsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _codeMeta = const VerificationMeta('code');
  @override
  late final GeneratedColumn<String> code = GeneratedColumn<String>(
    'code',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
    'name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _versionMeta = const VerificationMeta(
    'version',
  );
  @override
  late final GeneratedColumn<String> version = GeneratedColumn<String>(
    'version',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _checksumMeta = const VerificationMeta(
    'checksum',
  );
  @override
  late final GeneratedColumn<String> checksum = GeneratedColumn<String>(
    'checksum',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _totalBytesMeta = const VerificationMeta(
    'totalBytes',
  );
  @override
  late final GeneratedColumn<int> totalBytes = GeneratedColumn<int>(
    'total_bytes',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _urlMeta = const VerificationMeta('url');
  @override
  late final GeneratedColumn<String> url = GeneratedColumn<String>(
    'url',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _relativePathMeta = const VerificationMeta(
    'relativePath',
  );
  @override
  late final GeneratedColumn<String> relativePath = GeneratedColumn<String>(
    'relative_path',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _etagMeta = const VerificationMeta('etag');
  @override
  late final GeneratedColumn<String> etag = GeneratedColumn<String>(
    'etag',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
    'status',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _errorCodeMeta = const VerificationMeta(
    'errorCode',
  );
  @override
  late final GeneratedColumn<String> errorCode = GeneratedColumn<String>(
    'error_code',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _errorMessageMeta = const VerificationMeta(
    'errorMessage',
  );
  @override
  late final GeneratedColumn<String> errorMessage = GeneratedColumn<String>(
    'error_message',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _startedAtMeta = const VerificationMeta(
    'startedAt',
  );
  @override
  late final GeneratedColumn<DateTime> startedAt = GeneratedColumn<DateTime>(
    'started_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [
    code,
    name,
    version,
    checksum,
    totalBytes,
    url,
    relativePath,
    etag,
    status,
    errorCode,
    errorMessage,
    startedAt,
    updatedAt,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'region_downloads';
  @override
  VerificationContext validateIntegrity(
    Insertable<RegionDownloadRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('code')) {
      context.handle(
        _codeMeta,
        code.isAcceptableOrUnknown(data['code']!, _codeMeta),
      );
    } else if (isInserting) {
      context.missing(_codeMeta);
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('version')) {
      context.handle(
        _versionMeta,
        version.isAcceptableOrUnknown(data['version']!, _versionMeta),
      );
    } else if (isInserting) {
      context.missing(_versionMeta);
    }
    if (data.containsKey('checksum')) {
      context.handle(
        _checksumMeta,
        checksum.isAcceptableOrUnknown(data['checksum']!, _checksumMeta),
      );
    } else if (isInserting) {
      context.missing(_checksumMeta);
    }
    if (data.containsKey('total_bytes')) {
      context.handle(
        _totalBytesMeta,
        totalBytes.isAcceptableOrUnknown(data['total_bytes']!, _totalBytesMeta),
      );
    } else if (isInserting) {
      context.missing(_totalBytesMeta);
    }
    if (data.containsKey('url')) {
      context.handle(
        _urlMeta,
        url.isAcceptableOrUnknown(data['url']!, _urlMeta),
      );
    } else if (isInserting) {
      context.missing(_urlMeta);
    }
    if (data.containsKey('relative_path')) {
      context.handle(
        _relativePathMeta,
        relativePath.isAcceptableOrUnknown(
          data['relative_path']!,
          _relativePathMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_relativePathMeta);
    }
    if (data.containsKey('etag')) {
      context.handle(
        _etagMeta,
        etag.isAcceptableOrUnknown(data['etag']!, _etagMeta),
      );
    }
    if (data.containsKey('status')) {
      context.handle(
        _statusMeta,
        status.isAcceptableOrUnknown(data['status']!, _statusMeta),
      );
    } else if (isInserting) {
      context.missing(_statusMeta);
    }
    if (data.containsKey('error_code')) {
      context.handle(
        _errorCodeMeta,
        errorCode.isAcceptableOrUnknown(data['error_code']!, _errorCodeMeta),
      );
    }
    if (data.containsKey('error_message')) {
      context.handle(
        _errorMessageMeta,
        errorMessage.isAcceptableOrUnknown(
          data['error_message']!,
          _errorMessageMeta,
        ),
      );
    }
    if (data.containsKey('started_at')) {
      context.handle(
        _startedAtMeta,
        startedAt.isAcceptableOrUnknown(data['started_at']!, _startedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_startedAtMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {code};
  @override
  RegionDownloadRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return RegionDownloadRow(
      code: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}code'],
      )!,
      name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}name'],
      )!,
      version: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}version'],
      )!,
      checksum: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}checksum'],
      )!,
      totalBytes: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}total_bytes'],
      )!,
      url: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}url'],
      )!,
      relativePath: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}relative_path'],
      )!,
      etag: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}etag'],
      ),
      status: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}status'],
      )!,
      errorCode: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}error_code'],
      ),
      errorMessage: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}error_message'],
      ),
      startedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}started_at'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
    );
  }

  @override
  $RegionDownloadsTable createAlias(String alias) {
    return $RegionDownloadsTable(attachedDatabase, alias);
  }
}

class RegionDownloadRow extends DataClass
    implements Insertable<RegionDownloadRow> {
  final String code;
  final String name;
  final String version;
  final String checksum;
  final int totalBytes;
  final String url;

  /// Final file, relative to the offline storage root.
  final String relativePath;

  /// ETag of the first response, sent back in `If-Range` when resuming.
  final String? etag;

  /// DOWNLOADING, PAUSED or FAILED.
  final String status;
  final String? errorCode;
  final String? errorMessage;
  final DateTime startedAt;
  final DateTime updatedAt;
  const RegionDownloadRow({
    required this.code,
    required this.name,
    required this.version,
    required this.checksum,
    required this.totalBytes,
    required this.url,
    required this.relativePath,
    this.etag,
    required this.status,
    this.errorCode,
    this.errorMessage,
    required this.startedAt,
    required this.updatedAt,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['code'] = Variable<String>(code);
    map['name'] = Variable<String>(name);
    map['version'] = Variable<String>(version);
    map['checksum'] = Variable<String>(checksum);
    map['total_bytes'] = Variable<int>(totalBytes);
    map['url'] = Variable<String>(url);
    map['relative_path'] = Variable<String>(relativePath);
    if (!nullToAbsent || etag != null) {
      map['etag'] = Variable<String>(etag);
    }
    map['status'] = Variable<String>(status);
    if (!nullToAbsent || errorCode != null) {
      map['error_code'] = Variable<String>(errorCode);
    }
    if (!nullToAbsent || errorMessage != null) {
      map['error_message'] = Variable<String>(errorMessage);
    }
    map['started_at'] = Variable<DateTime>(startedAt);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    return map;
  }

  RegionDownloadsCompanion toCompanion(bool nullToAbsent) {
    return RegionDownloadsCompanion(
      code: Value(code),
      name: Value(name),
      version: Value(version),
      checksum: Value(checksum),
      totalBytes: Value(totalBytes),
      url: Value(url),
      relativePath: Value(relativePath),
      etag: etag == null && nullToAbsent ? const Value.absent() : Value(etag),
      status: Value(status),
      errorCode: errorCode == null && nullToAbsent
          ? const Value.absent()
          : Value(errorCode),
      errorMessage: errorMessage == null && nullToAbsent
          ? const Value.absent()
          : Value(errorMessage),
      startedAt: Value(startedAt),
      updatedAt: Value(updatedAt),
    );
  }

  factory RegionDownloadRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return RegionDownloadRow(
      code: serializer.fromJson<String>(json['code']),
      name: serializer.fromJson<String>(json['name']),
      version: serializer.fromJson<String>(json['version']),
      checksum: serializer.fromJson<String>(json['checksum']),
      totalBytes: serializer.fromJson<int>(json['totalBytes']),
      url: serializer.fromJson<String>(json['url']),
      relativePath: serializer.fromJson<String>(json['relativePath']),
      etag: serializer.fromJson<String?>(json['etag']),
      status: serializer.fromJson<String>(json['status']),
      errorCode: serializer.fromJson<String?>(json['errorCode']),
      errorMessage: serializer.fromJson<String?>(json['errorMessage']),
      startedAt: serializer.fromJson<DateTime>(json['startedAt']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'code': serializer.toJson<String>(code),
      'name': serializer.toJson<String>(name),
      'version': serializer.toJson<String>(version),
      'checksum': serializer.toJson<String>(checksum),
      'totalBytes': serializer.toJson<int>(totalBytes),
      'url': serializer.toJson<String>(url),
      'relativePath': serializer.toJson<String>(relativePath),
      'etag': serializer.toJson<String?>(etag),
      'status': serializer.toJson<String>(status),
      'errorCode': serializer.toJson<String?>(errorCode),
      'errorMessage': serializer.toJson<String?>(errorMessage),
      'startedAt': serializer.toJson<DateTime>(startedAt),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
    };
  }

  RegionDownloadRow copyWith({
    String? code,
    String? name,
    String? version,
    String? checksum,
    int? totalBytes,
    String? url,
    String? relativePath,
    Value<String?> etag = const Value.absent(),
    String? status,
    Value<String?> errorCode = const Value.absent(),
    Value<String?> errorMessage = const Value.absent(),
    DateTime? startedAt,
    DateTime? updatedAt,
  }) => RegionDownloadRow(
    code: code ?? this.code,
    name: name ?? this.name,
    version: version ?? this.version,
    checksum: checksum ?? this.checksum,
    totalBytes: totalBytes ?? this.totalBytes,
    url: url ?? this.url,
    relativePath: relativePath ?? this.relativePath,
    etag: etag.present ? etag.value : this.etag,
    status: status ?? this.status,
    errorCode: errorCode.present ? errorCode.value : this.errorCode,
    errorMessage: errorMessage.present ? errorMessage.value : this.errorMessage,
    startedAt: startedAt ?? this.startedAt,
    updatedAt: updatedAt ?? this.updatedAt,
  );
  RegionDownloadRow copyWithCompanion(RegionDownloadsCompanion data) {
    return RegionDownloadRow(
      code: data.code.present ? data.code.value : this.code,
      name: data.name.present ? data.name.value : this.name,
      version: data.version.present ? data.version.value : this.version,
      checksum: data.checksum.present ? data.checksum.value : this.checksum,
      totalBytes: data.totalBytes.present
          ? data.totalBytes.value
          : this.totalBytes,
      url: data.url.present ? data.url.value : this.url,
      relativePath: data.relativePath.present
          ? data.relativePath.value
          : this.relativePath,
      etag: data.etag.present ? data.etag.value : this.etag,
      status: data.status.present ? data.status.value : this.status,
      errorCode: data.errorCode.present ? data.errorCode.value : this.errorCode,
      errorMessage: data.errorMessage.present
          ? data.errorMessage.value
          : this.errorMessage,
      startedAt: data.startedAt.present ? data.startedAt.value : this.startedAt,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
    );
  }

  @override
  String toString() {
    return (StringBuffer('RegionDownloadRow(')
          ..write('code: $code, ')
          ..write('name: $name, ')
          ..write('version: $version, ')
          ..write('checksum: $checksum, ')
          ..write('totalBytes: $totalBytes, ')
          ..write('url: $url, ')
          ..write('relativePath: $relativePath, ')
          ..write('etag: $etag, ')
          ..write('status: $status, ')
          ..write('errorCode: $errorCode, ')
          ..write('errorMessage: $errorMessage, ')
          ..write('startedAt: $startedAt, ')
          ..write('updatedAt: $updatedAt')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    code,
    name,
    version,
    checksum,
    totalBytes,
    url,
    relativePath,
    etag,
    status,
    errorCode,
    errorMessage,
    startedAt,
    updatedAt,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is RegionDownloadRow &&
          other.code == this.code &&
          other.name == this.name &&
          other.version == this.version &&
          other.checksum == this.checksum &&
          other.totalBytes == this.totalBytes &&
          other.url == this.url &&
          other.relativePath == this.relativePath &&
          other.etag == this.etag &&
          other.status == this.status &&
          other.errorCode == this.errorCode &&
          other.errorMessage == this.errorMessage &&
          other.startedAt == this.startedAt &&
          other.updatedAt == this.updatedAt);
}

class RegionDownloadsCompanion extends UpdateCompanion<RegionDownloadRow> {
  final Value<String> code;
  final Value<String> name;
  final Value<String> version;
  final Value<String> checksum;
  final Value<int> totalBytes;
  final Value<String> url;
  final Value<String> relativePath;
  final Value<String?> etag;
  final Value<String> status;
  final Value<String?> errorCode;
  final Value<String?> errorMessage;
  final Value<DateTime> startedAt;
  final Value<DateTime> updatedAt;
  final Value<int> rowid;
  const RegionDownloadsCompanion({
    this.code = const Value.absent(),
    this.name = const Value.absent(),
    this.version = const Value.absent(),
    this.checksum = const Value.absent(),
    this.totalBytes = const Value.absent(),
    this.url = const Value.absent(),
    this.relativePath = const Value.absent(),
    this.etag = const Value.absent(),
    this.status = const Value.absent(),
    this.errorCode = const Value.absent(),
    this.errorMessage = const Value.absent(),
    this.startedAt = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  RegionDownloadsCompanion.insert({
    required String code,
    required String name,
    required String version,
    required String checksum,
    required int totalBytes,
    required String url,
    required String relativePath,
    this.etag = const Value.absent(),
    required String status,
    this.errorCode = const Value.absent(),
    this.errorMessage = const Value.absent(),
    required DateTime startedAt,
    required DateTime updatedAt,
    this.rowid = const Value.absent(),
  }) : code = Value(code),
       name = Value(name),
       version = Value(version),
       checksum = Value(checksum),
       totalBytes = Value(totalBytes),
       url = Value(url),
       relativePath = Value(relativePath),
       status = Value(status),
       startedAt = Value(startedAt),
       updatedAt = Value(updatedAt);
  static Insertable<RegionDownloadRow> custom({
    Expression<String>? code,
    Expression<String>? name,
    Expression<String>? version,
    Expression<String>? checksum,
    Expression<int>? totalBytes,
    Expression<String>? url,
    Expression<String>? relativePath,
    Expression<String>? etag,
    Expression<String>? status,
    Expression<String>? errorCode,
    Expression<String>? errorMessage,
    Expression<DateTime>? startedAt,
    Expression<DateTime>? updatedAt,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (code != null) 'code': code,
      if (name != null) 'name': name,
      if (version != null) 'version': version,
      if (checksum != null) 'checksum': checksum,
      if (totalBytes != null) 'total_bytes': totalBytes,
      if (url != null) 'url': url,
      if (relativePath != null) 'relative_path': relativePath,
      if (etag != null) 'etag': etag,
      if (status != null) 'status': status,
      if (errorCode != null) 'error_code': errorCode,
      if (errorMessage != null) 'error_message': errorMessage,
      if (startedAt != null) 'started_at': startedAt,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (rowid != null) 'rowid': rowid,
    });
  }

  RegionDownloadsCompanion copyWith({
    Value<String>? code,
    Value<String>? name,
    Value<String>? version,
    Value<String>? checksum,
    Value<int>? totalBytes,
    Value<String>? url,
    Value<String>? relativePath,
    Value<String?>? etag,
    Value<String>? status,
    Value<String?>? errorCode,
    Value<String?>? errorMessage,
    Value<DateTime>? startedAt,
    Value<DateTime>? updatedAt,
    Value<int>? rowid,
  }) {
    return RegionDownloadsCompanion(
      code: code ?? this.code,
      name: name ?? this.name,
      version: version ?? this.version,
      checksum: checksum ?? this.checksum,
      totalBytes: totalBytes ?? this.totalBytes,
      url: url ?? this.url,
      relativePath: relativePath ?? this.relativePath,
      etag: etag ?? this.etag,
      status: status ?? this.status,
      errorCode: errorCode ?? this.errorCode,
      errorMessage: errorMessage ?? this.errorMessage,
      startedAt: startedAt ?? this.startedAt,
      updatedAt: updatedAt ?? this.updatedAt,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (code.present) {
      map['code'] = Variable<String>(code.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (version.present) {
      map['version'] = Variable<String>(version.value);
    }
    if (checksum.present) {
      map['checksum'] = Variable<String>(checksum.value);
    }
    if (totalBytes.present) {
      map['total_bytes'] = Variable<int>(totalBytes.value);
    }
    if (url.present) {
      map['url'] = Variable<String>(url.value);
    }
    if (relativePath.present) {
      map['relative_path'] = Variable<String>(relativePath.value);
    }
    if (etag.present) {
      map['etag'] = Variable<String>(etag.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (errorCode.present) {
      map['error_code'] = Variable<String>(errorCode.value);
    }
    if (errorMessage.present) {
      map['error_message'] = Variable<String>(errorMessage.value);
    }
    if (startedAt.present) {
      map['started_at'] = Variable<DateTime>(startedAt.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('RegionDownloadsCompanion(')
          ..write('code: $code, ')
          ..write('name: $name, ')
          ..write('version: $version, ')
          ..write('checksum: $checksum, ')
          ..write('totalBytes: $totalBytes, ')
          ..write('url: $url, ')
          ..write('relativePath: $relativePath, ')
          ..write('etag: $etag, ')
          ..write('status: $status, ')
          ..write('errorCode: $errorCode, ')
          ..write('errorMessage: $errorMessage, ')
          ..write('startedAt: $startedAt, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $OfflineRoutesTable extends OfflineRoutes
    with TableInfo<$OfflineRoutesTable, OfflineRouteRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $OfflineRoutesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _routeIdMeta = const VerificationMeta(
    'routeId',
  );
  @override
  late final GeneratedColumn<String> routeId = GeneratedColumn<String>(
    'route_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
    'name',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _profileMeta = const VerificationMeta(
    'profile',
  );
  @override
  late final GeneratedColumn<String> profile = GeneratedColumn<String>(
    'profile',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _originLatitudeMeta = const VerificationMeta(
    'originLatitude',
  );
  @override
  late final GeneratedColumn<double> originLatitude = GeneratedColumn<double>(
    'origin_latitude',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _originLongitudeMeta = const VerificationMeta(
    'originLongitude',
  );
  @override
  late final GeneratedColumn<double> originLongitude = GeneratedColumn<double>(
    'origin_longitude',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _destinationLatitudeMeta =
      const VerificationMeta('destinationLatitude');
  @override
  late final GeneratedColumn<double> destinationLatitude =
      GeneratedColumn<double>(
        'destination_latitude',
        aliasedName,
        false,
        type: DriftSqlType.double,
        requiredDuringInsert: true,
      );
  static const VerificationMeta _destinationLongitudeMeta =
      const VerificationMeta('destinationLongitude');
  @override
  late final GeneratedColumn<double> destinationLongitude =
      GeneratedColumn<double>(
        'destination_longitude',
        aliasedName,
        false,
        type: DriftSqlType.double,
        requiredDuringInsert: true,
      );
  static const VerificationMeta _distanceMetersMeta = const VerificationMeta(
    'distanceMeters',
  );
  @override
  late final GeneratedColumn<double> distanceMeters = GeneratedColumn<double>(
    'distance_meters',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _durationSecondsMeta = const VerificationMeta(
    'durationSeconds',
  );
  @override
  late final GeneratedColumn<double> durationSeconds = GeneratedColumn<double>(
    'duration_seconds',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _geometryMeta = const VerificationMeta(
    'geometry',
  );
  @override
  late final GeneratedColumn<String> geometry = GeneratedColumn<String>(
    'geometry',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _stepsMeta = const VerificationMeta('steps');
  @override
  late final GeneratedColumn<String> steps = GeneratedColumn<String>(
    'steps',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _regionIdMeta = const VerificationMeta(
    'regionId',
  );
  @override
  late final GeneratedColumn<String> regionId = GeneratedColumn<String>(
    'region_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _providerMeta = const VerificationMeta(
    'provider',
  );
  @override
  late final GeneratedColumn<String> provider = GeneratedColumn<String>(
    'provider',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _updatedAtMeta = const VerificationMeta(
    'updatedAt',
  );
  @override
  late final GeneratedColumn<DateTime> updatedAt = GeneratedColumn<DateTime>(
    'updated_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _accountIdMeta = const VerificationMeta(
    'accountId',
  );
  @override
  late final GeneratedColumn<String> accountId = GeneratedColumn<String>(
    'account_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    routeId,
    name,
    profile,
    originLatitude,
    originLongitude,
    destinationLatitude,
    destinationLongitude,
    distanceMeters,
    durationSeconds,
    geometry,
    steps,
    regionId,
    provider,
    createdAt,
    updatedAt,
    accountId,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'offline_routes';
  @override
  VerificationContext validateIntegrity(
    Insertable<OfflineRouteRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('route_id')) {
      context.handle(
        _routeIdMeta,
        routeId.isAcceptableOrUnknown(data['route_id']!, _routeIdMeta),
      );
    } else if (isInserting) {
      context.missing(_routeIdMeta);
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    } else if (isInserting) {
      context.missing(_nameMeta);
    }
    if (data.containsKey('profile')) {
      context.handle(
        _profileMeta,
        profile.isAcceptableOrUnknown(data['profile']!, _profileMeta),
      );
    } else if (isInserting) {
      context.missing(_profileMeta);
    }
    if (data.containsKey('origin_latitude')) {
      context.handle(
        _originLatitudeMeta,
        originLatitude.isAcceptableOrUnknown(
          data['origin_latitude']!,
          _originLatitudeMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_originLatitudeMeta);
    }
    if (data.containsKey('origin_longitude')) {
      context.handle(
        _originLongitudeMeta,
        originLongitude.isAcceptableOrUnknown(
          data['origin_longitude']!,
          _originLongitudeMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_originLongitudeMeta);
    }
    if (data.containsKey('destination_latitude')) {
      context.handle(
        _destinationLatitudeMeta,
        destinationLatitude.isAcceptableOrUnknown(
          data['destination_latitude']!,
          _destinationLatitudeMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_destinationLatitudeMeta);
    }
    if (data.containsKey('destination_longitude')) {
      context.handle(
        _destinationLongitudeMeta,
        destinationLongitude.isAcceptableOrUnknown(
          data['destination_longitude']!,
          _destinationLongitudeMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_destinationLongitudeMeta);
    }
    if (data.containsKey('distance_meters')) {
      context.handle(
        _distanceMetersMeta,
        distanceMeters.isAcceptableOrUnknown(
          data['distance_meters']!,
          _distanceMetersMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_distanceMetersMeta);
    }
    if (data.containsKey('duration_seconds')) {
      context.handle(
        _durationSecondsMeta,
        durationSeconds.isAcceptableOrUnknown(
          data['duration_seconds']!,
          _durationSecondsMeta,
        ),
      );
    } else if (isInserting) {
      context.missing(_durationSecondsMeta);
    }
    if (data.containsKey('geometry')) {
      context.handle(
        _geometryMeta,
        geometry.isAcceptableOrUnknown(data['geometry']!, _geometryMeta),
      );
    } else if (isInserting) {
      context.missing(_geometryMeta);
    }
    if (data.containsKey('steps')) {
      context.handle(
        _stepsMeta,
        steps.isAcceptableOrUnknown(data['steps']!, _stepsMeta),
      );
    } else if (isInserting) {
      context.missing(_stepsMeta);
    }
    if (data.containsKey('region_id')) {
      context.handle(
        _regionIdMeta,
        regionId.isAcceptableOrUnknown(data['region_id']!, _regionIdMeta),
      );
    }
    if (data.containsKey('provider')) {
      context.handle(
        _providerMeta,
        provider.isAcceptableOrUnknown(data['provider']!, _providerMeta),
      );
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    if (data.containsKey('updated_at')) {
      context.handle(
        _updatedAtMeta,
        updatedAt.isAcceptableOrUnknown(data['updated_at']!, _updatedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_updatedAtMeta);
    }
    if (data.containsKey('account_id')) {
      context.handle(
        _accountIdMeta,
        accountId.isAcceptableOrUnknown(data['account_id']!, _accountIdMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {routeId};
  @override
  OfflineRouteRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return OfflineRouteRow(
      routeId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}route_id'],
      )!,
      name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}name'],
      )!,
      profile: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}profile'],
      )!,
      originLatitude: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}origin_latitude'],
      )!,
      originLongitude: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}origin_longitude'],
      )!,
      destinationLatitude: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}destination_latitude'],
      )!,
      destinationLongitude: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}destination_longitude'],
      )!,
      distanceMeters: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}distance_meters'],
      )!,
      durationSeconds: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}duration_seconds'],
      )!,
      geometry: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}geometry'],
      )!,
      steps: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}steps'],
      )!,
      regionId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}region_id'],
      ),
      provider: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}provider'],
      ),
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
      updatedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}updated_at'],
      )!,
      accountId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}account_id'],
      ),
    );
  }

  @override
  $OfflineRoutesTable createAlias(String alias) {
    return $OfflineRoutesTable(attachedDatabase, alias);
  }
}

class OfflineRouteRow extends DataClass implements Insertable<OfflineRouteRow> {
  final String routeId;
  final String name;
  final String profile;
  final double originLatitude;
  final double originLongitude;
  final double destinationLatitude;
  final double destinationLongitude;
  final double distanceMeters;
  final double durationSeconds;

  /// GeoJSON positions `[[lng, lat], ...]`.
  final String geometry;

  /// JSON array of steps, same shape as the API.
  final String steps;
  final String? regionId;
  final String? provider;
  final DateTime createdAt;
  final DateTime updatedAt;

  /// Owner account (user id); null for a route saved without an account.
  final String? accountId;
  const OfflineRouteRow({
    required this.routeId,
    required this.name,
    required this.profile,
    required this.originLatitude,
    required this.originLongitude,
    required this.destinationLatitude,
    required this.destinationLongitude,
    required this.distanceMeters,
    required this.durationSeconds,
    required this.geometry,
    required this.steps,
    this.regionId,
    this.provider,
    required this.createdAt,
    required this.updatedAt,
    this.accountId,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['route_id'] = Variable<String>(routeId);
    map['name'] = Variable<String>(name);
    map['profile'] = Variable<String>(profile);
    map['origin_latitude'] = Variable<double>(originLatitude);
    map['origin_longitude'] = Variable<double>(originLongitude);
    map['destination_latitude'] = Variable<double>(destinationLatitude);
    map['destination_longitude'] = Variable<double>(destinationLongitude);
    map['distance_meters'] = Variable<double>(distanceMeters);
    map['duration_seconds'] = Variable<double>(durationSeconds);
    map['geometry'] = Variable<String>(geometry);
    map['steps'] = Variable<String>(steps);
    if (!nullToAbsent || regionId != null) {
      map['region_id'] = Variable<String>(regionId);
    }
    if (!nullToAbsent || provider != null) {
      map['provider'] = Variable<String>(provider);
    }
    map['created_at'] = Variable<DateTime>(createdAt);
    map['updated_at'] = Variable<DateTime>(updatedAt);
    if (!nullToAbsent || accountId != null) {
      map['account_id'] = Variable<String>(accountId);
    }
    return map;
  }

  OfflineRoutesCompanion toCompanion(bool nullToAbsent) {
    return OfflineRoutesCompanion(
      routeId: Value(routeId),
      name: Value(name),
      profile: Value(profile),
      originLatitude: Value(originLatitude),
      originLongitude: Value(originLongitude),
      destinationLatitude: Value(destinationLatitude),
      destinationLongitude: Value(destinationLongitude),
      distanceMeters: Value(distanceMeters),
      durationSeconds: Value(durationSeconds),
      geometry: Value(geometry),
      steps: Value(steps),
      regionId: regionId == null && nullToAbsent
          ? const Value.absent()
          : Value(regionId),
      provider: provider == null && nullToAbsent
          ? const Value.absent()
          : Value(provider),
      createdAt: Value(createdAt),
      updatedAt: Value(updatedAt),
      accountId: accountId == null && nullToAbsent
          ? const Value.absent()
          : Value(accountId),
    );
  }

  factory OfflineRouteRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return OfflineRouteRow(
      routeId: serializer.fromJson<String>(json['routeId']),
      name: serializer.fromJson<String>(json['name']),
      profile: serializer.fromJson<String>(json['profile']),
      originLatitude: serializer.fromJson<double>(json['originLatitude']),
      originLongitude: serializer.fromJson<double>(json['originLongitude']),
      destinationLatitude: serializer.fromJson<double>(
        json['destinationLatitude'],
      ),
      destinationLongitude: serializer.fromJson<double>(
        json['destinationLongitude'],
      ),
      distanceMeters: serializer.fromJson<double>(json['distanceMeters']),
      durationSeconds: serializer.fromJson<double>(json['durationSeconds']),
      geometry: serializer.fromJson<String>(json['geometry']),
      steps: serializer.fromJson<String>(json['steps']),
      regionId: serializer.fromJson<String?>(json['regionId']),
      provider: serializer.fromJson<String?>(json['provider']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      updatedAt: serializer.fromJson<DateTime>(json['updatedAt']),
      accountId: serializer.fromJson<String?>(json['accountId']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'routeId': serializer.toJson<String>(routeId),
      'name': serializer.toJson<String>(name),
      'profile': serializer.toJson<String>(profile),
      'originLatitude': serializer.toJson<double>(originLatitude),
      'originLongitude': serializer.toJson<double>(originLongitude),
      'destinationLatitude': serializer.toJson<double>(destinationLatitude),
      'destinationLongitude': serializer.toJson<double>(destinationLongitude),
      'distanceMeters': serializer.toJson<double>(distanceMeters),
      'durationSeconds': serializer.toJson<double>(durationSeconds),
      'geometry': serializer.toJson<String>(geometry),
      'steps': serializer.toJson<String>(steps),
      'regionId': serializer.toJson<String?>(regionId),
      'provider': serializer.toJson<String?>(provider),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'updatedAt': serializer.toJson<DateTime>(updatedAt),
      'accountId': serializer.toJson<String?>(accountId),
    };
  }

  OfflineRouteRow copyWith({
    String? routeId,
    String? name,
    String? profile,
    double? originLatitude,
    double? originLongitude,
    double? destinationLatitude,
    double? destinationLongitude,
    double? distanceMeters,
    double? durationSeconds,
    String? geometry,
    String? steps,
    Value<String?> regionId = const Value.absent(),
    Value<String?> provider = const Value.absent(),
    DateTime? createdAt,
    DateTime? updatedAt,
    Value<String?> accountId = const Value.absent(),
  }) => OfflineRouteRow(
    routeId: routeId ?? this.routeId,
    name: name ?? this.name,
    profile: profile ?? this.profile,
    originLatitude: originLatitude ?? this.originLatitude,
    originLongitude: originLongitude ?? this.originLongitude,
    destinationLatitude: destinationLatitude ?? this.destinationLatitude,
    destinationLongitude: destinationLongitude ?? this.destinationLongitude,
    distanceMeters: distanceMeters ?? this.distanceMeters,
    durationSeconds: durationSeconds ?? this.durationSeconds,
    geometry: geometry ?? this.geometry,
    steps: steps ?? this.steps,
    regionId: regionId.present ? regionId.value : this.regionId,
    provider: provider.present ? provider.value : this.provider,
    createdAt: createdAt ?? this.createdAt,
    updatedAt: updatedAt ?? this.updatedAt,
    accountId: accountId.present ? accountId.value : this.accountId,
  );
  OfflineRouteRow copyWithCompanion(OfflineRoutesCompanion data) {
    return OfflineRouteRow(
      routeId: data.routeId.present ? data.routeId.value : this.routeId,
      name: data.name.present ? data.name.value : this.name,
      profile: data.profile.present ? data.profile.value : this.profile,
      originLatitude: data.originLatitude.present
          ? data.originLatitude.value
          : this.originLatitude,
      originLongitude: data.originLongitude.present
          ? data.originLongitude.value
          : this.originLongitude,
      destinationLatitude: data.destinationLatitude.present
          ? data.destinationLatitude.value
          : this.destinationLatitude,
      destinationLongitude: data.destinationLongitude.present
          ? data.destinationLongitude.value
          : this.destinationLongitude,
      distanceMeters: data.distanceMeters.present
          ? data.distanceMeters.value
          : this.distanceMeters,
      durationSeconds: data.durationSeconds.present
          ? data.durationSeconds.value
          : this.durationSeconds,
      geometry: data.geometry.present ? data.geometry.value : this.geometry,
      steps: data.steps.present ? data.steps.value : this.steps,
      regionId: data.regionId.present ? data.regionId.value : this.regionId,
      provider: data.provider.present ? data.provider.value : this.provider,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      updatedAt: data.updatedAt.present ? data.updatedAt.value : this.updatedAt,
      accountId: data.accountId.present ? data.accountId.value : this.accountId,
    );
  }

  @override
  String toString() {
    return (StringBuffer('OfflineRouteRow(')
          ..write('routeId: $routeId, ')
          ..write('name: $name, ')
          ..write('profile: $profile, ')
          ..write('originLatitude: $originLatitude, ')
          ..write('originLongitude: $originLongitude, ')
          ..write('destinationLatitude: $destinationLatitude, ')
          ..write('destinationLongitude: $destinationLongitude, ')
          ..write('distanceMeters: $distanceMeters, ')
          ..write('durationSeconds: $durationSeconds, ')
          ..write('geometry: $geometry, ')
          ..write('steps: $steps, ')
          ..write('regionId: $regionId, ')
          ..write('provider: $provider, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('accountId: $accountId')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    routeId,
    name,
    profile,
    originLatitude,
    originLongitude,
    destinationLatitude,
    destinationLongitude,
    distanceMeters,
    durationSeconds,
    geometry,
    steps,
    regionId,
    provider,
    createdAt,
    updatedAt,
    accountId,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is OfflineRouteRow &&
          other.routeId == this.routeId &&
          other.name == this.name &&
          other.profile == this.profile &&
          other.originLatitude == this.originLatitude &&
          other.originLongitude == this.originLongitude &&
          other.destinationLatitude == this.destinationLatitude &&
          other.destinationLongitude == this.destinationLongitude &&
          other.distanceMeters == this.distanceMeters &&
          other.durationSeconds == this.durationSeconds &&
          other.geometry == this.geometry &&
          other.steps == this.steps &&
          other.regionId == this.regionId &&
          other.provider == this.provider &&
          other.createdAt == this.createdAt &&
          other.updatedAt == this.updatedAt &&
          other.accountId == this.accountId);
}

class OfflineRoutesCompanion extends UpdateCompanion<OfflineRouteRow> {
  final Value<String> routeId;
  final Value<String> name;
  final Value<String> profile;
  final Value<double> originLatitude;
  final Value<double> originLongitude;
  final Value<double> destinationLatitude;
  final Value<double> destinationLongitude;
  final Value<double> distanceMeters;
  final Value<double> durationSeconds;
  final Value<String> geometry;
  final Value<String> steps;
  final Value<String?> regionId;
  final Value<String?> provider;
  final Value<DateTime> createdAt;
  final Value<DateTime> updatedAt;
  final Value<String?> accountId;
  final Value<int> rowid;
  const OfflineRoutesCompanion({
    this.routeId = const Value.absent(),
    this.name = const Value.absent(),
    this.profile = const Value.absent(),
    this.originLatitude = const Value.absent(),
    this.originLongitude = const Value.absent(),
    this.destinationLatitude = const Value.absent(),
    this.destinationLongitude = const Value.absent(),
    this.distanceMeters = const Value.absent(),
    this.durationSeconds = const Value.absent(),
    this.geometry = const Value.absent(),
    this.steps = const Value.absent(),
    this.regionId = const Value.absent(),
    this.provider = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.updatedAt = const Value.absent(),
    this.accountId = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  OfflineRoutesCompanion.insert({
    required String routeId,
    required String name,
    required String profile,
    required double originLatitude,
    required double originLongitude,
    required double destinationLatitude,
    required double destinationLongitude,
    required double distanceMeters,
    required double durationSeconds,
    required String geometry,
    required String steps,
    this.regionId = const Value.absent(),
    this.provider = const Value.absent(),
    required DateTime createdAt,
    required DateTime updatedAt,
    this.accountId = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : routeId = Value(routeId),
       name = Value(name),
       profile = Value(profile),
       originLatitude = Value(originLatitude),
       originLongitude = Value(originLongitude),
       destinationLatitude = Value(destinationLatitude),
       destinationLongitude = Value(destinationLongitude),
       distanceMeters = Value(distanceMeters),
       durationSeconds = Value(durationSeconds),
       geometry = Value(geometry),
       steps = Value(steps),
       createdAt = Value(createdAt),
       updatedAt = Value(updatedAt);
  static Insertable<OfflineRouteRow> custom({
    Expression<String>? routeId,
    Expression<String>? name,
    Expression<String>? profile,
    Expression<double>? originLatitude,
    Expression<double>? originLongitude,
    Expression<double>? destinationLatitude,
    Expression<double>? destinationLongitude,
    Expression<double>? distanceMeters,
    Expression<double>? durationSeconds,
    Expression<String>? geometry,
    Expression<String>? steps,
    Expression<String>? regionId,
    Expression<String>? provider,
    Expression<DateTime>? createdAt,
    Expression<DateTime>? updatedAt,
    Expression<String>? accountId,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (routeId != null) 'route_id': routeId,
      if (name != null) 'name': name,
      if (profile != null) 'profile': profile,
      if (originLatitude != null) 'origin_latitude': originLatitude,
      if (originLongitude != null) 'origin_longitude': originLongitude,
      if (destinationLatitude != null)
        'destination_latitude': destinationLatitude,
      if (destinationLongitude != null)
        'destination_longitude': destinationLongitude,
      if (distanceMeters != null) 'distance_meters': distanceMeters,
      if (durationSeconds != null) 'duration_seconds': durationSeconds,
      if (geometry != null) 'geometry': geometry,
      if (steps != null) 'steps': steps,
      if (regionId != null) 'region_id': regionId,
      if (provider != null) 'provider': provider,
      if (createdAt != null) 'created_at': createdAt,
      if (updatedAt != null) 'updated_at': updatedAt,
      if (accountId != null) 'account_id': accountId,
      if (rowid != null) 'rowid': rowid,
    });
  }

  OfflineRoutesCompanion copyWith({
    Value<String>? routeId,
    Value<String>? name,
    Value<String>? profile,
    Value<double>? originLatitude,
    Value<double>? originLongitude,
    Value<double>? destinationLatitude,
    Value<double>? destinationLongitude,
    Value<double>? distanceMeters,
    Value<double>? durationSeconds,
    Value<String>? geometry,
    Value<String>? steps,
    Value<String?>? regionId,
    Value<String?>? provider,
    Value<DateTime>? createdAt,
    Value<DateTime>? updatedAt,
    Value<String?>? accountId,
    Value<int>? rowid,
  }) {
    return OfflineRoutesCompanion(
      routeId: routeId ?? this.routeId,
      name: name ?? this.name,
      profile: profile ?? this.profile,
      originLatitude: originLatitude ?? this.originLatitude,
      originLongitude: originLongitude ?? this.originLongitude,
      destinationLatitude: destinationLatitude ?? this.destinationLatitude,
      destinationLongitude: destinationLongitude ?? this.destinationLongitude,
      distanceMeters: distanceMeters ?? this.distanceMeters,
      durationSeconds: durationSeconds ?? this.durationSeconds,
      geometry: geometry ?? this.geometry,
      steps: steps ?? this.steps,
      regionId: regionId ?? this.regionId,
      provider: provider ?? this.provider,
      createdAt: createdAt ?? this.createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      accountId: accountId ?? this.accountId,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (routeId.present) {
      map['route_id'] = Variable<String>(routeId.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (profile.present) {
      map['profile'] = Variable<String>(profile.value);
    }
    if (originLatitude.present) {
      map['origin_latitude'] = Variable<double>(originLatitude.value);
    }
    if (originLongitude.present) {
      map['origin_longitude'] = Variable<double>(originLongitude.value);
    }
    if (destinationLatitude.present) {
      map['destination_latitude'] = Variable<double>(destinationLatitude.value);
    }
    if (destinationLongitude.present) {
      map['destination_longitude'] = Variable<double>(
        destinationLongitude.value,
      );
    }
    if (distanceMeters.present) {
      map['distance_meters'] = Variable<double>(distanceMeters.value);
    }
    if (durationSeconds.present) {
      map['duration_seconds'] = Variable<double>(durationSeconds.value);
    }
    if (geometry.present) {
      map['geometry'] = Variable<String>(geometry.value);
    }
    if (steps.present) {
      map['steps'] = Variable<String>(steps.value);
    }
    if (regionId.present) {
      map['region_id'] = Variable<String>(regionId.value);
    }
    if (provider.present) {
      map['provider'] = Variable<String>(provider.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (updatedAt.present) {
      map['updated_at'] = Variable<DateTime>(updatedAt.value);
    }
    if (accountId.present) {
      map['account_id'] = Variable<String>(accountId.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('OfflineRoutesCompanion(')
          ..write('routeId: $routeId, ')
          ..write('name: $name, ')
          ..write('profile: $profile, ')
          ..write('originLatitude: $originLatitude, ')
          ..write('originLongitude: $originLongitude, ')
          ..write('destinationLatitude: $destinationLatitude, ')
          ..write('destinationLongitude: $destinationLongitude, ')
          ..write('distanceMeters: $distanceMeters, ')
          ..write('durationSeconds: $durationSeconds, ')
          ..write('geometry: $geometry, ')
          ..write('steps: $steps, ')
          ..write('regionId: $regionId, ')
          ..write('provider: $provider, ')
          ..write('createdAt: $createdAt, ')
          ..write('updatedAt: $updatedAt, ')
          ..write('accountId: $accountId, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $SyncQueueTable extends SyncQueue
    with TableInfo<$SyncQueueTable, SyncQueueRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $SyncQueueTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _operationMeta = const VerificationMeta(
    'operation',
  );
  @override
  late final GeneratedColumn<String> operation = GeneratedColumn<String>(
    'operation',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _entityMeta = const VerificationMeta('entity');
  @override
  late final GeneratedColumn<String> entity = GeneratedColumn<String>(
    'entity',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _payloadMeta = const VerificationMeta(
    'payload',
  );
  @override
  late final GeneratedColumn<String> payload = GeneratedColumn<String>(
    'payload',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _createdAtMeta = const VerificationMeta(
    'createdAt',
  );
  @override
  late final GeneratedColumn<DateTime> createdAt = GeneratedColumn<DateTime>(
    'created_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _retryCountMeta = const VerificationMeta(
    'retryCount',
  );
  @override
  late final GeneratedColumn<int> retryCount = GeneratedColumn<int>(
    'retry_count',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  @override
  late final GeneratedColumnWithTypeConverter<SyncStatus, String> status =
      GeneratedColumn<String>(
        'status',
        aliasedName,
        false,
        type: DriftSqlType.string,
        requiredDuringInsert: true,
      ).withConverter<SyncStatus>($SyncQueueTable.$converterstatus);
  static const VerificationMeta _lastErrorMeta = const VerificationMeta(
    'lastError',
  );
  @override
  late final GeneratedColumn<String> lastError = GeneratedColumn<String>(
    'last_error',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _nextAttemptAtMeta = const VerificationMeta(
    'nextAttemptAt',
  );
  @override
  late final GeneratedColumn<DateTime> nextAttemptAt =
      GeneratedColumn<DateTime>(
        'next_attempt_at',
        aliasedName,
        true,
        type: DriftSqlType.dateTime,
        requiredDuringInsert: false,
      );
  static const VerificationMeta _completedAtMeta = const VerificationMeta(
    'completedAt',
  );
  @override
  late final GeneratedColumn<DateTime> completedAt = GeneratedColumn<DateTime>(
    'completed_at',
    aliasedName,
    true,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _accountIdMeta = const VerificationMeta(
    'accountId',
  );
  @override
  late final GeneratedColumn<String> accountId = GeneratedColumn<String>(
    'account_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    operation,
    entity,
    payload,
    createdAt,
    retryCount,
    status,
    lastError,
    nextAttemptAt,
    completedAt,
    accountId,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'sync_queue';
  @override
  VerificationContext validateIntegrity(
    Insertable<SyncQueueRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('operation')) {
      context.handle(
        _operationMeta,
        operation.isAcceptableOrUnknown(data['operation']!, _operationMeta),
      );
    } else if (isInserting) {
      context.missing(_operationMeta);
    }
    if (data.containsKey('entity')) {
      context.handle(
        _entityMeta,
        entity.isAcceptableOrUnknown(data['entity']!, _entityMeta),
      );
    } else if (isInserting) {
      context.missing(_entityMeta);
    }
    if (data.containsKey('payload')) {
      context.handle(
        _payloadMeta,
        payload.isAcceptableOrUnknown(data['payload']!, _payloadMeta),
      );
    } else if (isInserting) {
      context.missing(_payloadMeta);
    }
    if (data.containsKey('created_at')) {
      context.handle(
        _createdAtMeta,
        createdAt.isAcceptableOrUnknown(data['created_at']!, _createdAtMeta),
      );
    } else if (isInserting) {
      context.missing(_createdAtMeta);
    }
    if (data.containsKey('retry_count')) {
      context.handle(
        _retryCountMeta,
        retryCount.isAcceptableOrUnknown(data['retry_count']!, _retryCountMeta),
      );
    }
    if (data.containsKey('last_error')) {
      context.handle(
        _lastErrorMeta,
        lastError.isAcceptableOrUnknown(data['last_error']!, _lastErrorMeta),
      );
    }
    if (data.containsKey('next_attempt_at')) {
      context.handle(
        _nextAttemptAtMeta,
        nextAttemptAt.isAcceptableOrUnknown(
          data['next_attempt_at']!,
          _nextAttemptAtMeta,
        ),
      );
    }
    if (data.containsKey('completed_at')) {
      context.handle(
        _completedAtMeta,
        completedAt.isAcceptableOrUnknown(
          data['completed_at']!,
          _completedAtMeta,
        ),
      );
    }
    if (data.containsKey('account_id')) {
      context.handle(
        _accountIdMeta,
        accountId.isAcceptableOrUnknown(data['account_id']!, _accountIdMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  SyncQueueRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return SyncQueueRow(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      operation: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}operation'],
      )!,
      entity: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}entity'],
      )!,
      payload: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}payload'],
      )!,
      createdAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}created_at'],
      )!,
      retryCount: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}retry_count'],
      )!,
      status: $SyncQueueTable.$converterstatus.fromSql(
        attachedDatabase.typeMapping.read(
          DriftSqlType.string,
          data['${effectivePrefix}status'],
        )!,
      ),
      lastError: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}last_error'],
      ),
      nextAttemptAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}next_attempt_at'],
      ),
      completedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}completed_at'],
      ),
      accountId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}account_id'],
      ),
    );
  }

  @override
  $SyncQueueTable createAlias(String alias) {
    return $SyncQueueTable(attachedDatabase, alias);
  }

  static TypeConverter<SyncStatus, String> $converterstatus =
      const SyncStatusConverter();
}

class SyncQueueRow extends DataClass implements Insertable<SyncQueueRow> {
  /// Client generated id, used by the server as idempotency key.
  final String id;
  final String operation;
  final String entity;

  /// JSON object.
  final String payload;
  final DateTime createdAt;
  final int retryCount;
  final SyncStatus status;
  final String? lastError;

  /// Earliest time of the next attempt (exponential backoff).
  final DateTime? nextAttemptAt;
  final DateTime? completedAt;

  /// Account whose session sends the operation; null for a change made
  /// without an account.
  final String? accountId;
  const SyncQueueRow({
    required this.id,
    required this.operation,
    required this.entity,
    required this.payload,
    required this.createdAt,
    required this.retryCount,
    required this.status,
    this.lastError,
    this.nextAttemptAt,
    this.completedAt,
    this.accountId,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    map['operation'] = Variable<String>(operation);
    map['entity'] = Variable<String>(entity);
    map['payload'] = Variable<String>(payload);
    map['created_at'] = Variable<DateTime>(createdAt);
    map['retry_count'] = Variable<int>(retryCount);
    {
      map['status'] = Variable<String>(
        $SyncQueueTable.$converterstatus.toSql(status),
      );
    }
    if (!nullToAbsent || lastError != null) {
      map['last_error'] = Variable<String>(lastError);
    }
    if (!nullToAbsent || nextAttemptAt != null) {
      map['next_attempt_at'] = Variable<DateTime>(nextAttemptAt);
    }
    if (!nullToAbsent || completedAt != null) {
      map['completed_at'] = Variable<DateTime>(completedAt);
    }
    if (!nullToAbsent || accountId != null) {
      map['account_id'] = Variable<String>(accountId);
    }
    return map;
  }

  SyncQueueCompanion toCompanion(bool nullToAbsent) {
    return SyncQueueCompanion(
      id: Value(id),
      operation: Value(operation),
      entity: Value(entity),
      payload: Value(payload),
      createdAt: Value(createdAt),
      retryCount: Value(retryCount),
      status: Value(status),
      lastError: lastError == null && nullToAbsent
          ? const Value.absent()
          : Value(lastError),
      nextAttemptAt: nextAttemptAt == null && nullToAbsent
          ? const Value.absent()
          : Value(nextAttemptAt),
      completedAt: completedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(completedAt),
      accountId: accountId == null && nullToAbsent
          ? const Value.absent()
          : Value(accountId),
    );
  }

  factory SyncQueueRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return SyncQueueRow(
      id: serializer.fromJson<String>(json['id']),
      operation: serializer.fromJson<String>(json['operation']),
      entity: serializer.fromJson<String>(json['entity']),
      payload: serializer.fromJson<String>(json['payload']),
      createdAt: serializer.fromJson<DateTime>(json['createdAt']),
      retryCount: serializer.fromJson<int>(json['retryCount']),
      status: serializer.fromJson<SyncStatus>(json['status']),
      lastError: serializer.fromJson<String?>(json['lastError']),
      nextAttemptAt: serializer.fromJson<DateTime?>(json['nextAttemptAt']),
      completedAt: serializer.fromJson<DateTime?>(json['completedAt']),
      accountId: serializer.fromJson<String?>(json['accountId']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'operation': serializer.toJson<String>(operation),
      'entity': serializer.toJson<String>(entity),
      'payload': serializer.toJson<String>(payload),
      'createdAt': serializer.toJson<DateTime>(createdAt),
      'retryCount': serializer.toJson<int>(retryCount),
      'status': serializer.toJson<SyncStatus>(status),
      'lastError': serializer.toJson<String?>(lastError),
      'nextAttemptAt': serializer.toJson<DateTime?>(nextAttemptAt),
      'completedAt': serializer.toJson<DateTime?>(completedAt),
      'accountId': serializer.toJson<String?>(accountId),
    };
  }

  SyncQueueRow copyWith({
    String? id,
    String? operation,
    String? entity,
    String? payload,
    DateTime? createdAt,
    int? retryCount,
    SyncStatus? status,
    Value<String?> lastError = const Value.absent(),
    Value<DateTime?> nextAttemptAt = const Value.absent(),
    Value<DateTime?> completedAt = const Value.absent(),
    Value<String?> accountId = const Value.absent(),
  }) => SyncQueueRow(
    id: id ?? this.id,
    operation: operation ?? this.operation,
    entity: entity ?? this.entity,
    payload: payload ?? this.payload,
    createdAt: createdAt ?? this.createdAt,
    retryCount: retryCount ?? this.retryCount,
    status: status ?? this.status,
    lastError: lastError.present ? lastError.value : this.lastError,
    nextAttemptAt: nextAttemptAt.present
        ? nextAttemptAt.value
        : this.nextAttemptAt,
    completedAt: completedAt.present ? completedAt.value : this.completedAt,
    accountId: accountId.present ? accountId.value : this.accountId,
  );
  SyncQueueRow copyWithCompanion(SyncQueueCompanion data) {
    return SyncQueueRow(
      id: data.id.present ? data.id.value : this.id,
      operation: data.operation.present ? data.operation.value : this.operation,
      entity: data.entity.present ? data.entity.value : this.entity,
      payload: data.payload.present ? data.payload.value : this.payload,
      createdAt: data.createdAt.present ? data.createdAt.value : this.createdAt,
      retryCount: data.retryCount.present
          ? data.retryCount.value
          : this.retryCount,
      status: data.status.present ? data.status.value : this.status,
      lastError: data.lastError.present ? data.lastError.value : this.lastError,
      nextAttemptAt: data.nextAttemptAt.present
          ? data.nextAttemptAt.value
          : this.nextAttemptAt,
      completedAt: data.completedAt.present
          ? data.completedAt.value
          : this.completedAt,
      accountId: data.accountId.present ? data.accountId.value : this.accountId,
    );
  }

  @override
  String toString() {
    return (StringBuffer('SyncQueueRow(')
          ..write('id: $id, ')
          ..write('operation: $operation, ')
          ..write('entity: $entity, ')
          ..write('payload: $payload, ')
          ..write('createdAt: $createdAt, ')
          ..write('retryCount: $retryCount, ')
          ..write('status: $status, ')
          ..write('lastError: $lastError, ')
          ..write('nextAttemptAt: $nextAttemptAt, ')
          ..write('completedAt: $completedAt, ')
          ..write('accountId: $accountId')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    operation,
    entity,
    payload,
    createdAt,
    retryCount,
    status,
    lastError,
    nextAttemptAt,
    completedAt,
    accountId,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is SyncQueueRow &&
          other.id == this.id &&
          other.operation == this.operation &&
          other.entity == this.entity &&
          other.payload == this.payload &&
          other.createdAt == this.createdAt &&
          other.retryCount == this.retryCount &&
          other.status == this.status &&
          other.lastError == this.lastError &&
          other.nextAttemptAt == this.nextAttemptAt &&
          other.completedAt == this.completedAt &&
          other.accountId == this.accountId);
}

class SyncQueueCompanion extends UpdateCompanion<SyncQueueRow> {
  final Value<String> id;
  final Value<String> operation;
  final Value<String> entity;
  final Value<String> payload;
  final Value<DateTime> createdAt;
  final Value<int> retryCount;
  final Value<SyncStatus> status;
  final Value<String?> lastError;
  final Value<DateTime?> nextAttemptAt;
  final Value<DateTime?> completedAt;
  final Value<String?> accountId;
  final Value<int> rowid;
  const SyncQueueCompanion({
    this.id = const Value.absent(),
    this.operation = const Value.absent(),
    this.entity = const Value.absent(),
    this.payload = const Value.absent(),
    this.createdAt = const Value.absent(),
    this.retryCount = const Value.absent(),
    this.status = const Value.absent(),
    this.lastError = const Value.absent(),
    this.nextAttemptAt = const Value.absent(),
    this.completedAt = const Value.absent(),
    this.accountId = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  SyncQueueCompanion.insert({
    required String id,
    required String operation,
    required String entity,
    required String payload,
    required DateTime createdAt,
    this.retryCount = const Value.absent(),
    required SyncStatus status,
    this.lastError = const Value.absent(),
    this.nextAttemptAt = const Value.absent(),
    this.completedAt = const Value.absent(),
    this.accountId = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       operation = Value(operation),
       entity = Value(entity),
       payload = Value(payload),
       createdAt = Value(createdAt),
       status = Value(status);
  static Insertable<SyncQueueRow> custom({
    Expression<String>? id,
    Expression<String>? operation,
    Expression<String>? entity,
    Expression<String>? payload,
    Expression<DateTime>? createdAt,
    Expression<int>? retryCount,
    Expression<String>? status,
    Expression<String>? lastError,
    Expression<DateTime>? nextAttemptAt,
    Expression<DateTime>? completedAt,
    Expression<String>? accountId,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (operation != null) 'operation': operation,
      if (entity != null) 'entity': entity,
      if (payload != null) 'payload': payload,
      if (createdAt != null) 'created_at': createdAt,
      if (retryCount != null) 'retry_count': retryCount,
      if (status != null) 'status': status,
      if (lastError != null) 'last_error': lastError,
      if (nextAttemptAt != null) 'next_attempt_at': nextAttemptAt,
      if (completedAt != null) 'completed_at': completedAt,
      if (accountId != null) 'account_id': accountId,
      if (rowid != null) 'rowid': rowid,
    });
  }

  SyncQueueCompanion copyWith({
    Value<String>? id,
    Value<String>? operation,
    Value<String>? entity,
    Value<String>? payload,
    Value<DateTime>? createdAt,
    Value<int>? retryCount,
    Value<SyncStatus>? status,
    Value<String?>? lastError,
    Value<DateTime?>? nextAttemptAt,
    Value<DateTime?>? completedAt,
    Value<String?>? accountId,
    Value<int>? rowid,
  }) {
    return SyncQueueCompanion(
      id: id ?? this.id,
      operation: operation ?? this.operation,
      entity: entity ?? this.entity,
      payload: payload ?? this.payload,
      createdAt: createdAt ?? this.createdAt,
      retryCount: retryCount ?? this.retryCount,
      status: status ?? this.status,
      lastError: lastError ?? this.lastError,
      nextAttemptAt: nextAttemptAt ?? this.nextAttemptAt,
      completedAt: completedAt ?? this.completedAt,
      accountId: accountId ?? this.accountId,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (operation.present) {
      map['operation'] = Variable<String>(operation.value);
    }
    if (entity.present) {
      map['entity'] = Variable<String>(entity.value);
    }
    if (payload.present) {
      map['payload'] = Variable<String>(payload.value);
    }
    if (createdAt.present) {
      map['created_at'] = Variable<DateTime>(createdAt.value);
    }
    if (retryCount.present) {
      map['retry_count'] = Variable<int>(retryCount.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(
        $SyncQueueTable.$converterstatus.toSql(status.value),
      );
    }
    if (lastError.present) {
      map['last_error'] = Variable<String>(lastError.value);
    }
    if (nextAttemptAt.present) {
      map['next_attempt_at'] = Variable<DateTime>(nextAttemptAt.value);
    }
    if (completedAt.present) {
      map['completed_at'] = Variable<DateTime>(completedAt.value);
    }
    if (accountId.present) {
      map['account_id'] = Variable<String>(accountId.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('SyncQueueCompanion(')
          ..write('id: $id, ')
          ..write('operation: $operation, ')
          ..write('entity: $entity, ')
          ..write('payload: $payload, ')
          ..write('createdAt: $createdAt, ')
          ..write('retryCount: $retryCount, ')
          ..write('status: $status, ')
          ..write('lastError: $lastError, ')
          ..write('nextAttemptAt: $nextAttemptAt, ')
          ..write('completedAt: $completedAt, ')
          ..write('accountId: $accountId, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $TripsTable extends Trips with TableInfo<$TripsTable, TripRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $TripsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<String> id = GeneratedColumn<String>(
    'id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _nameMeta = const VerificationMeta('name');
  @override
  late final GeneratedColumn<String> name = GeneratedColumn<String>(
    'name',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _profileMeta = const VerificationMeta(
    'profile',
  );
  @override
  late final GeneratedColumn<String> profile = GeneratedColumn<String>(
    'profile',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _routeIdMeta = const VerificationMeta(
    'routeId',
  );
  @override
  late final GeneratedColumn<String> routeId = GeneratedColumn<String>(
    'route_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _statusMeta = const VerificationMeta('status');
  @override
  late final GeneratedColumn<String> status = GeneratedColumn<String>(
    'status',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _startedAtMeta = const VerificationMeta(
    'startedAt',
  );
  @override
  late final GeneratedColumn<DateTime> startedAt = GeneratedColumn<DateTime>(
    'started_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _endedAtMeta = const VerificationMeta(
    'endedAt',
  );
  @override
  late final GeneratedColumn<DateTime> endedAt = GeneratedColumn<DateTime>(
    'ended_at',
    aliasedName,
    true,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _distanceMetersMeta = const VerificationMeta(
    'distanceMeters',
  );
  @override
  late final GeneratedColumn<double> distanceMeters = GeneratedColumn<double>(
    'distance_meters',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _pointCountMeta = const VerificationMeta(
    'pointCount',
  );
  @override
  late final GeneratedColumn<int> pointCount = GeneratedColumn<int>(
    'point_count',
    aliasedName,
    false,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultValue: const Constant(0),
  );
  static const VerificationMeta _accountIdMeta = const VerificationMeta(
    'accountId',
  );
  @override
  late final GeneratedColumn<String> accountId = GeneratedColumn<String>(
    'account_id',
    aliasedName,
    true,
    type: DriftSqlType.string,
    requiredDuringInsert: false,
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    name,
    profile,
    routeId,
    status,
    startedAt,
    endedAt,
    distanceMeters,
    pointCount,
    accountId,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'trips';
  @override
  VerificationContext validateIntegrity(
    Insertable<TripRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    } else if (isInserting) {
      context.missing(_idMeta);
    }
    if (data.containsKey('name')) {
      context.handle(
        _nameMeta,
        name.isAcceptableOrUnknown(data['name']!, _nameMeta),
      );
    }
    if (data.containsKey('profile')) {
      context.handle(
        _profileMeta,
        profile.isAcceptableOrUnknown(data['profile']!, _profileMeta),
      );
    } else if (isInserting) {
      context.missing(_profileMeta);
    }
    if (data.containsKey('route_id')) {
      context.handle(
        _routeIdMeta,
        routeId.isAcceptableOrUnknown(data['route_id']!, _routeIdMeta),
      );
    }
    if (data.containsKey('status')) {
      context.handle(
        _statusMeta,
        status.isAcceptableOrUnknown(data['status']!, _statusMeta),
      );
    } else if (isInserting) {
      context.missing(_statusMeta);
    }
    if (data.containsKey('started_at')) {
      context.handle(
        _startedAtMeta,
        startedAt.isAcceptableOrUnknown(data['started_at']!, _startedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_startedAtMeta);
    }
    if (data.containsKey('ended_at')) {
      context.handle(
        _endedAtMeta,
        endedAt.isAcceptableOrUnknown(data['ended_at']!, _endedAtMeta),
      );
    }
    if (data.containsKey('distance_meters')) {
      context.handle(
        _distanceMetersMeta,
        distanceMeters.isAcceptableOrUnknown(
          data['distance_meters']!,
          _distanceMetersMeta,
        ),
      );
    }
    if (data.containsKey('point_count')) {
      context.handle(
        _pointCountMeta,
        pointCount.isAcceptableOrUnknown(data['point_count']!, _pointCountMeta),
      );
    }
    if (data.containsKey('account_id')) {
      context.handle(
        _accountIdMeta,
        accountId.isAcceptableOrUnknown(data['account_id']!, _accountIdMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  TripRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return TripRow(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}id'],
      )!,
      name: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}name'],
      ),
      profile: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}profile'],
      )!,
      routeId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}route_id'],
      ),
      status: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}status'],
      )!,
      startedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}started_at'],
      )!,
      endedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}ended_at'],
      ),
      distanceMeters: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}distance_meters'],
      )!,
      pointCount: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}point_count'],
      )!,
      accountId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}account_id'],
      ),
    );
  }

  @override
  $TripsTable createAlias(String alias) {
    return $TripsTable(attachedDatabase, alias);
  }
}

class TripRow extends DataClass implements Insertable<TripRow> {
  final String id;
  final String? name;
  final String profile;
  final String? routeId;

  /// ACTIVE, COMPLETED or CANCELLED.
  final String status;
  final DateTime startedAt;
  final DateTime? endedAt;
  final double distanceMeters;
  final int pointCount;

  /// Owner account (user id); null for a trip recorded without an account.
  final String? accountId;
  const TripRow({
    required this.id,
    this.name,
    required this.profile,
    this.routeId,
    required this.status,
    required this.startedAt,
    this.endedAt,
    required this.distanceMeters,
    required this.pointCount,
    this.accountId,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<String>(id);
    if (!nullToAbsent || name != null) {
      map['name'] = Variable<String>(name);
    }
    map['profile'] = Variable<String>(profile);
    if (!nullToAbsent || routeId != null) {
      map['route_id'] = Variable<String>(routeId);
    }
    map['status'] = Variable<String>(status);
    map['started_at'] = Variable<DateTime>(startedAt);
    if (!nullToAbsent || endedAt != null) {
      map['ended_at'] = Variable<DateTime>(endedAt);
    }
    map['distance_meters'] = Variable<double>(distanceMeters);
    map['point_count'] = Variable<int>(pointCount);
    if (!nullToAbsent || accountId != null) {
      map['account_id'] = Variable<String>(accountId);
    }
    return map;
  }

  TripsCompanion toCompanion(bool nullToAbsent) {
    return TripsCompanion(
      id: Value(id),
      name: name == null && nullToAbsent ? const Value.absent() : Value(name),
      profile: Value(profile),
      routeId: routeId == null && nullToAbsent
          ? const Value.absent()
          : Value(routeId),
      status: Value(status),
      startedAt: Value(startedAt),
      endedAt: endedAt == null && nullToAbsent
          ? const Value.absent()
          : Value(endedAt),
      distanceMeters: Value(distanceMeters),
      pointCount: Value(pointCount),
      accountId: accountId == null && nullToAbsent
          ? const Value.absent()
          : Value(accountId),
    );
  }

  factory TripRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return TripRow(
      id: serializer.fromJson<String>(json['id']),
      name: serializer.fromJson<String?>(json['name']),
      profile: serializer.fromJson<String>(json['profile']),
      routeId: serializer.fromJson<String?>(json['routeId']),
      status: serializer.fromJson<String>(json['status']),
      startedAt: serializer.fromJson<DateTime>(json['startedAt']),
      endedAt: serializer.fromJson<DateTime?>(json['endedAt']),
      distanceMeters: serializer.fromJson<double>(json['distanceMeters']),
      pointCount: serializer.fromJson<int>(json['pointCount']),
      accountId: serializer.fromJson<String?>(json['accountId']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<String>(id),
      'name': serializer.toJson<String?>(name),
      'profile': serializer.toJson<String>(profile),
      'routeId': serializer.toJson<String?>(routeId),
      'status': serializer.toJson<String>(status),
      'startedAt': serializer.toJson<DateTime>(startedAt),
      'endedAt': serializer.toJson<DateTime?>(endedAt),
      'distanceMeters': serializer.toJson<double>(distanceMeters),
      'pointCount': serializer.toJson<int>(pointCount),
      'accountId': serializer.toJson<String?>(accountId),
    };
  }

  TripRow copyWith({
    String? id,
    Value<String?> name = const Value.absent(),
    String? profile,
    Value<String?> routeId = const Value.absent(),
    String? status,
    DateTime? startedAt,
    Value<DateTime?> endedAt = const Value.absent(),
    double? distanceMeters,
    int? pointCount,
    Value<String?> accountId = const Value.absent(),
  }) => TripRow(
    id: id ?? this.id,
    name: name.present ? name.value : this.name,
    profile: profile ?? this.profile,
    routeId: routeId.present ? routeId.value : this.routeId,
    status: status ?? this.status,
    startedAt: startedAt ?? this.startedAt,
    endedAt: endedAt.present ? endedAt.value : this.endedAt,
    distanceMeters: distanceMeters ?? this.distanceMeters,
    pointCount: pointCount ?? this.pointCount,
    accountId: accountId.present ? accountId.value : this.accountId,
  );
  TripRow copyWithCompanion(TripsCompanion data) {
    return TripRow(
      id: data.id.present ? data.id.value : this.id,
      name: data.name.present ? data.name.value : this.name,
      profile: data.profile.present ? data.profile.value : this.profile,
      routeId: data.routeId.present ? data.routeId.value : this.routeId,
      status: data.status.present ? data.status.value : this.status,
      startedAt: data.startedAt.present ? data.startedAt.value : this.startedAt,
      endedAt: data.endedAt.present ? data.endedAt.value : this.endedAt,
      distanceMeters: data.distanceMeters.present
          ? data.distanceMeters.value
          : this.distanceMeters,
      pointCount: data.pointCount.present
          ? data.pointCount.value
          : this.pointCount,
      accountId: data.accountId.present ? data.accountId.value : this.accountId,
    );
  }

  @override
  String toString() {
    return (StringBuffer('TripRow(')
          ..write('id: $id, ')
          ..write('name: $name, ')
          ..write('profile: $profile, ')
          ..write('routeId: $routeId, ')
          ..write('status: $status, ')
          ..write('startedAt: $startedAt, ')
          ..write('endedAt: $endedAt, ')
          ..write('distanceMeters: $distanceMeters, ')
          ..write('pointCount: $pointCount, ')
          ..write('accountId: $accountId')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    name,
    profile,
    routeId,
    status,
    startedAt,
    endedAt,
    distanceMeters,
    pointCount,
    accountId,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is TripRow &&
          other.id == this.id &&
          other.name == this.name &&
          other.profile == this.profile &&
          other.routeId == this.routeId &&
          other.status == this.status &&
          other.startedAt == this.startedAt &&
          other.endedAt == this.endedAt &&
          other.distanceMeters == this.distanceMeters &&
          other.pointCount == this.pointCount &&
          other.accountId == this.accountId);
}

class TripsCompanion extends UpdateCompanion<TripRow> {
  final Value<String> id;
  final Value<String?> name;
  final Value<String> profile;
  final Value<String?> routeId;
  final Value<String> status;
  final Value<DateTime> startedAt;
  final Value<DateTime?> endedAt;
  final Value<double> distanceMeters;
  final Value<int> pointCount;
  final Value<String?> accountId;
  final Value<int> rowid;
  const TripsCompanion({
    this.id = const Value.absent(),
    this.name = const Value.absent(),
    this.profile = const Value.absent(),
    this.routeId = const Value.absent(),
    this.status = const Value.absent(),
    this.startedAt = const Value.absent(),
    this.endedAt = const Value.absent(),
    this.distanceMeters = const Value.absent(),
    this.pointCount = const Value.absent(),
    this.accountId = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  TripsCompanion.insert({
    required String id,
    this.name = const Value.absent(),
    required String profile,
    this.routeId = const Value.absent(),
    required String status,
    required DateTime startedAt,
    this.endedAt = const Value.absent(),
    this.distanceMeters = const Value.absent(),
    this.pointCount = const Value.absent(),
    this.accountId = const Value.absent(),
    this.rowid = const Value.absent(),
  }) : id = Value(id),
       profile = Value(profile),
       status = Value(status),
       startedAt = Value(startedAt);
  static Insertable<TripRow> custom({
    Expression<String>? id,
    Expression<String>? name,
    Expression<String>? profile,
    Expression<String>? routeId,
    Expression<String>? status,
    Expression<DateTime>? startedAt,
    Expression<DateTime>? endedAt,
    Expression<double>? distanceMeters,
    Expression<int>? pointCount,
    Expression<String>? accountId,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (name != null) 'name': name,
      if (profile != null) 'profile': profile,
      if (routeId != null) 'route_id': routeId,
      if (status != null) 'status': status,
      if (startedAt != null) 'started_at': startedAt,
      if (endedAt != null) 'ended_at': endedAt,
      if (distanceMeters != null) 'distance_meters': distanceMeters,
      if (pointCount != null) 'point_count': pointCount,
      if (accountId != null) 'account_id': accountId,
      if (rowid != null) 'rowid': rowid,
    });
  }

  TripsCompanion copyWith({
    Value<String>? id,
    Value<String?>? name,
    Value<String>? profile,
    Value<String?>? routeId,
    Value<String>? status,
    Value<DateTime>? startedAt,
    Value<DateTime?>? endedAt,
    Value<double>? distanceMeters,
    Value<int>? pointCount,
    Value<String?>? accountId,
    Value<int>? rowid,
  }) {
    return TripsCompanion(
      id: id ?? this.id,
      name: name ?? this.name,
      profile: profile ?? this.profile,
      routeId: routeId ?? this.routeId,
      status: status ?? this.status,
      startedAt: startedAt ?? this.startedAt,
      endedAt: endedAt ?? this.endedAt,
      distanceMeters: distanceMeters ?? this.distanceMeters,
      pointCount: pointCount ?? this.pointCount,
      accountId: accountId ?? this.accountId,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<String>(id.value);
    }
    if (name.present) {
      map['name'] = Variable<String>(name.value);
    }
    if (profile.present) {
      map['profile'] = Variable<String>(profile.value);
    }
    if (routeId.present) {
      map['route_id'] = Variable<String>(routeId.value);
    }
    if (status.present) {
      map['status'] = Variable<String>(status.value);
    }
    if (startedAt.present) {
      map['started_at'] = Variable<DateTime>(startedAt.value);
    }
    if (endedAt.present) {
      map['ended_at'] = Variable<DateTime>(endedAt.value);
    }
    if (distanceMeters.present) {
      map['distance_meters'] = Variable<double>(distanceMeters.value);
    }
    if (pointCount.present) {
      map['point_count'] = Variable<int>(pointCount.value);
    }
    if (accountId.present) {
      map['account_id'] = Variable<String>(accountId.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('TripsCompanion(')
          ..write('id: $id, ')
          ..write('name: $name, ')
          ..write('profile: $profile, ')
          ..write('routeId: $routeId, ')
          ..write('status: $status, ')
          ..write('startedAt: $startedAt, ')
          ..write('endedAt: $endedAt, ')
          ..write('distanceMeters: $distanceMeters, ')
          ..write('pointCount: $pointCount, ')
          ..write('accountId: $accountId, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

class $TrackingPointsTable extends TrackingPoints
    with TableInfo<$TrackingPointsTable, TrackingPointRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $TrackingPointsTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _idMeta = const VerificationMeta('id');
  @override
  late final GeneratedColumn<int> id = GeneratedColumn<int>(
    'id',
    aliasedName,
    false,
    hasAutoIncrement: true,
    type: DriftSqlType.int,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'PRIMARY KEY AUTOINCREMENT',
    ),
  );
  static const VerificationMeta _tripIdMeta = const VerificationMeta('tripId');
  @override
  late final GeneratedColumn<String> tripId = GeneratedColumn<String>(
    'trip_id',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'REFERENCES trips (id) ON DELETE CASCADE',
    ),
  );
  static const VerificationMeta _latitudeMeta = const VerificationMeta(
    'latitude',
  );
  @override
  late final GeneratedColumn<double> latitude = GeneratedColumn<double>(
    'latitude',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _longitudeMeta = const VerificationMeta(
    'longitude',
  );
  @override
  late final GeneratedColumn<double> longitude = GeneratedColumn<double>(
    'longitude',
    aliasedName,
    false,
    type: DriftSqlType.double,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _accuracyMeta = const VerificationMeta(
    'accuracy',
  );
  @override
  late final GeneratedColumn<double> accuracy = GeneratedColumn<double>(
    'accuracy',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _speedMeta = const VerificationMeta('speed');
  @override
  late final GeneratedColumn<double> speed = GeneratedColumn<double>(
    'speed',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _headingMeta = const VerificationMeta(
    'heading',
  );
  @override
  late final GeneratedColumn<double> heading = GeneratedColumn<double>(
    'heading',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _altitudeMeta = const VerificationMeta(
    'altitude',
  );
  @override
  late final GeneratedColumn<double> altitude = GeneratedColumn<double>(
    'altitude',
    aliasedName,
    true,
    type: DriftSqlType.double,
    requiredDuringInsert: false,
  );
  static const VerificationMeta _recordedAtMeta = const VerificationMeta(
    'recordedAt',
  );
  @override
  late final GeneratedColumn<DateTime> recordedAt = GeneratedColumn<DateTime>(
    'recorded_at',
    aliasedName,
    false,
    type: DriftSqlType.dateTime,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _queuedMeta = const VerificationMeta('queued');
  @override
  late final GeneratedColumn<bool> queued = GeneratedColumn<bool>(
    'queued',
    aliasedName,
    false,
    type: DriftSqlType.bool,
    requiredDuringInsert: false,
    defaultConstraints: GeneratedColumn.constraintIsAlways(
      'CHECK ("queued" IN (0, 1))',
    ),
    defaultValue: const Constant(false),
  );
  @override
  List<GeneratedColumn> get $columns => [
    id,
    tripId,
    latitude,
    longitude,
    accuracy,
    speed,
    heading,
    altitude,
    recordedAt,
    queued,
  ];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'tracking_points';
  @override
  VerificationContext validateIntegrity(
    Insertable<TrackingPointRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('id')) {
      context.handle(_idMeta, id.isAcceptableOrUnknown(data['id']!, _idMeta));
    }
    if (data.containsKey('trip_id')) {
      context.handle(
        _tripIdMeta,
        tripId.isAcceptableOrUnknown(data['trip_id']!, _tripIdMeta),
      );
    } else if (isInserting) {
      context.missing(_tripIdMeta);
    }
    if (data.containsKey('latitude')) {
      context.handle(
        _latitudeMeta,
        latitude.isAcceptableOrUnknown(data['latitude']!, _latitudeMeta),
      );
    } else if (isInserting) {
      context.missing(_latitudeMeta);
    }
    if (data.containsKey('longitude')) {
      context.handle(
        _longitudeMeta,
        longitude.isAcceptableOrUnknown(data['longitude']!, _longitudeMeta),
      );
    } else if (isInserting) {
      context.missing(_longitudeMeta);
    }
    if (data.containsKey('accuracy')) {
      context.handle(
        _accuracyMeta,
        accuracy.isAcceptableOrUnknown(data['accuracy']!, _accuracyMeta),
      );
    }
    if (data.containsKey('speed')) {
      context.handle(
        _speedMeta,
        speed.isAcceptableOrUnknown(data['speed']!, _speedMeta),
      );
    }
    if (data.containsKey('heading')) {
      context.handle(
        _headingMeta,
        heading.isAcceptableOrUnknown(data['heading']!, _headingMeta),
      );
    }
    if (data.containsKey('altitude')) {
      context.handle(
        _altitudeMeta,
        altitude.isAcceptableOrUnknown(data['altitude']!, _altitudeMeta),
      );
    }
    if (data.containsKey('recorded_at')) {
      context.handle(
        _recordedAtMeta,
        recordedAt.isAcceptableOrUnknown(data['recorded_at']!, _recordedAtMeta),
      );
    } else if (isInserting) {
      context.missing(_recordedAtMeta);
    }
    if (data.containsKey('queued')) {
      context.handle(
        _queuedMeta,
        queued.isAcceptableOrUnknown(data['queued']!, _queuedMeta),
      );
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {id};
  @override
  List<Set<GeneratedColumn>> get uniqueKeys => [
    {tripId, recordedAt},
  ];
  @override
  TrackingPointRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return TrackingPointRow(
      id: attachedDatabase.typeMapping.read(
        DriftSqlType.int,
        data['${effectivePrefix}id'],
      )!,
      tripId: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}trip_id'],
      )!,
      latitude: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}latitude'],
      )!,
      longitude: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}longitude'],
      )!,
      accuracy: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}accuracy'],
      ),
      speed: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}speed'],
      ),
      heading: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}heading'],
      ),
      altitude: attachedDatabase.typeMapping.read(
        DriftSqlType.double,
        data['${effectivePrefix}altitude'],
      ),
      recordedAt: attachedDatabase.typeMapping.read(
        DriftSqlType.dateTime,
        data['${effectivePrefix}recorded_at'],
      )!,
      queued: attachedDatabase.typeMapping.read(
        DriftSqlType.bool,
        data['${effectivePrefix}queued'],
      )!,
    );
  }

  @override
  $TrackingPointsTable createAlias(String alias) {
    return $TrackingPointsTable(attachedDatabase, alias);
  }
}

class TrackingPointRow extends DataClass
    implements Insertable<TrackingPointRow> {
  final int id;
  final String tripId;
  final double latitude;
  final double longitude;
  final double? accuracy;
  final double? speed;
  final double? heading;
  final double? altitude;
  final DateTime recordedAt;
  final bool queued;
  const TrackingPointRow({
    required this.id,
    required this.tripId,
    required this.latitude,
    required this.longitude,
    this.accuracy,
    this.speed,
    this.heading,
    this.altitude,
    required this.recordedAt,
    required this.queued,
  });
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['id'] = Variable<int>(id);
    map['trip_id'] = Variable<String>(tripId);
    map['latitude'] = Variable<double>(latitude);
    map['longitude'] = Variable<double>(longitude);
    if (!nullToAbsent || accuracy != null) {
      map['accuracy'] = Variable<double>(accuracy);
    }
    if (!nullToAbsent || speed != null) {
      map['speed'] = Variable<double>(speed);
    }
    if (!nullToAbsent || heading != null) {
      map['heading'] = Variable<double>(heading);
    }
    if (!nullToAbsent || altitude != null) {
      map['altitude'] = Variable<double>(altitude);
    }
    map['recorded_at'] = Variable<DateTime>(recordedAt);
    map['queued'] = Variable<bool>(queued);
    return map;
  }

  TrackingPointsCompanion toCompanion(bool nullToAbsent) {
    return TrackingPointsCompanion(
      id: Value(id),
      tripId: Value(tripId),
      latitude: Value(latitude),
      longitude: Value(longitude),
      accuracy: accuracy == null && nullToAbsent
          ? const Value.absent()
          : Value(accuracy),
      speed: speed == null && nullToAbsent
          ? const Value.absent()
          : Value(speed),
      heading: heading == null && nullToAbsent
          ? const Value.absent()
          : Value(heading),
      altitude: altitude == null && nullToAbsent
          ? const Value.absent()
          : Value(altitude),
      recordedAt: Value(recordedAt),
      queued: Value(queued),
    );
  }

  factory TrackingPointRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return TrackingPointRow(
      id: serializer.fromJson<int>(json['id']),
      tripId: serializer.fromJson<String>(json['tripId']),
      latitude: serializer.fromJson<double>(json['latitude']),
      longitude: serializer.fromJson<double>(json['longitude']),
      accuracy: serializer.fromJson<double?>(json['accuracy']),
      speed: serializer.fromJson<double?>(json['speed']),
      heading: serializer.fromJson<double?>(json['heading']),
      altitude: serializer.fromJson<double?>(json['altitude']),
      recordedAt: serializer.fromJson<DateTime>(json['recordedAt']),
      queued: serializer.fromJson<bool>(json['queued']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'id': serializer.toJson<int>(id),
      'tripId': serializer.toJson<String>(tripId),
      'latitude': serializer.toJson<double>(latitude),
      'longitude': serializer.toJson<double>(longitude),
      'accuracy': serializer.toJson<double?>(accuracy),
      'speed': serializer.toJson<double?>(speed),
      'heading': serializer.toJson<double?>(heading),
      'altitude': serializer.toJson<double?>(altitude),
      'recordedAt': serializer.toJson<DateTime>(recordedAt),
      'queued': serializer.toJson<bool>(queued),
    };
  }

  TrackingPointRow copyWith({
    int? id,
    String? tripId,
    double? latitude,
    double? longitude,
    Value<double?> accuracy = const Value.absent(),
    Value<double?> speed = const Value.absent(),
    Value<double?> heading = const Value.absent(),
    Value<double?> altitude = const Value.absent(),
    DateTime? recordedAt,
    bool? queued,
  }) => TrackingPointRow(
    id: id ?? this.id,
    tripId: tripId ?? this.tripId,
    latitude: latitude ?? this.latitude,
    longitude: longitude ?? this.longitude,
    accuracy: accuracy.present ? accuracy.value : this.accuracy,
    speed: speed.present ? speed.value : this.speed,
    heading: heading.present ? heading.value : this.heading,
    altitude: altitude.present ? altitude.value : this.altitude,
    recordedAt: recordedAt ?? this.recordedAt,
    queued: queued ?? this.queued,
  );
  TrackingPointRow copyWithCompanion(TrackingPointsCompanion data) {
    return TrackingPointRow(
      id: data.id.present ? data.id.value : this.id,
      tripId: data.tripId.present ? data.tripId.value : this.tripId,
      latitude: data.latitude.present ? data.latitude.value : this.latitude,
      longitude: data.longitude.present ? data.longitude.value : this.longitude,
      accuracy: data.accuracy.present ? data.accuracy.value : this.accuracy,
      speed: data.speed.present ? data.speed.value : this.speed,
      heading: data.heading.present ? data.heading.value : this.heading,
      altitude: data.altitude.present ? data.altitude.value : this.altitude,
      recordedAt: data.recordedAt.present
          ? data.recordedAt.value
          : this.recordedAt,
      queued: data.queued.present ? data.queued.value : this.queued,
    );
  }

  @override
  String toString() {
    return (StringBuffer('TrackingPointRow(')
          ..write('id: $id, ')
          ..write('tripId: $tripId, ')
          ..write('latitude: $latitude, ')
          ..write('longitude: $longitude, ')
          ..write('accuracy: $accuracy, ')
          ..write('speed: $speed, ')
          ..write('heading: $heading, ')
          ..write('altitude: $altitude, ')
          ..write('recordedAt: $recordedAt, ')
          ..write('queued: $queued')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(
    id,
    tripId,
    latitude,
    longitude,
    accuracy,
    speed,
    heading,
    altitude,
    recordedAt,
    queued,
  );
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is TrackingPointRow &&
          other.id == this.id &&
          other.tripId == this.tripId &&
          other.latitude == this.latitude &&
          other.longitude == this.longitude &&
          other.accuracy == this.accuracy &&
          other.speed == this.speed &&
          other.heading == this.heading &&
          other.altitude == this.altitude &&
          other.recordedAt == this.recordedAt &&
          other.queued == this.queued);
}

class TrackingPointsCompanion extends UpdateCompanion<TrackingPointRow> {
  final Value<int> id;
  final Value<String> tripId;
  final Value<double> latitude;
  final Value<double> longitude;
  final Value<double?> accuracy;
  final Value<double?> speed;
  final Value<double?> heading;
  final Value<double?> altitude;
  final Value<DateTime> recordedAt;
  final Value<bool> queued;
  const TrackingPointsCompanion({
    this.id = const Value.absent(),
    this.tripId = const Value.absent(),
    this.latitude = const Value.absent(),
    this.longitude = const Value.absent(),
    this.accuracy = const Value.absent(),
    this.speed = const Value.absent(),
    this.heading = const Value.absent(),
    this.altitude = const Value.absent(),
    this.recordedAt = const Value.absent(),
    this.queued = const Value.absent(),
  });
  TrackingPointsCompanion.insert({
    this.id = const Value.absent(),
    required String tripId,
    required double latitude,
    required double longitude,
    this.accuracy = const Value.absent(),
    this.speed = const Value.absent(),
    this.heading = const Value.absent(),
    this.altitude = const Value.absent(),
    required DateTime recordedAt,
    this.queued = const Value.absent(),
  }) : tripId = Value(tripId),
       latitude = Value(latitude),
       longitude = Value(longitude),
       recordedAt = Value(recordedAt);
  static Insertable<TrackingPointRow> custom({
    Expression<int>? id,
    Expression<String>? tripId,
    Expression<double>? latitude,
    Expression<double>? longitude,
    Expression<double>? accuracy,
    Expression<double>? speed,
    Expression<double>? heading,
    Expression<double>? altitude,
    Expression<DateTime>? recordedAt,
    Expression<bool>? queued,
  }) {
    return RawValuesInsertable({
      if (id != null) 'id': id,
      if (tripId != null) 'trip_id': tripId,
      if (latitude != null) 'latitude': latitude,
      if (longitude != null) 'longitude': longitude,
      if (accuracy != null) 'accuracy': accuracy,
      if (speed != null) 'speed': speed,
      if (heading != null) 'heading': heading,
      if (altitude != null) 'altitude': altitude,
      if (recordedAt != null) 'recorded_at': recordedAt,
      if (queued != null) 'queued': queued,
    });
  }

  TrackingPointsCompanion copyWith({
    Value<int>? id,
    Value<String>? tripId,
    Value<double>? latitude,
    Value<double>? longitude,
    Value<double?>? accuracy,
    Value<double?>? speed,
    Value<double?>? heading,
    Value<double?>? altitude,
    Value<DateTime>? recordedAt,
    Value<bool>? queued,
  }) {
    return TrackingPointsCompanion(
      id: id ?? this.id,
      tripId: tripId ?? this.tripId,
      latitude: latitude ?? this.latitude,
      longitude: longitude ?? this.longitude,
      accuracy: accuracy ?? this.accuracy,
      speed: speed ?? this.speed,
      heading: heading ?? this.heading,
      altitude: altitude ?? this.altitude,
      recordedAt: recordedAt ?? this.recordedAt,
      queued: queued ?? this.queued,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (id.present) {
      map['id'] = Variable<int>(id.value);
    }
    if (tripId.present) {
      map['trip_id'] = Variable<String>(tripId.value);
    }
    if (latitude.present) {
      map['latitude'] = Variable<double>(latitude.value);
    }
    if (longitude.present) {
      map['longitude'] = Variable<double>(longitude.value);
    }
    if (accuracy.present) {
      map['accuracy'] = Variable<double>(accuracy.value);
    }
    if (speed.present) {
      map['speed'] = Variable<double>(speed.value);
    }
    if (heading.present) {
      map['heading'] = Variable<double>(heading.value);
    }
    if (altitude.present) {
      map['altitude'] = Variable<double>(altitude.value);
    }
    if (recordedAt.present) {
      map['recorded_at'] = Variable<DateTime>(recordedAt.value);
    }
    if (queued.present) {
      map['queued'] = Variable<bool>(queued.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('TrackingPointsCompanion(')
          ..write('id: $id, ')
          ..write('tripId: $tripId, ')
          ..write('latitude: $latitude, ')
          ..write('longitude: $longitude, ')
          ..write('accuracy: $accuracy, ')
          ..write('speed: $speed, ')
          ..write('heading: $heading, ')
          ..write('altitude: $altitude, ')
          ..write('recordedAt: $recordedAt, ')
          ..write('queued: $queued')
          ..write(')'))
        .toString();
  }
}

class $KeyValuesTable extends KeyValues
    with TableInfo<$KeyValuesTable, KeyValueRow> {
  @override
  final GeneratedDatabase attachedDatabase;
  final String? _alias;
  $KeyValuesTable(this.attachedDatabase, [this._alias]);
  static const VerificationMeta _keyMeta = const VerificationMeta('key');
  @override
  late final GeneratedColumn<String> key = GeneratedColumn<String>(
    'key',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  static const VerificationMeta _valueMeta = const VerificationMeta('value');
  @override
  late final GeneratedColumn<String> value = GeneratedColumn<String>(
    'value',
    aliasedName,
    false,
    type: DriftSqlType.string,
    requiredDuringInsert: true,
  );
  @override
  List<GeneratedColumn> get $columns => [key, value];
  @override
  String get aliasedName => _alias ?? actualTableName;
  @override
  String get actualTableName => $name;
  static const String $name = 'key_values';
  @override
  VerificationContext validateIntegrity(
    Insertable<KeyValueRow> instance, {
    bool isInserting = false,
  }) {
    final context = VerificationContext();
    final data = instance.toColumns(true);
    if (data.containsKey('key')) {
      context.handle(
        _keyMeta,
        key.isAcceptableOrUnknown(data['key']!, _keyMeta),
      );
    } else if (isInserting) {
      context.missing(_keyMeta);
    }
    if (data.containsKey('value')) {
      context.handle(
        _valueMeta,
        value.isAcceptableOrUnknown(data['value']!, _valueMeta),
      );
    } else if (isInserting) {
      context.missing(_valueMeta);
    }
    return context;
  }

  @override
  Set<GeneratedColumn> get $primaryKey => {key};
  @override
  KeyValueRow map(Map<String, dynamic> data, {String? tablePrefix}) {
    final effectivePrefix = tablePrefix != null ? '$tablePrefix.' : '';
    return KeyValueRow(
      key: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}key'],
      )!,
      value: attachedDatabase.typeMapping.read(
        DriftSqlType.string,
        data['${effectivePrefix}value'],
      )!,
    );
  }

  @override
  $KeyValuesTable createAlias(String alias) {
    return $KeyValuesTable(attachedDatabase, alias);
  }
}

class KeyValueRow extends DataClass implements Insertable<KeyValueRow> {
  final String key;
  final String value;
  const KeyValueRow({required this.key, required this.value});
  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    map['key'] = Variable<String>(key);
    map['value'] = Variable<String>(value);
    return map;
  }

  KeyValuesCompanion toCompanion(bool nullToAbsent) {
    return KeyValuesCompanion(key: Value(key), value: Value(value));
  }

  factory KeyValueRow.fromJson(
    Map<String, dynamic> json, {
    ValueSerializer? serializer,
  }) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return KeyValueRow(
      key: serializer.fromJson<String>(json['key']),
      value: serializer.fromJson<String>(json['value']),
    );
  }
  @override
  Map<String, dynamic> toJson({ValueSerializer? serializer}) {
    serializer ??= driftRuntimeOptions.defaultSerializer;
    return <String, dynamic>{
      'key': serializer.toJson<String>(key),
      'value': serializer.toJson<String>(value),
    };
  }

  KeyValueRow copyWith({String? key, String? value}) =>
      KeyValueRow(key: key ?? this.key, value: value ?? this.value);
  KeyValueRow copyWithCompanion(KeyValuesCompanion data) {
    return KeyValueRow(
      key: data.key.present ? data.key.value : this.key,
      value: data.value.present ? data.value.value : this.value,
    );
  }

  @override
  String toString() {
    return (StringBuffer('KeyValueRow(')
          ..write('key: $key, ')
          ..write('value: $value')
          ..write(')'))
        .toString();
  }

  @override
  int get hashCode => Object.hash(key, value);
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is KeyValueRow &&
          other.key == this.key &&
          other.value == this.value);
}

class KeyValuesCompanion extends UpdateCompanion<KeyValueRow> {
  final Value<String> key;
  final Value<String> value;
  final Value<int> rowid;
  const KeyValuesCompanion({
    this.key = const Value.absent(),
    this.value = const Value.absent(),
    this.rowid = const Value.absent(),
  });
  KeyValuesCompanion.insert({
    required String key,
    required String value,
    this.rowid = const Value.absent(),
  }) : key = Value(key),
       value = Value(value);
  static Insertable<KeyValueRow> custom({
    Expression<String>? key,
    Expression<String>? value,
    Expression<int>? rowid,
  }) {
    return RawValuesInsertable({
      if (key != null) 'key': key,
      if (value != null) 'value': value,
      if (rowid != null) 'rowid': rowid,
    });
  }

  KeyValuesCompanion copyWith({
    Value<String>? key,
    Value<String>? value,
    Value<int>? rowid,
  }) {
    return KeyValuesCompanion(
      key: key ?? this.key,
      value: value ?? this.value,
      rowid: rowid ?? this.rowid,
    );
  }

  @override
  Map<String, Expression> toColumns(bool nullToAbsent) {
    final map = <String, Expression>{};
    if (key.present) {
      map['key'] = Variable<String>(key.value);
    }
    if (value.present) {
      map['value'] = Variable<String>(value.value);
    }
    if (rowid.present) {
      map['rowid'] = Variable<int>(rowid.value);
    }
    return map;
  }

  @override
  String toString() {
    return (StringBuffer('KeyValuesCompanion(')
          ..write('key: $key, ')
          ..write('value: $value, ')
          ..write('rowid: $rowid')
          ..write(')'))
        .toString();
  }
}

abstract class _$AppDatabase extends GeneratedDatabase {
  _$AppDatabase(QueryExecutor e) : super(e);
  late final $CatalogRegionsTable catalogRegions = $CatalogRegionsTable(this);
  late final $DownloadedRegionsTable downloadedRegions =
      $DownloadedRegionsTable(this);
  late final $RegionDownloadsTable regionDownloads = $RegionDownloadsTable(
    this,
  );
  late final $OfflineRoutesTable offlineRoutes = $OfflineRoutesTable(this);
  late final $SyncQueueTable syncQueue = $SyncQueueTable(this);
  late final $TripsTable trips = $TripsTable(this);
  late final $TrackingPointsTable trackingPoints = $TrackingPointsTable(this);
  late final $KeyValuesTable keyValues = $KeyValuesTable(this);
  late final Index syncQueueStatusCreated = Index(
    'sync_queue_status_created',
    'CREATE INDEX sync_queue_status_created ON sync_queue (status, created_at)',
  );
  late final Index trackingPointsTripQueued = Index(
    'tracking_points_trip_queued',
    'CREATE INDEX tracking_points_trip_queued ON tracking_points (trip_id, queued)',
  );
  @override
  Iterable<TableInfo<Table, Object?>> get allTables =>
      allSchemaEntities.whereType<TableInfo<Table, Object?>>();
  @override
  List<DatabaseSchemaEntity> get allSchemaEntities => [
    catalogRegions,
    downloadedRegions,
    regionDownloads,
    offlineRoutes,
    syncQueue,
    trips,
    trackingPoints,
    keyValues,
    syncQueueStatusCreated,
    trackingPointsTripQueued,
  ];
  @override
  StreamQueryUpdateRules get streamUpdateRules => const StreamQueryUpdateRules([
    WritePropagation(
      on: TableUpdateQuery.onTableName(
        'trips',
        limitUpdateKind: UpdateKind.delete,
      ),
      result: [TableUpdate('tracking_points', kind: UpdateKind.delete)],
    ),
  ]);
  @override
  DriftDatabaseOptions get options =>
      const DriftDatabaseOptions(storeDateTimeAsText: true);
}
