package com.mapsplatform.tilegen.layers;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.geo.GeometryException;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.WithTags;
import java.util.List;
import java.util.Locale;
import org.locationtech.jts.geom.Coordinate;

/**
 * Region layers prepared by the data pipeline ({@code native-data download} + {@code build}) in the platform's own
 * schema: roads with classes and labels, places, points of interest, land use, blocks, buildings, the census
 * population grid and climate zones, plus the official boundaries and hydrography. Field names of the government
 * services never reach the tiles, so neither the viewer nor API consumers depend on them.
 */
public final class NativeData {

  public static final String PREFIX = "native_";
  public static final String ROADS = PREFIX + "map-roads";
  public static final String PLACES = PREFIX + "map-places";
  public static final String POIS = PREFIX + "map-pois";
  public static final String LANDUSE = PREFIX + "map-landuse";
  public static final String URBAN = PREFIX + "map-urban";
  public static final String BLOCKS = PREFIX + "map-blocks";
  public static final String BUILDINGS = PREFIX + "map-buildings";
  public static final String POPULATION = PREFIX + "map-population";
  public static final String PROVINCES = PREFIX + "boundary-province";
  public static final String CANTONS = PREFIX + "boundary-canton";
  public static final String PARISHES = PREFIX + "boundary-parish";
  public static final String WATER_AREAS = PREFIX + "water-areas";
  public static final String WATERWAYS = PREFIX + "waterways";
  public static final String CLIMATE_PRECIPITATION = PREFIX + "climate-precipitation-regions";
  public static final String CLIMATE_TEMPERATURE = PREFIX + "climate-temperature-regions";

  public static final List<String> SOURCES = List.of(ROADS, PLACES, POIS, LANDUSE, URBAN, BLOCKS, BUILDINGS,
    POPULATION, PROVINCES, CANTONS, PARISHES, WATER_AREAS, WATERWAYS, CLIMATE_PRECIPITATION, CLIMATE_TEMPERATURE);

  /**
   * Sources of the optional overlays (population heat map, climate zones). The clients start with them hidden, so
   * they are built into an archive of their own ({@code <region>.overlays.pmtiles}): the map tiles stay light and the
   * overlays are only downloaded when someone turns them on.
   */
  public static final List<String> OVERLAY_SOURCES = List.of(POPULATION, CLIMATE_PRECIPITATION, CLIMATE_TEMPERATURE);

  /** Layer of the census population grid (drawn as a heat map by the clients). */
  public static final String POPULATION_LAYER = "population";
  /** Layer of the climate zones (optional overlay of the clients). */
  public static final String CLIMATE_LAYER = "climate";

  private NativeData() {}

  public static boolean isSource(String source) {
    return SOURCES.contains(source);
  }

  public static void process(SourceFeature feature, FeatureCollector features) {
    switch (feature.getSource()) {
      case ROADS -> road(feature, features);
      case PLACES -> place(feature, features);
      case POIS -> poi(feature, features);
      case LANDUSE -> landuse(feature, features);
      case URBAN -> urban(feature, features);
      case BLOCKS -> block(feature, features);
      case BUILDINGS -> building(feature, features);
      case POPULATION -> population(feature, features);
      case PROVINCES -> boundary(feature, features, 4, "dpa_despro");
      case CANTONS -> boundary(feature, features, 6, null);
      case PARISHES -> boundary(feature, features, 8, null);
      case WATER_AREAS -> water(feature, features);
      case WATERWAYS -> waterway(feature, features);
      case CLIMATE_PRECIPITATION -> precipitation(feature, features);
      case CLIMATE_TEMPERATURE -> temperature(feature, features);
      default -> {
        // Not a native catalog source.
      }
    }
  }

  // ---------------------------------------------------------------- roads

  /** Zoom where a road class appears in the detailed network (the overview covers the state roads below 12). */
  static int roadMinZoom(String roadClass, boolean hasRef) {
    return switch (roadClass) {
      case "motorway", "trunk", "primary" -> hasRef ? 12 : 10;
      case "secondary" -> 11;
      case "tertiary", "street", "track" -> 13;
      default -> 14;
    };
  }

  static int roadNameMinZoom(String roadClass) {
    return switch (roadClass) {
      case "motorway", "trunk", "primary" -> 12;
      case "secondary" -> 13;
      default -> 14;
    };
  }

  private static void road(SourceFeature feature, FeatureCollector features) {
    if (!feature.canBeLine()) {
      return;
    }
    String roadClass = text(feature, "class");
    if (roadClass == null) {
      return;
    }
    String layerClass = switch (roadClass) {
      case "street" -> "minor";
      case "footway", "steps" -> "path";
      default -> roadClass;
    };
    String ref = text(feature, "ref");
    boolean overview = "overview".equals(text(feature, "scope"));
    boolean state = feature.hasTag("state");
    int minZoom;
    int maxZoom = Zooms.MAX;
    if (overview) {
      minZoom = switch (roadClass) {
        case "motorway", "trunk" -> 5;
        default -> 7;
      };
      maxZoom = 11;
    } else if (state) {
      minZoom = 12;
    } else {
      minZoom = roadMinZoom(roadClass, ref != null);
    }
    var line = features.line(TransportationLayer.NAME)
      .setAttr("class", layerClass)
      .setMinZoom(minZoom)
      .setMaxZoom(maxZoom)
      .setMinPixelSize(0)
      .setSortKey(sortKey(roadClass));
    if (!layerClass.equals(roadClass)) {
      line.setAttr("subclass", roadClass);
    } else if (text(feature, "kind") != null && roadClass.equals("path")) {
      line.setAttr("subclass", text(feature, "kind").toLowerCase(Locale.ROOT));
    }
    if (ref != null) {
      line.setAttrWithMinzoom("ref", ref, Math.max(minZoom, 8));
    }
    String name = text(feature, "name");
    if (name != null) {
      line.setAttrWithMinzoom("name", name, Math.max(minZoom, roadNameMinZoom(roadClass)));
    }
    if ("unpaved".equals(text(feature, "surface"))) {
      line.setAttrWithMinzoom("surface", "unpaved", 11);
    }
    if ("tunnel".equals(text(feature, "brunnel"))) {
      line.setAttrWithMinzoom("brunnel", "tunnel", 12);
    }
  }

  static int sortKey(String roadClass) {
    return switch (roadClass) {
      case "motorway" -> 90;
      case "trunk" -> 80;
      case "primary" -> 70;
      case "secondary" -> 60;
      case "tertiary" -> 50;
      case "street" -> 40;
      case "service", "track" -> 30;
      default -> 20;
    };
  }

  // ---------------------------------------------------------------- places and points of interest

  static int placeMinZoom(String placeClass, long population) {
    return switch (placeClass) {
      case "city" -> population >= 1_000_000 ? 4 : population >= 200_000 ? 5 : 6;
      case "town" -> population >= 50_000 ? 7 : 8;
      case "village" -> 10;
      case "suburb" -> 12;
      case "hamlet" -> 12;
      default -> 13;
    };
  }

  private static void place(SourceFeature feature, FeatureCollector features) {
    String name = text(feature, "name");
    String placeClass = text(feature, "class");
    if (name == null || placeClass == null || !feature.isPoint()) {
      return;
    }
    long population = (long) number(feature, "population", 0);
    int rank = (int) number(feature, "rank", 6);
    int minZoom = placeMinZoom(placeClass, population);
    var point = features.point(PlaceLayer.NAME)
      .setAttr("class", placeClass)
      .setAttr("rank", rank)
      .setAttr("name", name)
      .setMinZoom(minZoom)
      .setSortKey(PlaceLayer.sortKey(rank, population))
      .setPointLabelGridSizeAndLimit(12, PlaceLayer.LABEL_GRID_PIXELS, PlaceLayer.LABEL_GRID_LIMIT)
      .setBufferPixels(PlaceLayer.LABEL_GRID_PIXELS);
    if (population > 0) {
      point.setAttr("population", population);
    }
    String capital = text(feature, "capital");
    if (capital != null) {
      point.setAttr("capital", capital);
    }
  }

  static int poiMinZoom(int rank) {
    return rank <= 8 ? 12 : rank <= 14 ? 13 : 14;
  }

  private static void poi(SourceFeature feature, FeatureCollector features) {
    String poiClass = text(feature, "class");
    if (poiClass == null || !feature.isPoint()) {
      return;
    }
    int rank = (int) number(feature, "rank", 20);
    var point = features.point(PoiLayer.NAME)
      .setAttr("class", poiClass)
      .setAttr("rank", rank)
      .setMinZoom(poiMinZoom(rank))
      .setSortKey(rank)
      .setPointLabelGridSizeAndLimit(Zooms.MAX - 1, PoiLayer.LABEL_GRID_PIXELS, PoiLayer.LABEL_GRID_LIMIT)
      .setBufferPixels(PoiLayer.LABEL_GRID_PIXELS);
    String subclass = text(feature, "subclass");
    if (subclass != null) {
      point.setAttr("subclass", subclass);
    }
    String name = text(feature, "name");
    if (name != null) {
      point.setAttr("name", name);
    }
  }

  // ---------------------------------------------------------------- areas

  private static void landuse(SourceFeature feature, FeatureCollector features) {
    String landuseClass = text(feature, "class");
    if (landuseClass == null || !feature.canBePolygon()) {
      return;
    }
    String layerClass = switch (landuseClass) {
      case "pitch" -> "sports";
      case "square" -> "pedestrian";
      default -> landuseClass;
    };
    features.polygon(LanduseLayer.NAME)
      .setAttr("class", layerClass)
      .setMinZoom(landuseClass.equals("square") ? 14 : 12)
      .setMinPixelSize(1);
    String name = text(feature, "name");
    if (name != null && (landuseClass.equals("park") || landuseClass.equals("cemetery"))) {
      features.pointOnSurface(PoiLayer.NAME)
        .setAttr("class", landuseClass)
        .setAttr("subclass", landuseClass)
        .setAttr("rank", 16)
        .setAttr("name", name)
        .setMinZoom(14)
        .setSortKey(16)
        .setPointLabelGridSizeAndLimit(Zooms.MAX - 1, PoiLayer.LABEL_GRID_PIXELS, PoiLayer.LABEL_GRID_LIMIT)
        .setBufferPixels(PoiLayer.LABEL_GRID_PIXELS);
    }
  }

  private static void urban(SourceFeature feature, FeatureCollector features) {
    if (feature.canBePolygon()) {
      features.polygon(LanduseLayer.NAME)
        .setAttr("class", "residential")
        .setMinZoom(6)
        .setMaxZoom(12)
        .setMinPixelSize(2);
    }
  }

  private static void block(SourceFeature feature, FeatureCollector features) {
    if (feature.canBePolygon()) {
      features.polygon(LanduseLayer.NAME)
        .setAttr("class", "block")
        .setMinZoom(13)
        .setMinPixelSize(1);
    }
  }

  private static void building(SourceFeature feature, FeatureCollector features) {
    if (feature.canBePolygon()) {
      features.polygon(BuildingLayer.NAME)
        .setMinZoom(Zooms.MAX)
        .setMinPixelSize(1);
    }
  }

  private static void population(SourceFeature feature, FeatureCollector features) {
    if (!feature.isPoint()) {
      return;
    }
    double people = number(feature, "pop", 0);
    if (people <= 0) {
      return;
    }
    features.point(POPULATION_LAYER)
      .setAttr("pop", (long) people)
      .setMinZoom(4)
      .setMaxZoom(12)
      .setSortKey((int) Math.max(0, 100_000 - Math.min(people, 100_000)));
  }

  // ---------------------------------------------------------------- boundaries, water, climate

  private static void boundary(SourceFeature feature, FeatureCollector features, int adminLevel, String nameField) {
    if (!feature.canBePolygon()) {
      return;
    }
    try {
      features.geometry(BoundaryLayer.NAME, feature.worldGeometry().getBoundary())
        .setAttr("admin_level", adminLevel)
        .setMinZoom(BoundaryLayer.minZoom(adminLevel))
        .setMinPixelSize(0)
        .setSortKeyDescending(adminLevel);
    } catch (GeometryException error) {
      return;
    }
    String name = nameField == null ? null : text(feature, nameField);
    if (name != null) {
      features.pointOnSurface(PlaceLayer.NAME)
        .setAttr("class", "state")
        .setAttr("rank", 2)
        .setAttr("name", titleCase(name))
        .setMinZoom(5)
        .setMaxZoom(9)
        .setSortKey(PlaceLayer.sortKey(2, 0))
        .setPointLabelGridSizeAndLimit(12, PlaceLayer.LABEL_GRID_PIXELS, PlaceLayer.LABEL_GRID_LIMIT)
        .setBufferPixels(PlaceLayer.LABEL_GRID_PIXELS);
    }
  }

  private static void water(SourceFeature feature, FeatureCollector features) {
    if (!feature.canBePolygon()) {
      return;
    }
    var polygon = features.polygon(WaterLayer.NAME)
      .setAttr("class", "river")
      .setMinZoom(6)
      .setMinPixelSizeBelowZoom(11, 2);
    String name = text(feature, "nam");
    if (name != null) {
      polygon.setAttrWithMinzoom("name", titleCase(name), 10);
    }
  }

  private static void waterway(SourceFeature feature, FeatureCollector features) {
    if (!feature.canBeLine()) {
      return;
    }
    var line = features.line(WaterwayLayer.NAME)
      .setAttr("class", "river")
      .setMinZoom(9)
      .setMinPixelSize(0);
    String name = text(feature, "nam");
    if (name != null) {
      line.setAttrWithMinzoom("name", titleCase(name), 10);
    }
    String permanence = lower(feature, "hyp_desc");
    if (permanence != null && !permanence.contains("perenne")) {
      line.setAttr("intermittent", true);
    }
  }

  private static void precipitation(SourceFeature feature, FeatureCollector features) {
    if (!feature.canBePolygon()) {
      return;
    }
    String range = text(feature, "rango");
    var polygon = features.polygon(CLIMATE_LAYER)
      .setAttr("class", "precipitation")
      .setMinZoom(4)
      .setMaxZoom(12)
      .setMinPixelSize(2);
    if (range != null) {
      polygon.setAttr("range", range);
      double[] bounds = numbers(range);
      if (bounds.length > 0) {
        polygon.setAttr("mm_max", bounds[bounds.length - 1]);
      }
    }
  }

  private static void temperature(SourceFeature feature, FeatureCollector features) {
    if (!feature.canBePolygon()) {
      return;
    }
    String thermotype = text(feature, "termotipo");
    if (thermotype == null) {
      return;
    }
    features.polygon(CLIMATE_LAYER)
      .setAttr("class", "temperature")
      .setAttr("thermotype", titleCase(thermotype))
      .setAttr("band", thermalBand(thermotype))
      .setMinZoom(4)
      .setMaxZoom(12)
      .setMinPixelSize(2);
  }

  /** 1 (coldest) to 6 (warmest) from the bioclimatic thermotype. */
  static int thermalBand(String thermotype) {
    String value = thermotype.toLowerCase(Locale.ROOT);
    if (value.contains("criorotropical") || value.contains("crioro")) {
      return 1;
    }
    if (value.contains("orotropical")) {
      return 2;
    }
    if (value.contains("supratropical")) {
      return 3;
    }
    if (value.contains("mesotropical")) {
      return 4;
    }
    if (value.contains("termotropical")) {
      return 5;
    }
    return value.contains("infratropical") ? 6 : 4;
  }

  // ---------------------------------------------------------------- helpers

  private static double[] numbers(String text) {
    return java.util.regex.Pattern.compile("\\d+(?:[.,]\\d+)?").matcher(text).results()
      .mapToDouble(match -> Double.parseDouble(match.group().replace(',', '.'))).toArray();
  }

  static String titleCase(String value) {
    if (value == null || !value.equals(value.toUpperCase(Locale.ROOT))) {
      return value;
    }
    StringBuilder out = new StringBuilder(value.length());
    boolean start = true;
    for (String word : value.toLowerCase(Locale.ROOT).split(" ")) {
      if (word.isEmpty()) {
        continue;
      }
      if (!start) {
        out.append(' ');
      }
      boolean particle = !start && List.of("de", "del", "la", "las", "los", "el", "y").contains(word);
      out.append(particle ? word : Character.toUpperCase(word.charAt(0)) + word.substring(1));
      start = false;
    }
    return out.toString();
  }

  private static String text(WithTags feature, String field) {
    Object value = feature.getTag(field);
    if (value == null) {
      value = feature.getTag(field.toUpperCase(Locale.ROOT));
    }
    return value == null ? null : Tags.trimmed(value.toString());
  }

  private static String lower(WithTags feature, String field) {
    String value = text(feature, field);
    return value == null ? null : value.toLowerCase(Locale.ROOT);
  }

  private static double number(WithTags feature, String field, double fallback) {
    Object value = feature.getTag(field);
    if (value instanceof Number number) {
      return number.doubleValue();
    }
    if (value == null) {
      return fallback;
    }
    try {
      return Double.parseDouble(value.toString());
    } catch (NumberFormatException error) {
      return fallback;
    }
  }

  /** Returns a representative coordinate for search-index generation. */
  public static Coordinate representativeCoordinate(SourceFeature feature) {
    try {
      var geometry = feature.latLonGeometry();
      return geometry == null || geometry.isEmpty() ? null : geometry.getInteriorPoint().getCoordinate();
    } catch (GeometryException error) {
      return null;
    }
  }
}
