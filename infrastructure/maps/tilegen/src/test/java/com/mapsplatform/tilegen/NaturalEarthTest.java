package com.mapsplatform.tilegen;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapsplatform.tilegen.layers.NaturalEarth;
import com.mapsplatform.tilegen.layers.PlaceIndex;
import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.config.PlanetilerConfig;
import com.onthegomap.planetiler.geo.GeoUtils;
import com.onthegomap.planetiler.reader.SimpleFeature;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.stats.Stats;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.GeometryFactory;

/** World base map built from the Natural Earth shapefiles. */
class NaturalEarthTest {

  private static final GeometryFactory GEOMETRY = new GeometryFactory();
  private static final double LNG = -78.5;
  private static final double LAT = -0.2;

  private final MapsPlatformProfile profile = new MapsPlatformProfile("Mundo", true);
  private final FeatureCollector.Factory collectors =
    new FeatureCollector.Factory(PlanetilerConfig.defaults(), Stats.inMemory());

  private static Geometry point() {
    return GEOMETRY.createPoint(new Coordinate(LNG, LAT));
  }

  private static Geometry line() {
    return GEOMETRY.createLineString(new Coordinate[]{new Coordinate(LNG, LAT), new Coordinate(LNG + 1, LAT + 0.5)});
  }

  private static Geometry square(double size) {
    return GEOMETRY.createPolygon(new Coordinate[]{
      new Coordinate(LNG, LAT), new Coordinate(LNG + size, LAT), new Coordinate(LNG + size, LAT + size),
      new Coordinate(LNG, LAT + size), new Coordinate(LNG, LAT)
    });
  }

  private static SourceFeature feature(String source, Geometry geometry, Map<String, Object> fields) {
    return SimpleFeature.create(geometry, new HashMap<>(fields), source, null, 1);
  }

  private List<FeatureCollector.Feature> process(SourceFeature feature) {
    FeatureCollector collector = collectors.get(feature);
    profile.processFeature(feature, collector);
    List<FeatureCollector.Feature> result = new ArrayList<>();
    collector.forEach(result::add);
    return result;
  }

  private static FeatureCollector.Feature single(List<FeatureCollector.Feature> features, String layer) {
    List<FeatureCollector.Feature> matching = features.stream().filter(f -> f.getLayer().equals(layer)).toList();
    assertEquals(1, matching.size(), () -> "expected one feature in " + layer + " but got " + features);
    return matching.getFirst();
  }

  @Test
  void usesTheNaturalEarthAttribution() {
    assertTrue(profile.attribution().contains("Natural Earth"));
    assertTrue(new MapsPlatformProfile("Ecuador", false).attribution().contains("OpenStreetMap"));
    assertTrue(profile.caresAboutSource(NaturalEarth.OCEAN));
  }

  @Test
  void oceanAndLakesAreWater() {
    var ocean = single(process(feature(NaturalEarth.OCEAN, square(10), Map.of("featurecla", "Ocean"))), "water");
    assertEquals("ocean", ocean.getAttrsAtZoom(0).get("class"));
    assertEquals(0, ocean.getMinZoom());

    List<FeatureCollector.Feature> lake = process(feature(NaturalEarth.LAKES, square(0.5), Map.of(
      "featurecla", "Lake", "name", "Lago Titicaca", "min_zoom", 3.2)));
    assertEquals(3, single(lake, "water").getMinZoom());
    assertEquals("lake", single(lake, "water").getAttrsAtZoom(5).get("class"));
    assertEquals("Lago Titicaca", single(lake, "water_name").getAttrsAtZoom(7).get("name"));

    assertTrue(process(feature(NaturalEarth.LAKES, square(0.1), Map.of("featurecla", "Lake", "min_zoom", 9.0)))
      .isEmpty(), "features only visible above the base map are dropped");
  }

  @Test
  void riversAreWaterwaysButLakeCenterlinesAreNot() {
    var river = single(process(feature(NaturalEarth.RIVERS, line(), Map.of(
      "featurecla", "River", "name", "Amazonas", "min_zoom", 4.1))), "waterway");
    assertEquals("river", river.getAttrsAtZoom(4).get("class"));
    assertEquals(4, river.getMinZoom());
    assertNull(river.getAttrsAtZoom(4).get("name"));
    assertEquals("Amazonas", river.getAttrsAtZoom(5).get("name"));
    assertTrue(process(feature(NaturalEarth.RIVERS, line(), Map.of("featurecla", "Lake Centerline"))).isEmpty());
  }

  @Test
  void marineAreasBecomeSeaLabels() {
    var pacific = single(process(feature(NaturalEarth.MARINE_AREAS, square(20), Map.of(
      "featurecla", "ocean", "name", "South Pacific Ocean", "name_es", "Océano Pacífico Sur", "min_label", 0.5))),
      "water_name");
    assertEquals("ocean", pacific.getAttrsAtZoom(0).get("class"));
    assertEquals("Océano Pacífico Sur", pacific.getAttrsAtZoom(0).get("name_es"));
    var gulf = single(process(feature(NaturalEarth.MARINE_AREAS, square(1), Map.of(
      "featurecla", "gulf", "name", "Golfo de Guayaquil", "min_label", 5.0))), "water_name");
    assertEquals("bay", gulf.getAttrsAtZoom(7).get("class"));
    assertEquals(5, gulf.getMinZoom());
  }

  @Test
  void countriesAreLabelledAtTheirLabelPointAndIndexed() {
    var label = single(process(feature(NaturalEarth.COUNTRIES, square(2), Map.of(
      "NAME", "Peru", "NAME_ES", "Perú", "ISO_A2_EH", "PE", "ISO_A2", "PE", "ADM0_A3", "PER",
      "LABEL_X", -77.0, "LABEL_Y", -0.1, "POP_EST", 32_510_453L, "MIN_LABEL", 3.0))), "place");
    Map<String, Object> attrs = label.getAttrsAtZoom(7);
    assertEquals("country", attrs.get("class"));
    assertEquals("Peru", attrs.get("name"));
    assertEquals("Perú", attrs.get("name_es"));
    assertEquals(3, label.getMinZoom());
    Coordinate labelPoint = label.getGeometry().getCoordinate();
    assertEquals(GeoUtils.getWorldX(-77.0), labelPoint.x, 1e-9);
    assertEquals(GeoUtils.getWorldY(-0.1), labelPoint.y, 1e-9);

    PlaceIndex.Place peru = profile.placeIndex().places().getFirst();
    assertEquals("country", peru.type());
    assertEquals("PE", peru.countryCode());
    assertEquals("PER", peru.countryKey());
    assertArrayEquals(new double[]{LNG, LAT, LNG + 2, LAT + 2}, peru.bbox(), 1e-9);
  }

  @Test
  void placesUseCapitalsPopulationAndMinZoom() {
    var quito = single(process(feature(NaturalEarth.PLACES, point(), Map.of(
      "featurecla", "Admin-0 capital", "name", "Quito", "pop_max", 1_701_000, "min_zoom", 3.1))), "place");
    assertEquals("city", quito.getAttrsAtZoom(7).get("class"));
    assertEquals("2", quito.getAttrsAtZoom(7).get("capital"));
    assertEquals(1_701_000L, quito.getAttrsAtZoom(7).get("population"));
    assertEquals(3, quito.getMinZoom());

    var town = single(process(feature(NaturalEarth.PLACES, point(), Map.of(
      "featurecla", "Populated place", "name", "Salinas", "pop_max", 30_000, "min_zoom", 7.0))), "place");
    assertEquals("town", town.getAttrsAtZoom(7).get("class"));

    // Too small for the base map, but still searchable.
    assertTrue(process(feature(NaturalEarth.PLACES, point(), Map.of(
      "featurecla", "Populated place", "name", "Puerto López", "pop_max", 10_000, "min_zoom", 9.0))).isEmpty());
    assertTrue(profile.placeIndex().places().stream().anyMatch(p -> p.name().equals("Puerto López")));
  }

  @Test
  void fieldsAreReadIgnoringCase() {
    var guayaquil = single(process(feature(NaturalEarth.PLACES, point(), Map.of(
      "FEATURECLA", "Admin-1 capital", "NAME", "Guayaquil", "POP_MAX", 2_698_077L, "MIN_ZOOM", 4.0,
      "ADM0_A3", "ECU", "ISO_A2", "EC", "ADM1NAME", "Guayas"))), "place");
    assertEquals("Guayaquil", guayaquil.getAttrsAtZoom(7).get("name"));
    assertEquals("4", guayaquil.getAttrsAtZoom(7).get("capital"));
    PlaceIndex.Place indexed = profile.placeIndex().places().getFirst();
    assertEquals("EC", indexed.countryCode());
    assertEquals("Guayas", indexed.admin1());
    assertEquals(LAT, indexed.latitude(), 1e-9);
    assertEquals(LNG, indexed.longitude(), 1e-9);
  }

  @Test
  void roadsBordersAndUrbanAreas() {
    assertEquals("trunk", single(process(feature(NaturalEarth.ROADS, line(), Map.of(
      "type", "Major Highway", "min_zoom", 5.0))), "transportation").getAttrsAtZoom(5).get("class"));
    assertEquals("motorway", single(process(feature(NaturalEarth.ROADS, line(), Map.of(
      "type", "Major Highway", "expressway", 1, "min_zoom", 5.0))), "transportation").getAttrsAtZoom(5).get("class"));
    assertEquals("primary", single(process(feature(NaturalEarth.ROADS, line(), Map.of(
      "type", "Secondary Highway", "min_zoom", 6.0))), "transportation").getAttrsAtZoom(6).get("class"));
    assertEquals("ferry", single(process(feature(NaturalEarth.ROADS, line(), Map.of(
      "type", "Ferry Route", "min_zoom", 5.0))), "transportation").getAttrsAtZoom(5).get("class"));
    assertTrue(process(feature(NaturalEarth.ROADS, line(), Map.of("type", "Track", "min_zoom", 5.0))).isEmpty());

    var border = single(process(feature(NaturalEarth.COUNTRY_BORDERS, line(), Map.of(
      "featurecla", "Disputed (please verify)"))), "boundary");
    assertEquals(2, border.getAttrsAtZoom(0).get("admin_level"));
    assertEquals(true, border.getAttrsAtZoom(0).get("disputed"));
    assertEquals(0, border.getMinZoom());
    var province = single(process(feature(NaturalEarth.PROVINCE_BORDERS, line(), Map.of(
      "FEATURECLA", "Adm-1 boundary", "MIN_ZOOM", 5.5))), "boundary");
    assertEquals(4, province.getAttrsAtZoom(5).get("admin_level"));
    assertEquals(5, province.getMinZoom());

    var urban = single(process(feature(NaturalEarth.URBAN_AREAS, square(0.2), Map.of("min_zoom", 5.0))), "landuse");
    assertEquals("residential", urban.getAttrsAtZoom(5).get("class"));
  }

  @Test
  void placeIndexWritesCountriesFirstWithTheirNames(@TempDir Path dir) throws IOException {
    PlaceIndex index = new PlaceIndex();
    index.add(new PlaceIndex.Place("city", "Lima", null, "PE", "PER", "Lima", "2", -12.04641, -77.04275,
      8_950_000, null));
    index.add(new PlaceIndex.Place("country", "Peru", "Perú", "PE", "PER", null, null, -9.15, -74.38, 32_510_453,
      new double[]{-81.41094, -18.35, -68.67, -0.0386}));
    index.add(new PlaceIndex.Place("city", "Say \"hi\"", null, null, "ZZZ", null, null, 1, 2, 10, null));
    Path file = dir.resolve("world.places.json");
    index.write(file);
    String json = Files.readString(file);
    assertTrue(json.startsWith("{\"version\":1,\"source\":\"Natural Earth\",\"places\":["), json);
    assertTrue(json.indexOf("\"name\":\"Peru\"") < json.indexOf("\"name\":\"Lima\""), json);
    assertTrue(json.contains("{\"type\":\"country\",\"name\":\"Peru\",\"nameEs\":\"Perú\",\"countryCode\":\"PE\"," +
      "\"country\":\"Peru\",\"countryEs\":\"Perú\",\"lat\":-9.15,\"lng\":-74.38,\"population\":32510453," +
      "\"bbox\":[-81.4109,-18.35,-68.67,-0.0386]}"), json);
    assertTrue(json.contains("{\"type\":\"city\",\"name\":\"Lima\",\"countryCode\":\"PE\",\"country\":\"Peru\"," +
      "\"countryEs\":\"Perú\",\"admin1\":\"Lima\",\"capital\":\"2\",\"lat\":-12.04641,\"lng\":-77.04275," +
      "\"population\":8950000}"), json);
    assertTrue(json.contains("\"name\":\"Say \\\"hi\\\"\""), json);
  }
}
