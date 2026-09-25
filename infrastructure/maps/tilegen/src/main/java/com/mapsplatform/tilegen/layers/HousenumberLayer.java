package com.mapsplatform.tilegen.layers;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.reader.SourceFeature;

/** {@code housenumber}: address numbers at the max zoom (shown by clients from z17 when overzooming). */
public final class HousenumberLayer implements Layer {

  public static final String NAME = "housenumber";
  static final int MAX_LENGTH = 12;

  @Override
  public String name() {
    return NAME;
  }

  @Override
  public void processOsm(SourceFeature feature, FeatureCollector features) {
    String housenumber = Tags.trimmed(feature.getString("addr:housenumber"));
    if (housenumber == null || housenumber.length() > MAX_LENGTH) {
      return;
    }
    FeatureCollector.Feature point;
    if (feature.isPoint()) {
      point = features.point(NAME);
    } else if (feature.canBePolygon()) {
      point = features.pointOnSurface(NAME);
    } else {
      return;
    }
    point.setAttr("housenumber", housenumber).setMinZoom(Zooms.MAX);
  }
}
