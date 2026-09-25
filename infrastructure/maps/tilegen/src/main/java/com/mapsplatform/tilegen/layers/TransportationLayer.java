package com.mapsplatform.tilegen.layers;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.FeatureMerge;
import com.onthegomap.planetiler.VectorTile;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.WithTags;
import com.onthegomap.planetiler.util.Parse;
import java.util.List;

/**
 * {@code transportation}: roads, paths, railways, ferries, runways and aerial lifts as lines.
 * <p>
 * Classes: motorway, trunk, primary, secondary, tertiary, minor, busway, service, track, path, rail, transit, ferry,
 * runway, taxiway, aerialway. Attributes: {@code subclass}, {@code ramp}, {@code brunnel} (bridge / tunnel / ford),
 * {@code layer}, {@code oneway} (1 / -1), {@code surface} (paved / unpaved), {@code access} ("no"), {@code ref} and
 * names.
 */
public final class TransportationLayer implements Layer {

  public static final String NAME = "transportation";

  /** Output class, zoom where the line appears, and whether it is a link road. */
  public record RoadClass(String className, int minZoom, boolean ramp, String subclass) {

    RoadClass(String className, int minZoom) {
      this(className, minZoom, false, null);
    }
  }

  @Override
  public String name() {
    return NAME;
  }

  public static RoadClass classify(WithTags f) {
    String highway = Tags.lower(f, "highway");
    if (highway != null) {
      return classifyHighway(highway);
    }
    String railway = Tags.lower(f, "railway");
    if (railway != null) {
      return switch (railway) {
        case "rail", "narrow_gauge", "preserved" ->
          f.hasTag("service") ? new RoadClass("rail", 13, false, "service") : new RoadClass("rail", 9);
        case "subway", "light_rail", "tram", "monorail", "funicular" -> new RoadClass("transit", 11, false, railway);
        default -> null;
      };
    }
    if (f.hasTag("route", "ferry")) {
      return new RoadClass("ferry", 7);
    }
    if (f.hasTag("aeroway", "runway")) {
      return new RoadClass("runway", 10);
    }
    if (f.hasTag("aeroway", "taxiway")) {
      return new RoadClass("taxiway", 13);
    }
    if (f.hasTag("aerialway", "cable_car", "gondola", "chair_lift", "mixed_lift")) {
      return new RoadClass("aerialway", 12);
    }
    return null;
  }

  private static RoadClass classifyHighway(String highway) {
    return switch (highway) {
      case "motorway" -> new RoadClass("motorway", 4);
      case "motorway_link" -> new RoadClass("motorway", 9, true, null);
      case "trunk" -> new RoadClass("trunk", 5);
      case "trunk_link" -> new RoadClass("trunk", 9, true, null);
      case "primary" -> new RoadClass("primary", 7);
      case "primary_link" -> new RoadClass("primary", 11, true, null);
      case "secondary" -> new RoadClass("secondary", 9);
      case "secondary_link" -> new RoadClass("secondary", 11, true, null);
      case "tertiary" -> new RoadClass("tertiary", 10);
      case "tertiary_link" -> new RoadClass("tertiary", 12, true, null);
      case "unclassified", "residential", "living_street", "road" -> new RoadClass("minor", 12, false, highway);
      case "busway", "bus_guideway" -> new RoadClass("busway", 12);
      case "service" -> new RoadClass("service", 13);
      case "track" -> new RoadClass("track", 13);
      case "pedestrian" -> new RoadClass("path", 13, false, "pedestrian");
      case "footway", "path", "cycleway", "bridleway", "steps", "corridor" -> new RoadClass("path", 14, false, highway);
      default -> null;
    };
  }

  static int nameMinZoom(String roadClass) {
    return switch (roadClass) {
      case "motorway", "trunk", "primary", "secondary" -> 10;
      case "tertiary", "busway", "transit", "ferry", "aerialway" -> 12;
      case "minor" -> 13;
      default -> Zooms.MAX;
    };
  }

  static String brunnel(WithTags f) {
    if (f.hasTag("bridge") && !f.hasTag("bridge", "no")) {
      return "bridge";
    }
    if ((f.hasTag("tunnel") && !f.hasTag("tunnel", "no")) || f.hasTag("covered", "yes")) {
      return "tunnel";
    }
    if (f.hasTag("ford") && !f.hasTag("ford", "no")) {
      return "ford";
    }
    return null;
  }

  static String surface(WithTags f) {
    String surface = Tags.lower(f, "surface");
    if (surface == null) {
      return null;
    }
    return switch (surface) {
      case "paved", "asphalt", "concrete", "concrete:plates", "concrete:lanes", "paving_stones", "sett", "cobblestone",
        "metal", "wood", "unhewn_cobblestone", "bricks", "chipseal" -> "paved";
      case "unpaved", "compacted", "dirt", "earth", "fine_gravel", "grass", "grass_paver", "gravel", "ground", "mud",
        "pebblestone", "rock", "salt", "sand", "woodchips" -> "unpaved";
      default -> null;
    };
  }

  @Override
  public void processOsm(SourceFeature feature, FeatureCollector features) {
    if (!feature.canBeLine()) {
      return;
    }
    RoadClass road = classify(feature);
    if (road == null) {
      return;
    }
    var line = features.line(NAME)
      .setAttr("class", road.className())
      .setMinZoom(road.minZoom())
      .setMinPixelSize(0)
      .setSortKey(feature.getWayZorder());
    if (road.subclass() != null) {
      line.setAttr("subclass", road.subclass());
    }
    if (road.ramp()) {
      line.setAttr("ramp", true);
    }
    String brunnel = brunnel(feature);
    if (brunnel != null) {
      line.setAttrWithMinzoom("brunnel", brunnel, 12);
    }
    Integer layer = Parse.parseIntOrNull(feature.getTag("layer"));
    if (layer != null && layer != 0 && Math.abs(layer) <= 10) {
      line.setAttrWithMinzoom("layer", layer, 13);
    }
    int oneway = feature.getDirection("oneway");
    if (oneway != 0) {
      line.setAttrWithMinzoom("oneway", oneway, Zooms.MAX);
    }
    String surface = surface(feature);
    if (surface != null) {
      line.setAttrWithMinzoom("surface", surface, 13);
    }
    if (feature.hasTag("access", "no", "private") && !feature.hasTag("highway", "motorway", "trunk")) {
      line.setAttrWithMinzoom("access", "no", Zooms.MAX);
    }
    String ref = Tags.trimmed(feature.getString("ref"));
    if (ref != null && ref.length() <= 20) {
      line.setAttrWithMinzoom("ref", ref, Math.max(road.minZoom(), 8));
    }
    Tags.setNames(line, feature, Math.max(road.minZoom(), nameMinZoom(road.className())));
  }

  @Override
  public List<VectorTile.Feature> postProcess(int zoom, List<VectorTile.Feature> items) {
    // Segments with identical attributes are joined below the max zoom (fewer, longer lines; drops tiny pieces).
    return zoom >= Zooms.MAX ? items : FeatureMerge.mergeLineStrings(items, 0.5, 0.1, 4);
  }
}
