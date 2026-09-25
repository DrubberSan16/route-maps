package com.mapsplatform.tilegen.layers;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.reader.WithTags;
import com.onthegomap.planetiler.util.Parse;
import java.util.Locale;

/** Tag helpers shared by the layers. */
public final class Tags {

  private Tags() {}

  /**
   * Copies {@code name}, {@code name_es} and {@code name_en} starting at {@code minzoom}. Localized names are only
   * written when they differ from {@code name}; styles use {@code coalesce(name_es, name)}.
   */
  public static void setNames(FeatureCollector.Feature feature, WithTags source, int minzoom) {
    String name = trimmed(source.getString("name"));
    if (name == null) {
      return;
    }
    feature.setAttrWithMinzoom("name", name, minzoom);
    setLocalized(feature, source, "name:es", "name_es", name, minzoom);
    setLocalized(feature, source, "name:en", "name_en", name, minzoom);
  }

  private static void setLocalized(FeatureCollector.Feature feature, WithTags source, String tag, String attr,
    String name, int minzoom) {
    String value = trimmed(source.getString(tag));
    if (value != null && !value.equals(name)) {
      feature.setAttrWithMinzoom(attr, value, minzoom);
    }
  }

  public static boolean hasName(WithTags source) {
    return trimmed(source.getString("name")) != null;
  }

  /** Returns the value without surrounding blanks, or {@code null} when empty. */
  public static String trimmed(String value) {
    if (value == null) {
      return null;
    }
    String result = value.strip();
    return result.isEmpty() ? null : result;
  }

  /** Lower-case tag value, or {@code null}. */
  public static String lower(WithTags source, String key) {
    String value = trimmed(source.getString(key));
    return value == null ? null : value.toLowerCase(Locale.ROOT);
  }

  /** Parses a length in meters ({@code 12}, {@code 12.5}, {@code 12 m}, {@code 40'}); {@code null} if invalid. */
  public static Double meters(Object value) {
    if (value == null) {
      return null;
    }
    Double result = Parse.meters(value.toString().strip());
    return result != null && Double.isFinite(result) && result >= 0 ? result : null;
  }

  /** Parses a non-negative integer such as {@code population}; {@code null} if invalid. */
  public static Long nonNegativeLong(Object value) {
    if (value == null) {
      return null;
    }
    Long parsed = Parse.parseLongOrNull(value.toString().replace(" ", "").replace(",", "").replace(".", ""));
    return parsed != null && parsed >= 0 ? parsed : null;
  }

  /** True for {@code yes}, {@code true} and {@code 1}. */
  public static boolean isYes(WithTags source, String key) {
    return Parse.bool(source.getTag(key));
  }
}
