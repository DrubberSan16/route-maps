package com.mapsplatform.tilegen;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapsplatform.tilegen.layers.NativeData;
import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.config.PlanetilerConfig;
import com.onthegomap.planetiler.reader.SimpleFeature;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.stats.Stats;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.GeometryFactory;

/** Region layers prepared by the data pipeline (census streets, state roads, places, POIs, grids). */
class NativeDataTest {

  private static final GeometryFactory GEOMETRY = new GeometryFactory();
  private static final double LNG = -79.8862;
  private static final double LAT = -2.1894;

  private final MapsPlatformProfile profile = new MapsPlatformProfile("Ecuador", false, true);
  private final FeatureCollector.Factory collectors =
    new FeatureCollector.Factory(PlanetilerConfig.defaults(), Stats.inMemory());

  private static Geometry point() {
    return GEOMETRY.createPoint(new Coordinate(LNG, LAT));
  }

  private static Geometry line() {
    return GEOMETRY.createLineString(new Coordinate[]{new Coordinate(LNG, LAT), new Coordinate(LNG + 0.01, LAT)});
  }

  private static Geometry square(double size) {
    return GEOMETRY.createPolygon(new Coordinate[]{
      new Coordinate(LNG, LAT), new Coordinate(LNG + size, LAT), new Coordinate(LNG + size, LAT + size),
      new Coordinate(LNG, LAT + size), new Coordinate(LNG, LAT)
    });
  }

  private List<FeatureCollector.Feature> process(String source, Geometry geometry, Map<String, Object> fields) {
    SourceFeature feature = SimpleFeature.create(geometry, new HashMap<>(fields), source, null, 1);
    FeatureCollector collector = collectors.get(feature);
    profile.processFeature(feature, collector);
    List<FeatureCollector.Feature> result = new ArrayList<>();
    collector.forEach(result::add);
    return result;
  }

  private FeatureCollector.Feature single(String source, Geometry geometry, Map<String, Object> fields) {
    List<FeatureCollector.Feature> features = process(source, geometry, fields);
    assertEquals(1, features.size(), () -> "expected one feature but got " + features);
    return features.getFirst();
  }

  @Test
  void censusStreetsAreMinorRoadsLabelledAtZ14() {
    var road = single(NativeData.ROADS, line(), Map.of("class", "street", "kind", "CALLE", "scope", "detail",
      "name", "C. 49 S-O - Dr. Juan Montalván Cornejo"));
    assertEquals("transportation", road.getLayer());
    assertEquals(13, road.getMinZoom());
    assertEquals("minor", road.getAttrsAtZoom(13).get("class"));
    assertEquals("street", road.getAttrsAtZoom(13).get("subclass"));
    assertNull(road.getAttrsAtZoom(13).get("name"));
    assertEquals("C. 49 S-O - Dr. Juan Montalván Cornejo", road.getAttrsAtZoom(14).get("name"));
  }

  @Test
  void avenuesAppearAtZ11AndFootwaysArePaths() {
    var avenue = single(NativeData.ROADS, line(), Map.of("class", "secondary", "scope", "detail", "name", "Av. 25 de Julio"));
    assertEquals(11, avenue.getMinZoom());
    assertEquals("Av. 25 de Julio", avenue.getAttrsAtZoom(13).get("name"));
    var steps = single(NativeData.ROADS, line(), Map.of("class", "steps", "kind", "ESCALINATA", "scope", "detail"));
    assertEquals("path", steps.getAttrsAtZoom(14).get("class"));
    assertEquals("steps", steps.getAttrsAtZoom(14).get("subclass"));
    assertEquals(14, steps.getMinZoom());
  }

  @Test
  void stateRoadOverviewStopsWhereTheDetailedNetworkStarts() {
    var overview = single(NativeData.ROADS, line(), Map.of("class", "trunk", "scope", "overview", "state", true,
      "ref", "E40"));
    assertEquals(5, overview.getMinZoom());
    assertEquals(11, overview.getMaxZoom());
    assertEquals("E40", overview.getAttrsAtZoom(8).get("ref"));
    var kept = single(NativeData.ROADS, line(), Map.of("class", "trunk", "scope", "detail", "state", true, "ref", "E40"));
    assertEquals(12, kept.getMinZoom());
    var promoted = single(NativeData.ROADS, line(), Map.of("class", "trunk", "scope", "detail", "ref", "E40",
      "name", "Av. Perimetral"));
    assertEquals(12, promoted.getMinZoom());
  }

  @Test
  void placesUsePopulationForTheirZoom() {
    var city = single(NativeData.PLACES, point(), Map.of("class", "city", "rank", 1, "name", "Guayaquil",
      "population", 2_650_000, "capital", "4"));
    assertEquals("place", city.getLayer());
    assertEquals(4, city.getMinZoom());
    assertEquals(2_650_000L, city.getAttrsAtZoom(4).get("population"));
    var village = single(NativeData.PLACES, point(), Map.of("class", "village", "rank", 4, "name", "Posorja"));
    assertEquals(10, village.getMinZoom());
  }

  @Test
  void poisKeepClassSubclassAndRank() {
    var terminal = single(NativeData.POIS, point(), Map.of("class", "bus", "subclass", "bus_station", "rank", 6,
      "name", "Terminal Terrestre de Guayaquil"));
    assertEquals("poi", terminal.getLayer());
    assertEquals(12, terminal.getMinZoom());
    assertEquals("bus_station", terminal.getAttrsAtZoom(14).get("subclass"));
    var unnamedPark = single(NativeData.POIS, point(), Map.of("class", "park", "subclass", "park", "rank", 24));
    assertNull(unnamedPark.getAttrsAtZoom(14).get("name"));
    assertEquals(14, unnamedPark.getMinZoom());
  }

  @Test
  void parksAreLanduseWithALabelPoint() {
    var features = process(NativeData.LANDUSE, square(0.001), Map.of("class", "park", "name", "Parque Seminario"));
    assertEquals(2, features.size());
    assertEquals("park", features.getFirst().getAttrsAtZoom(14).get("class"));
    assertEquals("Parque Seminario", features.get(1).getAttrsAtZoom(14).get("name"));
  }

  @Test
  void blocksBuildingsAndPopulation() {
    var block = single(NativeData.BLOCKS, square(0.001), Map.of("class", "block"));
    assertEquals("landuse", block.getLayer());
    assertEquals(13, block.getMinZoom());
    var building = single(NativeData.BUILDINGS, square(0.0001), Map.of());
    assertEquals("building", building.getLayer());
    assertEquals(14, building.getMinZoom());
    var cell = single(NativeData.POPULATION, point(), Map.of("pop", 5400, "homes", 1500));
    assertEquals("population", cell.getLayer());
    assertEquals(5400L, cell.getAttrsAtZoom(8).get("pop"));
    assertTrue(cell.getMaxZoom() <= 12);
  }

  @Test
  void climateZonesCarryTheirRanges() {
    var rain = single(NativeData.CLIMATE_PRECIPITATION, square(0.5), Map.of("rango", "2000 - 3000"));
    assertEquals("climate", rain.getLayer());
    assertEquals("precipitation", rain.getAttrsAtZoom(6).get("class"));
    assertEquals(3000.0, rain.getAttrsAtZoom(6).get("mm_max"));
    var heat = single(NativeData.CLIMATE_TEMPERATURE, square(0.5), Map.of("termotipo", "TERMOTROPICAL INFERIOR"));
    assertEquals("temperature", heat.getAttrsAtZoom(6).get("class"));
    assertEquals(5, heat.getAttrsAtZoom(6).get("band"));
    assertEquals("Termotropical Inferior", heat.getAttrsAtZoom(6).get("thermotype"));
  }
}
