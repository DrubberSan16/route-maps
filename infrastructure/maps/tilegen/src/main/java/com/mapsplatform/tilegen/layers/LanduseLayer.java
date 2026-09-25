package com.mapsplatform.tilegen.layers;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.FeatureMerge;
import com.onthegomap.planetiler.VectorTile;
import com.onthegomap.planetiler.geo.GeometryException;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.WithTags;
import java.util.List;

/**
 * {@code landuse}: land use and land cover polygons.
 * <p>
 * Classes: park, forest, grass, scrub, farmland, wetland (with {@code subclass}, e.g. mangrove), sand, rock, glacier,
 * residential, commercial, industrial, military, cemetery, hospital, school, sports, parking, construction, aerodrome,
 * apron.
 */
public final class LanduseLayer implements Layer {

  public static final String NAME = "landuse";

  @Override
  public String name() {
    return NAME;
  }

  /** Land use class of an OSM area, or {@code null}. The first matching rule wins. */
  public static String landuseClass(WithTags f) {
    if (f.hasTag("leisure", "park", "garden", "playground", "nature_reserve", "recreation_ground", "dog_park") ||
      f.hasTag("boundary", "national_park") || f.hasTag("landuse", "recreation_ground", "village_green")) {
      return "park";
    }
    if (f.hasTag("landuse", "forest") || f.hasTag("natural", "wood")) {
      return "forest";
    }
    if (f.hasTag("natural", "wetland")) {
      return "wetland";
    }
    if (f.hasTag("natural", "glacier")) {
      return "glacier";
    }
    if (f.hasTag("natural", "beach", "sand", "dune")) {
      return "sand";
    }
    if (f.hasTag("natural", "bare_rock", "scree", "shingle")) {
      return "rock";
    }
    if (f.hasTag("natural", "scrub", "heath")) {
      return "scrub";
    }
    if (f.hasTag("landuse", "grass", "meadow") || f.hasTag("natural", "grassland")) {
      return "grass";
    }
    if (f.hasTag("landuse", "farmland", "orchard", "vineyard", "plant_nursery", "greenhouse_horticulture",
      "farmyard", "allotments", "aquaculture")) {
      return "farmland";
    }
    if (f.hasTag("aeroway", "aerodrome")) {
      return "aerodrome";
    }
    if (f.hasTag("aeroway", "apron")) {
      return "apron";
    }
    if (f.hasTag("landuse", "cemetery") || f.hasTag("amenity", "grave_yard")) {
      return "cemetery";
    }
    if (f.hasTag("amenity", "hospital", "clinic")) {
      return "hospital";
    }
    if (f.hasTag("amenity", "school", "university", "college", "kindergarten")) {
      return "school";
    }
    if (f.hasTag("leisure", "stadium", "sports_centre", "pitch", "track")) {
      return "sports";
    }
    if (f.hasTag("amenity", "parking") && !f.hasTag("parking", "underground", "multi-storey", "rooftop")) {
      return "parking";
    }
    if (f.hasTag("landuse", "military")) {
      return "military";
    }
    if (f.hasTag("landuse", "residential")) {
      return "residential";
    }
    if (f.hasTag("landuse", "commercial", "retail")) {
      return "commercial";
    }
    if (f.hasTag("landuse", "industrial", "railway", "port", "quarry", "landfill")) {
      return "industrial";
    }
    if (f.hasTag("landuse", "construction", "brownfield")) {
      return "construction";
    }
    return null;
  }

  static int minZoom(String landuseClass) {
    return switch (landuseClass) {
      case "forest", "wetland", "glacier", "sand", "rock", "scrub", "grass", "farmland" -> 7;
      case "park", "residential", "commercial", "industrial", "military", "aerodrome" -> 9;
      default -> 12;
    };
  }

  @Override
  public void processOsm(SourceFeature feature, FeatureCollector features) {
    if (!feature.canBePolygon()) {
      return;
    }
    String landuseClass = landuseClass(feature);
    if (landuseClass == null) {
      return;
    }
    var polygon = features.polygon(NAME)
      .setAttr("class", landuseClass)
      .setMinZoom(minZoom(landuseClass))
      .setMinPixelSizeBelowZoom(12, 2);
    if (landuseClass.equals("wetland")) {
      polygon.setAttr("subclass", Tags.lower(feature, "wetland"));
    }
  }

  @Override
  public List<VectorTile.Feature> postProcess(int zoom, List<VectorTile.Feature> items) throws GeometryException {
    if (zoom >= Zooms.MAX) {
      return items;
    }
    // Neighbouring polygons of the same class are merged at lower zooms to keep tiles small.
    return FeatureMerge.mergeNearbyPolygons(items, 1, 1, 0.5, 0.5);
  }
}
