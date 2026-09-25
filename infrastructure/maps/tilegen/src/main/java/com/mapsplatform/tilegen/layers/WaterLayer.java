package com.mapsplatform.tilegen.layers;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.FeatureMerge;
import com.onthegomap.planetiler.VectorTile;
import com.onthegomap.planetiler.geo.GeometryException;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.WithTags;
import java.util.List;

/**
 * {@code water}: water bodies as polygons. Classes: ocean, lake, reservoir, lagoon, river, pond, basin, dock.
 * <p>
 * Oceans only exist when the optional coastline water polygons are passed to the generator ({@code --water_polygons}),
 * because OpenStreetMap models the sea as coastline ways, not as polygons.
 */
public final class WaterLayer implements Layer {

  public static final String NAME = "water";

  @Override
  public String name() {
    return NAME;
  }

  /** Water class of an OSM area or {@code null} when the element is not a visible water body. */
  public static String waterClass(WithTags feature) {
    if (feature.hasTag("covered", "yes") || feature.hasTag("location", "underground") ||
      feature.hasTag("tunnel", "yes", "culvert")) {
      return null;
    }
    if (feature.hasTag("natural", "water")) {
      String water = Tags.lower(feature, "water");
      if (water == null) {
        return "lake";
      }
      return switch (water) {
        case "river", "stream", "canal", "ditch", "drain", "oxbow", "rapids", "lock" -> "river";
        case "reservoir" -> "reservoir";
        case "lagoon" -> "lagoon";
        case "pond", "fishpond", "moat" -> "pond";
        case "basin", "wastewater", "reflecting_pool", "pool" -> "basin";
        default -> "lake";
      };
    }
    if (feature.hasTag("waterway", "riverbank")) {
      return "river";
    }
    if (feature.hasTag("waterway", "dock")) {
      return "dock";
    }
    if (feature.hasTag("landuse", "reservoir")) {
      return "reservoir";
    }
    if (feature.hasTag("landuse", "basin")) {
      return "basin";
    }
    return null;
  }

  static int minZoom(String waterClass) {
    return switch (waterClass) {
      case "ocean" -> 0;
      case "lake", "reservoir", "lagoon" -> 4;
      case "river" -> 6;
      default -> 10;
    };
  }

  @Override
  public void processOsm(SourceFeature feature, FeatureCollector features) {
    if (!feature.canBePolygon()) {
      return;
    }
    String waterClass = waterClass(feature);
    if (waterClass == null) {
      return;
    }
    var polygon = features.polygon(NAME)
      .setAttr("class", waterClass)
      .setMinZoom(minZoom(waterClass))
      .setMinPixelSizeBelowZoom(11, 2);
    if (Tags.isYes(feature, "intermittent") || feature.hasTag("seasonal", "yes")) {
      polygon.setAttr("intermittent", true);
    }
  }

  /** Features of the OSMCoastline "water-polygons-split-3857" shapefile. */
  public void processOcean(FeatureCollector features) {
    features.polygon(NAME)
      .setAttr("class", "ocean")
      .setMinZoom(0)
      .setMinPixelSizeAtAllZooms(0);
  }

  @Override
  public List<VectorTile.Feature> postProcess(int zoom, List<VectorTile.Feature> items) throws GeometryException {
    // Ocean pieces and neighbouring lakes of the same class become one polygon: smaller tiles, no seams.
    return FeatureMerge.mergeOverlappingPolygons(items, zoom >= Zooms.MAX ? 0 : 1);
  }
}
