package com.mapsplatform.tilegen;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.mapsplatform.tilegen.layers.BoundaryLayer;
import com.mapsplatform.tilegen.layers.Tags;
import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.config.PlanetilerConfig;
import com.onthegomap.planetiler.reader.SimpleFeature;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.osm.OsmElement;
import com.onthegomap.planetiler.reader.osm.OsmReader;
import com.onthegomap.planetiler.reader.osm.OsmRelationInfo;
import com.onthegomap.planetiler.stats.Stats;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.locationtech.jts.geom.Coordinate;
import org.locationtech.jts.geom.Geometry;
import org.locationtech.jts.geom.GeometryFactory;

class MapsPlatformProfileTest {

  private static final GeometryFactory GEOMETRY = new GeometryFactory();
  // Around Guayaquil, Ecuador.
  private static final double LNG = -79.8862;
  private static final double LAT = -2.1894;

  private final MapsPlatformProfile profile = new MapsPlatformProfile();
  private final FeatureCollector.Factory collectors =
    new FeatureCollector.Factory(PlanetilerConfig.defaults(), Stats.inMemory());

  // ---------------------------------------------------------------- helpers

  private static Geometry point() {
    return GEOMETRY.createPoint(new Coordinate(LNG, LAT));
  }

  private static Geometry line() {
    return GEOMETRY.createLineString(new Coordinate[]{
      new Coordinate(LNG, LAT), new Coordinate(LNG + 0.01, LAT + 0.005)
    });
  }

  /** Square polygon; {@code size} in degrees. */
  private static Geometry square(double size) {
    return GEOMETRY.createPolygon(new Coordinate[]{
      new Coordinate(LNG, LAT), new Coordinate(LNG + size, LAT), new Coordinate(LNG + size, LAT + size),
      new Coordinate(LNG, LAT + size), new Coordinate(LNG, LAT)
    });
  }

  private static SourceFeature osm(Geometry geometry, Map<String, Object> tags) {
    return osm(geometry, tags, List.of());
  }

  private static SourceFeature osm(Geometry geometry, Map<String, Object> tags,
    List<OsmReader.RelationMember<OsmRelationInfo>> relations) {
    return SimpleFeature.createFakeOsmFeature(geometry, new HashMap<>(tags), MapsPlatformProfile.OSM_SOURCE, null, 1,
      relations);
  }

  private List<FeatureCollector.Feature> process(SourceFeature feature) {
    FeatureCollector collector = collectors.get(feature);
    profile.processFeature(feature, collector);
    List<FeatureCollector.Feature> result = new ArrayList<>();
    collector.forEach(result::add);
    return result;
  }

  private static List<FeatureCollector.Feature> inLayer(List<FeatureCollector.Feature> features, String layer) {
    return features.stream().filter(f -> f.getLayer().equals(layer)).toList();
  }

  private static FeatureCollector.Feature single(List<FeatureCollector.Feature> features, String layer) {
    List<FeatureCollector.Feature> matching = inLayer(features, layer);
    assertEquals(1, matching.size(), () -> "expected one feature in " + layer + " but got " + features);
    return matching.getFirst();
  }

  // ---------------------------------------------------------------- schema

  @Test
  void exposesTheDocumentedLayers() {
    assertEquals(List.of("water", "water_name", "waterway", "landuse", "building", "transportation", "boundary",
      "place", "poi", "housenumber"), profile.layerNames());
    assertTrue(profile.attribution().contains("OpenStreetMap contributors"));
    assertEquals("maps-platform", profile.extraArchiveMetadata().get("schema"));
  }

  // ---------------------------------------------------------------- transportation

  @Test
  void residentialStreetIsMinorRoadWithNameFromZ13() {
    var road = single(process(osm(line(), Map.of(
      "highway", "residential", "name", "Avenida 9 de Octubre", "oneway", "yes", "surface", "asphalt"))),
      "transportation");
    assertEquals(12, road.getMinZoom());
    Map<String, Object> z12 = road.getAttrsAtZoom(12);
    assertEquals("minor", z12.get("class"));
    assertEquals("residential", z12.get("subclass"));
    assertNull(z12.get("name"));
    assertEquals("Avenida 9 de Octubre", road.getAttrsAtZoom(13).get("name"));
    assertEquals("paved", road.getAttrsAtZoom(13).get("surface"));
    assertEquals(1, road.getAttrsAtZoom(14).get("oneway"));
    assertNull(road.getAttrsAtZoom(13).get("oneway"));
  }

  @Test
  void linkRoadsAreRampsOfTheirClass() {
    var ramp = single(process(osm(line(), Map.of("highway", "motorway_link"))), "transportation");
    assertEquals("motorway", ramp.getAttrsAtZoom(14).get("class"));
    assertEquals(true, ramp.getAttrsAtZoom(14).get("ramp"));
    assertEquals(9, ramp.getMinZoom());
  }

  @Test
  void bridgesKeepBrunnelLayerAndReversedOneway() {
    var bridge = single(process(osm(line(), Map.of(
      "highway", "primary", "bridge", "viaduct", "layer", "2", "oneway", "-1", "ref", "E40"))), "transportation");
    Map<String, Object> z14 = bridge.getAttrsAtZoom(14);
    assertEquals("bridge", z14.get("brunnel"));
    assertEquals(2, z14.get("layer"));
    assertEquals(-1, z14.get("oneway"));
    assertEquals("E40", bridge.getAttrsAtZoom(8).get("ref"));
    assertEquals(7, bridge.getMinZoom());
  }

  @Test
  void railwaysFerriesAndAerialwaysAreTransportation() {
    assertEquals("transit", single(process(osm(line(), Map.of("railway", "tram"))), "transportation")
      .getAttrsAtZoom(14).get("class"));
    assertEquals("ferry", single(process(osm(line(), Map.of("route", "ferry"))), "transportation")
      .getAttrsAtZoom(14).get("class"));
    assertEquals("aerialway", single(process(osm(line(), Map.of("aerialway", "gondola"))), "transportation")
      .getAttrsAtZoom(14).get("class"));
    var siding = single(process(osm(line(), Map.of("railway", "rail", "service", "siding"))), "transportation");
    assertEquals(13, siding.getMinZoom());
  }

  @Test
  void ignoresRoadsUnderConstructionAndPedestrianAreas() {
    assertTrue(inLayer(process(osm(line(), Map.of("highway", "construction"))), "transportation").isEmpty());
    assertTrue(inLayer(process(osm(square(0.001), Map.of("highway", "pedestrian", "area", "yes"))),
      "transportation").isEmpty());
  }

  // ---------------------------------------------------------------- water

  @Test
  void namedLakeProducesPolygonAndLabelPoint() {
    List<FeatureCollector.Feature> features = process(osm(square(0.05), Map.of(
      "natural", "water", "water", "lake", "name", "Laguna", "name:es", "Laguna", "name:en", "Lagoon")));
    var water = single(features, "water");
    assertTrue(water.isPolygon());
    assertEquals("lake", water.getAttrsAtZoom(14).get("class"));
    var label = single(features, "water_name");
    Map<String, Object> attrs = label.getAttrsAtZoom(14);
    assertEquals("Laguna", attrs.get("name"));
    assertNull(attrs.get("name_es"), "identical localized names are not duplicated");
    assertEquals("Lagoon", attrs.get("name_en"));
  }

  @Test
  void riverbankIsRiverWaterWithoutLabelPoint() {
    List<FeatureCollector.Feature> features = process(osm(square(0.01), Map.of(
      "natural", "water", "water", "river", "name", "Río Guayas")));
    assertEquals("river", single(features, "water").getAttrsAtZoom(14).get("class"));
    assertTrue(inLayer(features, "water_name").isEmpty());
  }

  @Test
  void undergroundWaterIsSkipped() {
    assertTrue(process(osm(square(0.01), Map.of("natural", "water", "covered", "yes"))).isEmpty());
  }

  @Test
  void oceanPolygonsComeFromTheWaterPolygonsSource() {
    SourceFeature ocean = SimpleFeature.create(square(1), new HashMap<>(), MapsPlatformProfile.WATER_POLYGONS_SOURCE,
      null, 1);
    var water = single(process(ocean), "water");
    assertEquals("ocean", water.getAttrsAtZoom(0).get("class"));
    assertEquals(0, water.getMinZoom());
  }

  @Test
  void riversAreWaterwaysWithNames() {
    var river = single(process(osm(line(), Map.of("waterway", "river", "name", "Río Daule"))), "waterway");
    assertEquals(8, river.getMinZoom());
    assertEquals("river", river.getAttrsAtZoom(8).get("class"));
    assertNull(river.getAttrsAtZoom(9).get("name"));
    assertEquals("Río Daule", river.getAttrsAtZoom(10).get("name"));
  }

  // ---------------------------------------------------------------- landuse and buildings

  @Test
  void landuseClassesIncludeMangroves() {
    var park = single(process(osm(square(0.01), Map.of("leisure", "park"))), "landuse");
    assertEquals("park", park.getAttrsAtZoom(14).get("class"));
    var mangrove = single(process(osm(square(0.01), Map.of("natural", "wetland", "wetland", "mangrove"))),
      "landuse");
    assertEquals("wetland", mangrove.getAttrsAtZoom(14).get("class"));
    assertEquals("mangrove", mangrove.getAttrsAtZoom(14).get("subclass"));
    assertEquals(7, mangrove.getMinZoom());
  }

  @Test
  void buildingHeightComesFromHeightOrLevels() {
    var tall = single(process(osm(square(0.0005), Map.of("building", "yes", "height", "35 m"))), "building");
    assertEquals(35.0, tall.getAttrsAtZoom(14).get("height"));
    assertNull(tall.getAttrsAtZoom(13).get("height"));
    var levels = single(process(osm(square(0.0005), Map.of("building", "apartments", "building:levels", "3"))),
      "building");
    assertEquals(9.0, levels.getAttrsAtZoom(14).get("height"));
    assertTrue(inLayer(process(osm(square(0.0005), Map.of("building", "no"))), "building").isEmpty());
  }

  // ---------------------------------------------------------------- places, POIs, addresses

  @Test
  void bigCitiesAppearEarlierAndSortFirst() {
    var guayaquil = single(process(osm(point(), Map.of(
      "place", "city", "name", "Guayaquil", "population", "2698077", "capital", "4"))), "place");
    var smallCity = single(process(osm(point(), Map.of("place", "city", "name", "Otra", "population", "90000"))),
      "place");
    assertEquals(4, guayaquil.getMinZoom());
    assertEquals(6, smallCity.getMinZoom());
    assertTrue(guayaquil.getSortKey() < smallCity.getSortKey());
    Map<String, Object> attrs = guayaquil.getAttrsAtZoom(10);
    assertEquals("city", attrs.get("class"));
    assertEquals(2698077L, attrs.get("population"));
    assertEquals("4", attrs.get("capital"));
  }

  @Test
  void unnamedPlacesAreSkipped() {
    assertTrue(process(osm(point(), Map.of("place", "village"))).isEmpty());
  }

  @Test
  void hospitalAreaBecomesLanduseAndPoiPoint() {
    List<FeatureCollector.Feature> features = process(osm(square(0.002), Map.of(
      "amenity", "hospital", "name", "Hospital Luis Vernaza")));
    assertEquals("hospital", single(features, "landuse").getAttrsAtZoom(14).get("class"));
    var poi = single(features, "poi");
    assertFalse(poi.isPolygon());
    assertEquals(12, poi.getMinZoom());
    assertEquals("hospital", poi.getAttrsAtZoom(14).get("class"));
    assertEquals("Hospital Luis Vernaza", poi.getAttrsAtZoom(14).get("name"));
  }

  @Test
  void unnamedPoisAreOnlyKeptForUsefulIcons() {
    assertTrue(inLayer(process(osm(point(), Map.of("amenity", "restaurant"))), "poi").isEmpty());
    var fuel = single(process(osm(point(), Map.of("amenity", "fuel"))), "poi");
    assertEquals("fuel", fuel.getAttrsAtZoom(14).get("class"));
  }

  @Test
  void airportsCarryIataCode() {
    var airport = single(process(osm(square(0.02), Map.of(
      "aeroway", "aerodrome", "iata", "GYE", "name", "Aeropuerto José Joaquín de Olmedo"))), "poi");
    assertEquals(9, airport.getMinZoom());
    assertEquals("GYE", airport.getAttrsAtZoom(14).get("iata"));
  }

  @Test
  void housenumbersFromNodesAndBuildings() {
    var node = single(process(osm(point(), Map.of("addr:housenumber", "412"))), "housenumber");
    assertEquals("412", node.getAttrsAtZoom(14).get("housenumber"));
    assertEquals(14, node.getMinZoom());
    List<FeatureCollector.Feature> building = process(osm(square(0.0005), Map.of(
      "building", "yes", "addr:housenumber", "10-B")));
    assertEquals(1, inLayer(building, "building").size());
    assertEquals("10-B", single(building, "housenumber").getAttrsAtZoom(14).get("housenumber"));
  }

  // ---------------------------------------------------------------- boundaries

  @Test
  void adminRelationsAreRememberedDuringThePreprocessPass() {
    List<OsmRelationInfo> province = profile.preprocessOsmRelation(new OsmElement.Relation(10,
      Map.of("type", "boundary", "boundary", "administrative", "admin_level", "4"), List.of()));
    assertEquals(List.of(new BoundaryLayer.AdminRelation(10, 4, false, false)), province);
    assertNull(profile.preprocessOsmRelation(new OsmElement.Relation(11,
      Map.of("type", "multipolygon", "landuse", "forest"), List.of())));
    assertNull(profile.preprocessOsmRelation(new OsmElement.Relation(12,
      Map.of("type", "boundary", "boundary", "administrative", "admin_level", "10"), List.of())));
  }

  @Test
  void boundaryWaysUseTheLowestAdminLevelOfTheirRelations() {
    List<OsmReader.RelationMember<OsmRelationInfo>> relations = List.of(
      new OsmReader.RelationMember<>("outer", new BoundaryLayer.AdminRelation(1, 4, false, false)),
      new OsmReader.RelationMember<>("outer", new BoundaryLayer.AdminRelation(2, 2, true, false)));
    var boundary = single(process(osm(line(), Map.of(), relations)), "boundary");
    assertEquals(0, boundary.getMinZoom());
    Map<String, Object> attrs = boundary.getAttrsAtZoom(5);
    assertEquals(2, attrs.get("admin_level"));
    assertEquals(true, attrs.get("disputed"));
  }

  // ---------------------------------------------------------------- tag parsing

  @Test
  void parsesLengthsDefensively() {
    assertEquals(12.0, Tags.meters("12"));
    assertEquals(12.5, Tags.meters("12.5 m"));
    assertEquals(12.192, Tags.meters("40'"), 0.001);
    assertNull(Tags.meters("tall"));
    assertNull(Tags.meters("-3"));
    assertEquals(2698077L, Tags.nonNegativeLong("2 698 077"));
    assertNull(Tags.nonNegativeLong("unknown"));
  }
}
