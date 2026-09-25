package com.mapsplatform.tilegen.layers;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.reader.SourceFeature;

/**
 * {@code place}: label points of countries, provinces, cities, towns, villages, suburbs, neighbourhoods and islands.
 * Attributes: {@code class}, {@code rank} (1 = most important), {@code population}, {@code capital} and names.
 */
public final class PlaceLayer implements Layer {

  public static final String NAME = "place";
  /** Label density limit below z13: at most this many places per grid cell, most important first. */
  static final int LABEL_GRID_PIXELS = 32;
  static final int LABEL_GRID_LIMIT = 4;

  public record PlaceClass(String className, int rank, int minZoom) {}

  @Override
  public String name() {
    return NAME;
  }

  public static PlaceClass classify(String place, long population) {
    if (place == null) {
      return null;
    }
    return switch (place) {
      case "country" -> new PlaceClass("country", 1, 2);
      case "state", "province", "region" -> new PlaceClass("state", 2, 4);
      case "city" -> new PlaceClass("city", 3, population >= 1_000_000 ? 4 : population >= 250_000 ? 5 : 6);
      case "town" -> new PlaceClass("town", 4, population >= 50_000 ? 7 : 8);
      case "village" -> new PlaceClass("village", 5, 11);
      case "island" -> new PlaceClass("island", 5, 8);
      case "suburb", "borough" -> new PlaceClass("suburb", 6, 11);
      case "quarter" -> new PlaceClass("quarter", 6, 13);
      case "neighbourhood" -> new PlaceClass("neighbourhood", 7, 13);
      case "hamlet" -> new PlaceClass("hamlet", 7, 13);
      case "islet" -> new PlaceClass("islet", 7, 13);
      case "locality", "isolated_dwelling", "square", "farm" -> new PlaceClass("locality", 8, Zooms.MAX);
      default -> null;
    };
  }

  /**
   * Lower sorts first: rank, then larger population. Planetiler sort keys must fit in 22 bits, so population is
   * counted in hundreds and capped at 10 million.
   */
  static int sortKey(int rank, long population) {
    long populationScore = Math.min(99_999, population / 100);
    return (int) (rank * 100_000L + (99_999 - populationScore));
  }

  @Override
  public void processOsm(SourceFeature feature, FeatureCollector features) {
    if (!Tags.hasName(feature)) {
      return;
    }
    String place = Tags.lower(feature, "place");
    Long parsedPopulation = Tags.nonNegativeLong(feature.getTag("population"));
    long population = parsedPopulation == null ? 0 : parsedPopulation;
    PlaceClass placeClass = classify(place, population);
    if (placeClass == null) {
      return;
    }
    FeatureCollector.Feature point;
    int minZoom = placeClass.minZoom();
    if (feature.isPoint()) {
      point = features.point(NAME);
    } else if (feature.canBePolygon() && (place.equals("island") || place.equals("islet"))) {
      // Islands mapped as areas are labelled once they are large enough on screen.
      minZoom = Math.max(minZoom, features.getMinZoomForPixelSize(16));
      if (minZoom > Zooms.MAX) {
        return;
      }
      point = features.pointOnSurface(NAME);
    } else {
      // Areas of cities/suburbs usually duplicate the place node, which carries the label.
      return;
    }
    point.setAttr("class", placeClass.className())
      .setAttr("rank", placeClass.rank())
      .setMinZoom(minZoom)
      .setSortKey(sortKey(placeClass.rank(), population))
      .setPointLabelGridSizeAndLimit(12, LABEL_GRID_PIXELS, LABEL_GRID_LIMIT)
      .setBufferPixels(LABEL_GRID_PIXELS);
    if (population > 0) {
      point.setAttr("population", population);
    }
    String capital = Tags.lower(feature, "capital");
    if (capital != null && !capital.equals("no")) {
      point.setAttr("capital", capital.equals("yes") ? "2" : capital);
    }
    Tags.setNames(point, feature, minZoom);
  }
}
