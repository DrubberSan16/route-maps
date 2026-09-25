package com.mapsplatform.tilegen.layers;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.FeatureMerge;
import com.onthegomap.planetiler.VectorTile;
import com.onthegomap.planetiler.reader.SourceFeature;
import java.util.List;

/** {@code waterway}: rivers, canals and streams as lines. Classes: river, canal, stream, drain. */
public final class WaterwayLayer implements Layer {

  public static final String NAME = "waterway";

  @Override
  public String name() {
    return NAME;
  }

  static String waterwayClass(SourceFeature feature) {
    String waterway = Tags.lower(feature, "waterway");
    if (waterway == null) {
      return null;
    }
    return switch (waterway) {
      case "river" -> "river";
      case "canal" -> "canal";
      case "stream", "tidal_channel", "brook" -> "stream";
      case "drain", "ditch" -> "drain";
      default -> null;
    };
  }

  @Override
  public void processOsm(SourceFeature feature, FeatureCollector features) {
    if (!feature.canBeLine()) {
      return;
    }
    String waterwayClass = waterwayClass(feature);
    if (waterwayClass == null) {
      return;
    }
    int minZoom = switch (waterwayClass) {
      case "river" -> 8;
      case "canal" -> 11;
      case "stream" -> 12;
      default -> 13;
    };
    var line = features.line(NAME)
      .setAttr("class", waterwayClass)
      .setMinZoom(minZoom)
      .setMinPixelSize(0);
    if (feature.hasTag("tunnel", "yes", "culvert") || feature.hasTag("location", "underground")) {
      line.setAttr("brunnel", "tunnel");
    }
    if (Tags.isYes(feature, "intermittent")) {
      line.setAttr("intermittent", true);
    }
    Tags.setNames(line, feature, Math.max(minZoom, 10));
  }

  @Override
  public List<VectorTile.Feature> postProcess(int zoom, List<VectorTile.Feature> items) {
    return zoom >= Zooms.MAX ? items : FeatureMerge.mergeLineStrings(items, 0.5, 0.1, 4);
  }
}
