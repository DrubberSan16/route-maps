package com.mapsplatform.tilegen.layers;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.WithTags;
import java.util.Set;

/**
 * {@code poi}: points of interest. Areas (for example a hospital mapped as a building) are reduced to a point inside
 * the area. Attributes: {@code class} (icon category), {@code subclass} (raw OSM value), {@code rank} (1 = most
 * important), names and {@code iata} for airports.
 */
public final class PoiLayer implements Layer {

  public static final String NAME = "poi";
  static final int LABEL_GRID_PIXELS = 32;
  static final int LABEL_GRID_LIMIT = 4;
  /** Categories that are useful even without a name (drawn as icons only). */
  static final Set<String> UNNAMED_ALLOWED = Set.of("fuel", "bus_stop", "bank", "charging_station", "pharmacy");

  public record PoiClass(String className, String subclass, int minZoom, int rank) {}

  @Override
  public String name() {
    return NAME;
  }

  public static PoiClass classify(WithTags f) {
    PoiClass result = classifyAmenity(f);
    if (result == null) {
      result = classifyTransport(f);
    }
    if (result == null) {
      result = classifyShop(f);
    }
    if (result == null) {
      result = classifyLeisureAndTourism(f);
    }
    if (result == null && f.hasTag("healthcare")) {
      result = new PoiClass("health", Tags.lower(f, "healthcare"), Zooms.MAX, 20);
    }
    if (result == null && f.hasTag("office", "government")) {
      result = new PoiClass("government", "office", Zooms.MAX, 20);
    }
    return result;
  }

  private static PoiClass classifyAmenity(WithTags f) {
    String amenity = Tags.lower(f, "amenity");
    if (amenity == null) {
      return null;
    }
    return switch (amenity) {
      case "restaurant", "fast_food", "food_court" -> new PoiClass("food", amenity, Zooms.MAX, 30);
      case "cafe", "ice_cream" -> new PoiClass("cafe", amenity, Zooms.MAX, 30);
      case "bar", "pub", "biergarten", "nightclub" -> new PoiClass("bar", amenity, Zooms.MAX, 35);
      case "hospital" -> new PoiClass("hospital", amenity, 12, 5);
      case "clinic", "doctors", "dentist" -> new PoiClass("health", amenity, Zooms.MAX, 20);
      case "pharmacy" -> new PoiClass("pharmacy", amenity, Zooms.MAX, 15);
      case "university", "college" -> new PoiClass("college", amenity, 13, 10);
      case "school", "kindergarten" -> new PoiClass("school", amenity, Zooms.MAX, 20);
      case "library" -> new PoiClass("library", amenity, Zooms.MAX, 25);
      case "bank", "atm", "bureau_de_change" -> new PoiClass("bank", amenity, Zooms.MAX, 25);
      case "fuel" -> new PoiClass("fuel", amenity, 13, 15);
      case "charging_station" -> new PoiClass("charging_station", amenity, Zooms.MAX, 25);
      case "parking" -> new PoiClass("parking", amenity, Zooms.MAX, 40);
      case "bus_station" -> new PoiClass("bus_station", amenity, 12, 8);
      case "ferry_terminal" -> new PoiClass("ferry_terminal", amenity, 12, 8);
      case "taxi" -> new PoiClass("taxi", amenity, Zooms.MAX, 40);
      case "police", "fire_station" -> new PoiClass("emergency", amenity, Zooms.MAX, 15);
      case "townhall", "courthouse", "embassy" -> new PoiClass("government", amenity, 13, 12);
      case "post_office" -> new PoiClass("post", amenity, Zooms.MAX, 25);
      case "place_of_worship" -> new PoiClass("worship", amenity, Zooms.MAX, 25);
      case "theatre", "cinema", "arts_centre" -> new PoiClass("culture", amenity, Zooms.MAX, 20);
      case "marketplace" -> new PoiClass("market", amenity, Zooms.MAX, 20);
      default -> null;
    };
  }

  private static PoiClass classifyTransport(WithTags f) {
    if (f.hasTag("aeroway", "aerodrome")) {
      return new PoiClass("airport", "aerodrome", f.hasTag("iata") ? 9 : 11, 1);
    }
    if (f.hasTag("aeroway", "terminal")) {
      return new PoiClass("airport", "terminal", 13, 10);
    }
    if (f.hasTag("railway", "station", "halt")) {
      return new PoiClass("railway_station", Tags.lower(f, "railway"), 12, 5);
    }
    if (f.hasTag("railway", "tram_stop")) {
      return new PoiClass("tram_stop", "tram_stop", Zooms.MAX, 30);
    }
    if (f.hasTag("public_transport", "station")) {
      return new PoiClass("transit_station", "station", 13, 10);
    }
    if (f.hasTag("highway", "bus_stop")) {
      return new PoiClass("bus_stop", "bus_stop", Zooms.MAX, 45);
    }
    return null;
  }

  private static PoiClass classifyShop(WithTags f) {
    String shop = Tags.lower(f, "shop");
    if (shop == null || shop.equals("no") || shop.equals("vacant")) {
      return null;
    }
    return switch (shop) {
      case "mall", "department_store" -> new PoiClass("mall", shop, 13, 10);
      case "supermarket" -> new PoiClass("supermarket", shop, Zooms.MAX, 20);
      case "convenience", "bakery", "butcher", "greengrocer", "grocery" -> new PoiClass("grocery", shop, Zooms.MAX, 30);
      default -> new PoiClass("shop", shop, Zooms.MAX, 40);
    };
  }

  private static PoiClass classifyLeisureAndTourism(WithTags f) {
    String tourism = Tags.lower(f, "tourism");
    if (tourism != null) {
      PoiClass result = switch (tourism) {
        case "hotel", "motel", "hostel", "guest_house", "apartment" -> new PoiClass("lodging", tourism, Zooms.MAX, 25);
        case "camp_site", "caravan_site" -> new PoiClass("campsite", tourism, 13, 25);
        case "museum", "gallery" -> new PoiClass("museum", tourism, 13, 10);
        case "attraction", "viewpoint", "theme_park", "zoo", "aquarium" ->
          new PoiClass("attraction", tourism, 13, 10);
        default -> null;
      };
      if (result != null) {
        return result;
      }
    }
    String leisure = Tags.lower(f, "leisure");
    if (leisure != null) {
      PoiClass result = switch (leisure) {
        case "park", "garden", "nature_reserve" -> new PoiClass("park", leisure, 12, 15);
        case "stadium" -> new PoiClass("stadium", leisure, 13, 8);
        case "sports_centre", "fitness_centre", "swimming_pool" -> new PoiClass("sports", leisure, Zooms.MAX, 30);
        case "playground" -> new PoiClass("playground", leisure, Zooms.MAX, 45);
        default -> null;
      };
      if (result != null) {
        return result;
      }
    }
    if (f.hasTag("boundary", "national_park")) {
      return new PoiClass("park", "national_park", 8, 3);
    }
    String historic = Tags.lower(f, "historic");
    if (historic != null && Set.of("monument", "memorial", "castle", "ruins", "archaeological_site", "fort")
      .contains(historic)) {
      return new PoiClass("historic", historic, Zooms.MAX, 20);
    }
    return null;
  }

  @Override
  public void processOsm(SourceFeature feature, FeatureCollector features) {
    PoiClass poi = classify(feature);
    if (poi == null) {
      return;
    }
    boolean named = Tags.hasName(feature);
    if (!named && !UNNAMED_ALLOWED.contains(poi.className())) {
      return;
    }
    int minZoom = poi.minZoom();
    FeatureCollector.Feature point;
    if (feature.isPoint()) {
      point = features.point(NAME);
    } else if (feature.canBePolygon()) {
      if (poi.className().equals("park")) {
        // Park labels appear once the park is reasonably large on screen.
        minZoom = Math.max(minZoom, Math.min(Zooms.MAX, features.getMinZoomForPixelSize(48)));
      }
      point = features.pointOnSurface(NAME);
    } else {
      return;
    }
    point.setAttr("class", poi.className())
      .setAttr("subclass", poi.subclass())
      .setAttr("rank", poi.rank())
      .setMinZoom(minZoom)
      .setSortKey(poi.rank())
      .setPointLabelGridSizeAndLimit(Zooms.MAX - 1, LABEL_GRID_PIXELS, LABEL_GRID_LIMIT)
      .setBufferPixels(LABEL_GRID_PIXELS);
    if (poi.className().equals("airport")) {
      String iata = Tags.trimmed(feature.getString("iata"));
      if (iata != null && iata.length() == 3) {
        point.setAttr("iata", iata);
      }
    }
    Tags.setNames(point, feature, minZoom);
  }
}
