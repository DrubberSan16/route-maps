package com.mapsplatform.tilegen.layers;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.geo.GeometryException;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.WithTags;
import java.util.List;
import java.util.Locale;
import org.locationtech.jts.geom.Coordinate;

/**
 * Official/public Ecuador layers downloaded by {@code native-data}. The source fields are deliberately translated
 * here into the platform schema so neither the viewer nor API consumers depend on a government server or its field
 * names at runtime.
 */
public final class NativeData {

  public static final String PREFIX = "native_";
  public static final String ROADS = PREFIX + "roads";
  public static final String PLACES = PREFIX + "places";
  public static final String PROVINCES = PREFIX + "boundary-province";
  public static final String CANTONS = PREFIX + "boundary-canton";
  public static final String PARISHES = PREFIX + "boundary-parish";
  public static final String HEALTH = PREFIX + "poi-health";
  public static final String EDUCATION = PREFIX + "poi-education";
  public static final String TOURISM = PREFIX + "poi-tourism";
  public static final String WATER_AREAS = PREFIX + "water-areas";
  public static final String WATERWAYS = PREFIX + "waterways";
  public static final String CLIMATE_PRECIPITATION = PREFIX + "climate-precipitation-regions";

  public static final List<String> SOURCES = List.of(ROADS, PLACES, PROVINCES, CANTONS, PARISHES, HEALTH,
    EDUCATION, TOURISM, WATER_AREAS, WATERWAYS, CLIMATE_PRECIPITATION);

  private NativeData() {}

  public static boolean isSource(String source) {
    return SOURCES.contains(source);
  }

  public static void process(SourceFeature feature, FeatureCollector features) {
    switch (feature.getSource()) {
      case ROADS -> road(feature, features);
      case PLACES -> place(feature, features);
      case PROVINCES -> boundary(feature, features, 4, "dpa_despro", "state", 2, 5);
      case CANTONS -> boundary(feature, features, 6, "dpa_descan", "town", 4, 8);
      case PARISHES -> boundary(feature, features, 8, "dpa_despar", "village", 5, 11);
      case HEALTH -> poi(feature, features, "hospital", "health", "uni_nombre", 5, 12);
      case EDUCATION -> poi(feature, features, "school", "education", "nom_instit", 20, 14);
      case TOURISM -> poi(feature, features, "attraction", "tourism", "nombre", 10, 13);
      case WATER_AREAS -> water(feature, features);
      case WATERWAYS -> waterway(feature, features);
      case CLIMATE_PRECIPITATION -> climate(feature, features);
      default -> {
        // Not a native catalog source.
      }
    }
  }

  private static void road(SourceFeature feature, FeatureCollector features) {
    if (!feature.canBeLine()) {
      return;
    }
    String hierarchy = lower(feature, "clasificac");
    String roadClass = hierarchy == null ? "primary" : switch (hierarchy) {
      case "arterial", "troncal" -> "trunk";
      case "colectora" -> "primary";
      case "vecinal", "local" -> "secondary";
      default -> "primary";
    };
    int minZoom = roadClass.equals("trunk") ? 5 : roadClass.equals("primary") ? 7 : 9;
    var line = features.line(TransportationLayer.NAME)
      .setAttr("class", roadClass)
      .setAttr("source", "official")
      .setMinZoom(minZoom)
      .setMinPixelSize(0);
    setText(line, feature, "name", "nombre_tra", Math.max(minZoom, 9));
    setText(line, feature, "ref", "codigo_via", Math.max(minZoom, 8));
    setText(line, feature, "condition", "estado", 11);
    String surface = lower(feature, "tipo_calza");
    if (surface != null) {
      line.setAttrWithMinzoom("surface", surface.contains("pavimento") || surface.contains("asfalto") ?
        "paved" : "unpaved", 11);
    }
    double lanes = NaturalEarth.number(feature, "numero_car", 0);
    if (lanes > 0 && lanes <= 20) {
      line.setAttrWithMinzoom("lanes", (int) lanes, 12);
    }
  }

  private static void place(SourceFeature feature, FeatureCollector features) {
    String name = text(feature, "n_loc");
    if (name == null || !feature.isPoint()) {
      return;
    }
    var point = features.point(PlaceLayer.NAME)
      .setAttr("class", "village")
      .setAttr("rank", 5)
      .setAttr("name", name)
      .setMinZoom(10)
      .setSortKey(PlaceLayer.sortKey(5, 0))
      .setPointLabelGridSizeAndLimit(12, PlaceLayer.LABEL_GRID_PIXELS, PlaceLayer.LABEL_GRID_LIMIT)
      .setBufferPixels(PlaceLayer.LABEL_GRID_PIXELS);
  }

  private static void boundary(SourceFeature feature, FeatureCollector features, int adminLevel, String nameField,
    String placeClass, int rank, int labelZoom) {
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
    String name = text(feature, nameField);
    if (name != null) {
      features.pointOnSurface(PlaceLayer.NAME)
        .setAttr("class", placeClass)
        .setAttr("rank", rank)
        .setAttr("name", name)
        .setMinZoom(labelZoom)
        .setSortKey(PlaceLayer.sortKey(rank, 0))
        .setPointLabelGridSizeAndLimit(12, PlaceLayer.LABEL_GRID_PIXELS, PlaceLayer.LABEL_GRID_LIMIT)
        .setBufferPixels(PlaceLayer.LABEL_GRID_PIXELS);
    }
  }

  private static void poi(SourceFeature feature, FeatureCollector features, String poiClass, String subclass,
    String nameField, int rank, int minZoom) {
    if (!feature.isPoint()) {
      return;
    }
    String name = text(feature, nameField);
    if (name == null) {
      name = text(feature, "nam");
    }
    if (name == null) {
      return;
    }
    var point = features.point(PoiLayer.NAME)
      .setAttr("class", poiClass)
      .setAttr("subclass", subclass)
      .setAttr("rank", rank)
      .setAttr("name", name)
      .setAttr("source", "official")
      .setMinZoom(minZoom)
      .setSortKey(rank)
      .setPointLabelGridSizeAndLimit(Zooms.MAX - 1, PoiLayer.LABEL_GRID_PIXELS, PoiLayer.LABEL_GRID_LIMIT)
      .setBufferPixels(PoiLayer.LABEL_GRID_PIXELS);
    setText(point, feature, "address", "uni_direcc", minZoom);
  }

  private static void water(SourceFeature feature, FeatureCollector features) {
    if (!feature.canBePolygon()) {
      return;
    }
    var polygon = features.polygon(WaterLayer.NAME)
      .setAttr("class", "river")
      .setMinZoom(7)
      .setMinPixelSizeBelowZoom(11, 2);
    String name = text(feature, "nam");
    if (name != null) {
      polygon.setAttrWithMinzoom("name", name, 10);
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
    setText(line, feature, "name", "nam", 10);
    String permanence = lower(feature, "hyp_desc");
    if (permanence != null && !permanence.contains("perenne")) {
      line.setAttr("intermittent", true);
    }
  }

  private static void climate(SourceFeature feature, FeatureCollector features) {
    if (!feature.canBePolygon()) {
      return;
    }
    var polygon = features.polygon("climate")
      .setAttr("class", "precipitation-region")
      .setMinZoom(5)
      .setMinPixelSize(2);
    for (String field : List.of("name", "nombre", "region", "precip", "precipitac")) {
      String value = text(feature, field);
      if (value != null) {
        polygon.setAttr(field, value);
      }
    }
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

  private static void setText(FeatureCollector.Feature output, WithTags input, String outputField,
    String inputField, int minZoom) {
    String value = text(input, inputField);
    if (value != null) {
      output.setAttrWithMinzoom(outputField, value, minZoom);
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
