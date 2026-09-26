package com.mapsplatform.tilegen.layers;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.geo.GeoUtils;
import com.onthegomap.planetiler.geo.GeometryException;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.WithTags;
import java.util.List;
import java.util.Locale;
import org.locationtech.jts.geom.Envelope;
import org.locationtech.jts.geom.Geometry;

/**
 * World base map from Natural Earth 10m (public domain) for zooms 0 to {@link #MAX_ZOOM}: oceans, lakes, rivers,
 * country and province borders, country and city labels, main roads and urban areas. Features use the layers,
 * classes and attributes of the OpenStreetMap regions, so one style renders both.
 * <p>
 * Each shapefile is its own source named like the file ({@code ne_10m_ocean.zip} is {@code ne_10m_ocean}). Countries
 * and populated places also feed the {@link PlaceIndex} of the place search. Natural Earth field names are upper or
 * lower case depending on the file, so fields are read ignoring case.
 */
public final class NaturalEarth {

  public static final String OCEAN = "ne_10m_ocean";
  public static final String LAKES = "ne_10m_lakes";
  public static final String RIVERS = "ne_10m_rivers_lake_centerlines";
  public static final String MARINE_AREAS = "ne_10m_geography_marine_polys";
  public static final String COUNTRIES = "ne_10m_admin_0_countries";
  public static final String COUNTRY_BORDERS = "ne_10m_admin_0_boundary_lines_land";
  public static final String PROVINCE_BORDERS = "ne_10m_admin_1_states_provinces_lines";
  public static final String PLACES = "ne_10m_populated_places";
  public static final String ROADS = "ne_10m_roads";
  public static final String URBAN_AREAS = "ne_10m_urban_areas";
  public static final List<String> SOURCES = List.of(OCEAN, LAKES, RIVERS, MARINE_AREAS, COUNTRIES,
    COUNTRY_BORDERS, PROVINCE_BORDERS, PLACES, ROADS, URBAN_AREAS);

  /** Highest zoom of the world base map: prepared regions add the detail. */
  public static final int MAX_ZOOM = 7;
  /** Populated places from this population up are cities, smaller ones towns (capitals are always cities). */
  static final long CITY_POPULATION = 100_000;

  private final PlaceIndex places;

  public NaturalEarth(PlaceIndex places) {
    this.places = places;
  }

  public static boolean isSource(String source) {
    return SOURCES.contains(source);
  }

  public void process(SourceFeature feature, FeatureCollector features) {
    switch (feature.getSource()) {
      case OCEAN -> features.polygon(WaterLayer.NAME)
        .setAttr("class", "ocean")
        .setMinZoom(0)
        .setMinPixelSizeAtAllZooms(0);
      case LAKES -> lake(feature, features);
      case RIVERS -> river(feature, features);
      case MARINE_AREAS -> marineLabel(feature, features);
      case COUNTRIES -> country(feature, features);
      case COUNTRY_BORDERS -> border(feature, features, 2);
      case PROVINCE_BORDERS -> border(feature, features, 4);
      case PLACES -> place(feature, features);
      case ROADS -> road(feature, features);
      case URBAN_AREAS -> urbanArea(feature, features);
      default -> {
        // Not a Natural Earth source of the base map.
      }
    }
  }

  // ---------------------------------------------------------------- field access

  static Object field(WithTags feature, String name) {
    Object value = feature.getTag(name);
    return value != null ? value : feature.getTag(name.toUpperCase(Locale.ROOT));
  }

  static String text(WithTags feature, String name) {
    Object value = field(feature, name);
    return value == null ? null : Tags.trimmed(value.toString());
  }

  static String lowerText(WithTags feature, String name) {
    String value = text(feature, name);
    return value == null ? null : value.toLowerCase(Locale.ROOT);
  }

  static double number(WithTags feature, String name, double fallback) {
    Object value = field(feature, name);
    if (value instanceof Number number) {
      return number.doubleValue();
    }
    if (value != null) {
      try {
        return Double.parseDouble(value.toString().strip());
      } catch (NumberFormatException e) {
        return fallback;
      }
    }
    return fallback;
  }

  /**
   * Zoom where a feature appears, from Natural Earth's fractional {@code min_zoom}-style fields (tuned for web maps,
   * -99 when unknown), never below {@code lowest}; -1 when it only appears above the base map.
   */
  static int minZoom(WithTags feature, String name, int lowest) {
    int zoom = Math.max(lowest, (int) Math.floor(number(feature, name, lowest)));
    return zoom > MAX_ZOOM ? -1 : zoom;
  }

  /** ISO 3166-1 alpha-2 code of a country or place, or {@code null} (Natural Earth writes -99 when there is none). */
  static String countryCode(WithTags feature) {
    for (String name : List.of("iso_a2_eh", "iso_a2")) {
      String value = text(feature, name);
      if (value != null && value.matches("[A-Za-z]{2}")) {
        return value.toUpperCase(Locale.ROOT);
      }
    }
    return null;
  }

  private static void setNames(FeatureCollector.Feature output, WithTags feature, int minZoom) {
    String name = text(feature, "name");
    if (name == null) {
      return;
    }
    output.setAttrWithMinzoom("name", name, minZoom);
    String spanish = text(feature, "name_es");
    if (spanish != null && !spanish.equals(name)) {
      output.setAttrWithMinzoom("name_es", spanish, minZoom);
    }
    String english = text(feature, "name_en");
    if (english != null && !english.equals(name)) {
      output.setAttrWithMinzoom("name_en", english, minZoom);
    }
  }

  private static Envelope latLonBounds(SourceFeature feature) {
    try {
      Geometry geometry = feature.latLonGeometry();
      return geometry == null || geometry.isEmpty() ? null : geometry.getEnvelopeInternal();
    } catch (GeometryException e) {
      return null;
    }
  }

  // ---------------------------------------------------------------- water

  private static void lake(SourceFeature feature, FeatureCollector features) {
    int minZoom = minZoom(feature, "min_zoom", 0);
    if (minZoom < 0) {
      return;
    }
    String featureClass = lowerText(feature, "featurecla");
    String waterClass = featureClass != null && featureClass.contains("reservoir") ? "reservoir" : "lake";
    features.polygon(WaterLayer.NAME)
      .setAttr("class", waterClass)
      .setMinZoom(minZoom)
      .setMinPixelSize(2);
    if (text(feature, "name") != null) {
      int labelZoom = Math.min(MAX_ZOOM, minZoom + 1);
      var label = features.pointOnSurface(WaterNameLayer.NAME).setAttr("class", waterClass).setMinZoom(labelZoom);
      setNames(label, feature, labelZoom);
    }
  }

  private static void river(SourceFeature feature, FeatureCollector features) {
    String featureClass = lowerText(feature, "featurecla");
    // Lake centerlines run through lakes that are already drawn as areas.
    if (featureClass == null || !featureClass.startsWith("river")) {
      return;
    }
    int minZoom = minZoom(feature, "min_zoom", 3);
    if (minZoom < 0) {
      return;
    }
    var line = features.line(WaterwayLayer.NAME)
      .setAttr("class", "river")
      .setMinZoom(minZoom)
      .setMinPixelSize(0);
    if (featureClass.contains("intermittent")) {
      line.setAttr("intermittent", true);
    }
    setNames(line, feature, Math.max(minZoom, 5));
  }

  static String seaClass(String featureClass) {
    if (featureClass == null) {
      return "bay";
    }
    return switch (featureClass) {
      case "ocean" -> "ocean";
      case "sea" -> "sea";
      default -> "bay";
    };
  }

  private static void marineLabel(SourceFeature feature, FeatureCollector features) {
    if (text(feature, "name") == null) {
      return;
    }
    String seaClass = seaClass(lowerText(feature, "featurecla"));
    int lowest = switch (seaClass) {
      case "ocean" -> 0;
      case "sea" -> 3;
      default -> 5;
    };
    int minZoom = minZoom(feature, "min_label", lowest);
    if (minZoom < 0) {
      return;
    }
    var label = features.pointOnSurface(WaterNameLayer.NAME).setAttr("class", seaClass).setMinZoom(minZoom);
    setNames(label, feature, minZoom);
  }

  // ---------------------------------------------------------------- countries, borders and places

  private void country(SourceFeature feature, FeatureCollector features) {
    String name = text(feature, "name");
    if (name == null) {
      return;
    }
    Envelope bounds = latLonBounds(feature);
    double longitude = number(feature, "label_x", Double.NaN);
    double latitude = number(feature, "label_y", Double.NaN);
    if (Double.isNaN(longitude) || Double.isNaN(latitude)) {
      if (bounds == null) {
        return;
      }
      longitude = bounds.centre().x;
      latitude = bounds.centre().y;
    }
    long population = Math.max(0, (long) number(feature, "pop_est", 0));
    // Every country gets a label within the base map, small ones later.
    int minZoom = Math.clamp((long) Math.floor(number(feature, "min_label", 2)), 2, MAX_ZOOM);
    var label = features.geometry(PlaceLayer.NAME, GeoUtils.point(GeoUtils.getWorldX(longitude),
        GeoUtils.getWorldY(latitude)))
      .setAttr("class", "country")
      .setAttr("rank", 1)
      .setMinZoom(minZoom)
      .setSortKey(PlaceLayer.sortKey(1, population))
      .setPointLabelGridSizeAndLimit(12, PlaceLayer.LABEL_GRID_PIXELS, PlaceLayer.LABEL_GRID_LIMIT)
      .setBufferPixels(PlaceLayer.LABEL_GRID_PIXELS);
    setNames(label, feature, minZoom);
    if (places != null) {
      double[] bbox = bounds == null ? null :
        new double[]{bounds.getMinX(), bounds.getMinY(), bounds.getMaxX(), bounds.getMaxY()};
      places.add(new PlaceIndex.Place("country", name, text(feature, "name_es"), countryCode(feature),
        text(feature, "adm0_a3"), null, null, latitude, longitude, population, bbox));
    }
  }

  static boolean isDisputed(String featureClass) {
    return featureClass != null && (featureClass.contains("disputed") || featureClass.contains("indefinite") ||
      featureClass.contains("indeterminant") || featureClass.contains("line of control") ||
      featureClass.contains("breakaway") || featureClass.contains("unrecognized"));
  }

  private static void border(SourceFeature feature, FeatureCollector features, int adminLevel) {
    int minZoom = adminLevel <= 2 ? 0 : minZoom(feature, "min_zoom", 3);
    if (minZoom < 0) {
      return;
    }
    var line = features.line(BoundaryLayer.NAME)
      .setAttr("admin_level", adminLevel)
      .setMinZoom(minZoom)
      .setMinPixelSize(0)
      .setSortKeyDescending(adminLevel);
    if (isDisputed(lowerText(feature, "featurecla"))) {
      line.setAttr("disputed", true);
    }
  }

  /** {@code capital} attribute of a populated place: "2" for national capitals, "4" for provincial ones. */
  static String capital(String featureClass) {
    if (featureClass == null) {
      return null;
    }
    if (featureClass.startsWith("admin-0 capital")) {
      return "2";
    }
    if (featureClass.startsWith("admin-1 capital")) {
      return "4";
    }
    return null;
  }

  private void place(SourceFeature feature, FeatureCollector features) {
    String name = text(feature, "name");
    if (name == null) {
      return;
    }
    String capital = capital(lowerText(feature, "featurecla"));
    long population = Math.max(0, (long) number(feature, "pop_max", 0));
    if (places != null && feature.isPoint()) {
      // The search knows every place, also those too small for the base map.
      try {
        Geometry point = feature.latLonGeometry();
        places.add(new PlaceIndex.Place("city", name, text(feature, "name_es"), countryCode(feature),
          text(feature, "adm0_a3"), text(feature, "adm1name"), capital, point.getCoordinate().y,
          point.getCoordinate().x, population, null));
      } catch (GeometryException e) {
        // Invalid geometry: no index entry.
      }
    }
    int minZoom = minZoom(feature, "min_zoom", 2);
    if (minZoom < 0) {
      return;
    }
    boolean city = capital != null || population >= CITY_POPULATION;
    int rank = city ? 3 : 4;
    var point = features.point(PlaceLayer.NAME)
      .setAttr("class", city ? "city" : "town")
      .setAttr("rank", rank)
      .setMinZoom(minZoom)
      .setSortKey(PlaceLayer.sortKey(rank, population))
      .setPointLabelGridSizeAndLimit(12, PlaceLayer.LABEL_GRID_PIXELS, PlaceLayer.LABEL_GRID_LIMIT)
      .setBufferPixels(PlaceLayer.LABEL_GRID_PIXELS);
    if (population > 0) {
      point.setAttr("population", population);
    }
    if (capital != null) {
      point.setAttr("capital", capital);
    }
    setNames(point, feature, minZoom);
  }

  // ---------------------------------------------------------------- roads and urban areas

  /** Transportation class of a Natural Earth road, or {@code null} for tracks and unknown roads. */
  static String roadClass(WithTags feature) {
    String type = lowerText(feature, "type");
    if (type == null) {
      return null;
    }
    if (type.contains("ferry")) {
      return "ferry";
    }
    boolean expressway = number(feature, "expressway", 0) == 1;
    return switch (type) {
      case "major highway" -> expressway ? "motorway" : "trunk";
      case "secondary highway" -> expressway ? "motorway" : "primary";
      case "road", "beltway", "bypass" -> "secondary";
      default -> null;
    };
  }

  private static void road(SourceFeature feature, FeatureCollector features) {
    String roadClass = roadClass(feature);
    if (roadClass == null) {
      return;
    }
    int minZoom = minZoom(feature, "min_zoom", 3);
    if (minZoom < 0) {
      return;
    }
    features.line(TransportationLayer.NAME)
      .setAttr("class", roadClass)
      .setMinZoom(minZoom)
      .setMinPixelSize(0);
  }

  private static void urbanArea(SourceFeature feature, FeatureCollector features) {
    int minZoom = minZoom(feature, "min_zoom", 4);
    if (minZoom < 0) {
      return;
    }
    features.polygon(LanduseLayer.NAME)
      .setAttr("class", "residential")
      .setMinZoom(minZoom)
      .setMinPixelSize(2);
  }
}
