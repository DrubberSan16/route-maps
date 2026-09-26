package com.mapsplatform.tilegen.layers;

import java.io.IOException;
import java.io.Writer;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Queue;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Countries and cities of the world base map, written as JSON ({@code world.places.json}) for the place search of the
 * backend. Places are collected from Planetiler's worker threads while the Natural Earth sources are read.
 */
public final class PlaceIndex {

  /**
   * @param type        {@code country} or {@code city}
   * @param countryKey  Natural Earth country id ({@code ADM0_A3}) linking cities to their country
   * @param capital     "2" national capital, "4" provincial capital, {@code null} otherwise
   * @param bbox        {@code [minLng, minLat, maxLng, maxLat]} of countries, {@code null} for cities
   */
  public record Place(String type, String name, String nameEs, String countryCode, String countryKey, String admin1,
    String capital, double latitude, double longitude, long population, double[] bbox) {}

  private final Queue<Place> places = new ConcurrentLinkedQueue<>();

  public void add(Place place) {
    places.add(place);
  }

  public List<Place> places() {
    return List.copyOf(places);
  }

  /** Writes the index: countries first, then by population, with each city's country names resolved. */
  public void write(Path file) throws IOException {
    Map<String, Place> countries = new HashMap<>();
    for (Place place : places) {
      if (place.type().equals("country") && place.countryKey() != null) {
        countries.putIfAbsent(place.countryKey(), place);
      }
    }
    List<Place> sorted = new ArrayList<>(places);
    sorted.sort(Comparator.comparing((Place place) -> !place.type().equals("country"))
      .thenComparing(Place::population, Comparator.reverseOrder())
      .thenComparing(Place::name));
    try (Writer out = Files.newBufferedWriter(file, StandardCharsets.UTF_8)) {
      out.write("{\"version\":1,\"source\":\"Natural Earth\",\"places\":[\n");
      for (int i = 0; i < sorted.size(); i++) {
        out.write(toJson(sorted.get(i), countries));
        out.write(i + 1 < sorted.size() ? ",\n" : "\n");
      }
      out.write("]}\n");
    }
  }

  static String toJson(Place place, Map<String, Place> countries) {
    Place country = place.type().equals("country") ? place : countries.get(place.countryKey());
    StringBuilder json = new StringBuilder("{");
    string(json, "type", place.type());
    string(json, "name", place.name());
    if (place.nameEs() != null && !place.nameEs().equals(place.name())) {
      string(json, "nameEs", place.nameEs());
    }
    String code = place.countryCode() != null ? place.countryCode() : country == null ? null : country.countryCode();
    string(json, "countryCode", code);
    if (country != null) {
      string(json, "country", country.name());
      if (country.nameEs() != null && !country.nameEs().equals(country.name())) {
        string(json, "countryEs", country.nameEs());
      }
    }
    string(json, "admin1", place.admin1());
    string(json, "capital", place.capital());
    number(json, "lat", place.latitude(), 5);
    number(json, "lng", place.longitude(), 5);
    json.append(",\"population\":").append(place.population());
    if (place.bbox() != null) {
      json.append(",\"bbox\":[");
      for (int i = 0; i < place.bbox().length; i++) {
        json.append(i == 0 ? "" : ",").append(format(place.bbox()[i], 4));
      }
      json.append(']');
    }
    return json.append('}').toString();
  }

  private static void string(StringBuilder json, String key, String value) {
    if (value == null) {
      return;
    }
    if (json.length() > 1) {
      json.append(',');
    }
    json.append('"').append(key).append("\":\"");
    for (int i = 0; i < value.length(); i++) {
      char c = value.charAt(i);
      switch (c) {
        case '"' -> json.append("\\\"");
        case '\\' -> json.append("\\\\");
        case '\n' -> json.append("\\n");
        case '\r' -> json.append("\\r");
        case '\t' -> json.append("\\t");
        default -> {
          if (c < 0x20) {
            json.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
          } else {
            json.append(c);
          }
        }
      }
    }
    json.append('"');
  }

  private static void number(StringBuilder json, String key, double value, int decimals) {
    json.append(",\"").append(key).append("\":").append(format(value, decimals));
  }

  private static String format(double value, int decimals) {
    return BigDecimal.valueOf(value).setScale(decimals, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString();
  }
}
