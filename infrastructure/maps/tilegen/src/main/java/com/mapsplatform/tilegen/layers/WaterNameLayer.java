package com.mapsplatform.tilegen.layers;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.reader.SourceFeature;

/**
 * {@code water_name}: label points of named water bodies (lakes, lagoons, reservoirs) and of seas and bays mapped as
 * nodes. Rivers are labelled along their {@code waterway} lines instead.
 */
public final class WaterNameLayer implements Layer {

  public static final String NAME = "water_name";

  /** A water body gets a label once it is at least this many pixels across. */
  static final double LABEL_MIN_PIXELS = 32;

  @Override
  public String name() {
    return NAME;
  }

  @Override
  public void processOsm(SourceFeature feature, FeatureCollector features) {
    if (!Tags.hasName(feature)) {
      return;
    }
    if (feature.isPoint()) {
      String seaClass = seaClass(feature);
      if (seaClass != null) {
        int minZoom = switch (seaClass) {
          case "ocean" -> 0;
          case "sea" -> 3;
          default -> 8;
        };
        var point = features.point(NAME).setAttr("class", seaClass).setMinZoom(minZoom);
        Tags.setNames(point, feature, minZoom);
      }
      return;
    }
    if (!feature.canBePolygon()) {
      return;
    }
    String waterClass = WaterLayer.waterClass(feature);
    if (waterClass == null && feature.hasTag("natural", "bay", "strait")) {
      waterClass = "bay";
    }
    if (waterClass == null || waterClass.equals("river")) {
      return;
    }
    int minZoom = Math.max(WaterLayer.minZoom(waterClass), features.getMinZoomForPixelSize(LABEL_MIN_PIXELS));
    if (minZoom > Zooms.MAX) {
      return;
    }
    var point = features.pointOnSurface(NAME).setAttr("class", waterClass).setMinZoom(minZoom);
    Tags.setNames(point, feature, minZoom);
  }

  private static String seaClass(SourceFeature feature) {
    if (feature.hasTag("place", "ocean")) {
      return "ocean";
    }
    if (feature.hasTag("place", "sea")) {
      return "sea";
    }
    if (feature.hasTag("natural", "bay", "strait")) {
      return "bay";
    }
    return null;
  }
}
