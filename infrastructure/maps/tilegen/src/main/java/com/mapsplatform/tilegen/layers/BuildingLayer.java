package com.mapsplatform.tilegen.layers;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.FeatureMerge;
import com.onthegomap.planetiler.VectorTile;
import com.onthegomap.planetiler.geo.GeometryException;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.WithTags;
import java.util.List;

/** {@code building}: building footprints with optional {@code height} / {@code min_height} in meters. */
public final class BuildingLayer implements Layer {

  public static final String NAME = "building";
  static final int MIN_ZOOM = 13;
  /** Used when only {@code building:levels} is known. */
  static final double METERS_PER_LEVEL = 3;

  @Override
  public String name() {
    return NAME;
  }

  public static boolean isBuilding(WithTags feature) {
    return feature.hasTag("building") && !feature.hasTag("building", "no", "none") &&
      !feature.hasTag("location", "underground");
  }

  @Override
  public void processOsm(SourceFeature feature, FeatureCollector features) {
    if (!feature.canBePolygon() || !isBuilding(feature)) {
      return;
    }
    var polygon = features.polygon(NAME)
      .setMinZoom(MIN_ZOOM)
      .setMinPixelSizeBelowZoom(Zooms.MAX - 1, 2);

    Double height = Tags.meters(feature.getTag("height"));
    if (height == null) {
      Double levels = Tags.meters(feature.getTag("building:levels"));
      height = levels == null ? null : levels * METERS_PER_LEVEL;
    }
    Double minHeight = Tags.meters(feature.getTag("min_height"));
    if (minHeight == null) {
      Double minLevel = Tags.meters(feature.getTag("building:min_level"));
      minHeight = minLevel == null ? null : minLevel * METERS_PER_LEVEL;
    }
    if (height != null && height > 0 && height < 1000) {
      polygon.setAttrWithMinzoom("height", Math.round(height * 10) / 10d, Zooms.MAX);
      if (minHeight != null && minHeight > 0 && minHeight < height) {
        polygon.setAttrWithMinzoom("min_height", Math.round(minHeight * 10) / 10d, Zooms.MAX);
      }
    }
  }

  @Override
  public List<VectorTile.Feature> postProcess(int zoom, List<VectorTile.Feature> items) throws GeometryException {
    // At z13 adjacent footprints are merged into blocks; full detail from z14 on.
    return zoom >= Zooms.MAX ? items : FeatureMerge.mergeNearbyPolygons(items, 4, 4, 0.5, 0.5);
  }
}
