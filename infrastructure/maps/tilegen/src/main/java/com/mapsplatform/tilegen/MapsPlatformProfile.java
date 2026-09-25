package com.mapsplatform.tilegen;

import com.mapsplatform.tilegen.layers.BoundaryLayer;
import com.mapsplatform.tilegen.layers.BuildingLayer;
import com.mapsplatform.tilegen.layers.HousenumberLayer;
import com.mapsplatform.tilegen.layers.LanduseLayer;
import com.mapsplatform.tilegen.layers.Layer;
import com.mapsplatform.tilegen.layers.PlaceLayer;
import com.mapsplatform.tilegen.layers.PoiLayer;
import com.mapsplatform.tilegen.layers.TransportationLayer;
import com.mapsplatform.tilegen.layers.WaterLayer;
import com.mapsplatform.tilegen.layers.WaterNameLayer;
import com.mapsplatform.tilegen.layers.WaterwayLayer;
import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.Profile;
import com.onthegomap.planetiler.VectorTile;
import com.onthegomap.planetiler.geo.GeometryException;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.osm.OsmElement;
import com.onthegomap.planetiler.reader.osm.OsmRelationInfo;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Vector tile schema of the platform ("maps-platform" v1). Layers are listed in docs/maps.md and styled by
 * infrastructure/maps/style/style.json.
 */
public final class MapsPlatformProfile implements Profile {

  public static final String OSM_SOURCE = "osm";
  public static final String WATER_POLYGONS_SOURCE = "water_polygons";
  public static final String SCHEMA_NAME = "maps-platform";
  public static final String SCHEMA_VERSION = "1.0.0";

  private final WaterLayer water = new WaterLayer();
  private final BoundaryLayer boundary = new BoundaryLayer();
  private final Map<String, Layer> layers = new LinkedHashMap<>();
  private final String tilesetName;

  public MapsPlatformProfile() {
    this(null);
  }

  /** @param tilesetName human readable name written into the archive metadata (for example the region name). */
  public MapsPlatformProfile(String tilesetName) {
    this.tilesetName = tilesetName;
    for (Layer layer : List.of(water, new WaterNameLayer(), new WaterwayLayer(), new LanduseLayer(),
      new BuildingLayer(), new TransportationLayer(), boundary, new PlaceLayer(), new PoiLayer(),
      new HousenumberLayer())) {
      layers.put(layer.name(), layer);
    }
  }

  /** Names of the vector tile layers, in the order they are processed. */
  public List<String> layerNames() {
    return List.copyOf(layers.keySet());
  }

  @Override
  public List<OsmRelationInfo> preprocessOsmRelation(OsmElement.Relation relation) {
    return boundary.preprocessOsmRelation(relation);
  }

  @Override
  public void processFeature(SourceFeature sourceFeature, FeatureCollector features) {
    if (WATER_POLYGONS_SOURCE.equals(sourceFeature.getSource())) {
      water.processOcean(features);
      return;
    }
    for (Layer layer : layers.values()) {
      layer.processOsm(sourceFeature, features);
    }
  }

  @Override
  public List<VectorTile.Feature> postProcessLayerFeatures(String layer, int zoom, List<VectorTile.Feature> items)
    throws GeometryException {
    Layer handler = layers.get(layer);
    return handler == null ? items : handler.postProcess(zoom, items);
  }

  @Override
  public boolean caresAboutSource(String name) {
    return OSM_SOURCE.equals(name) || WATER_POLYGONS_SOURCE.equals(name);
  }

  @Override
  public boolean caresAboutWikidataTranslation(OsmElement element) {
    return false;
  }

  @Override
  public String name() {
    return tilesetName == null || tilesetName.isBlank() ? "Maps Platform" : "Maps Platform - " + tilesetName;
  }

  @Override
  public String description() {
    return "Vector tiles of the maps platform built from OpenStreetMap data";
  }

  @Override
  public String attribution() {
    return OSM_ATTRIBUTION;
  }

  @Override
  public String version() {
    return SCHEMA_VERSION;
  }

  @Override
  public Map<String, String> extraArchiveMetadata() {
    return Map.of("schema", SCHEMA_NAME, "schema_version", SCHEMA_VERSION);
  }

  @Override
  public long estimateIntermediateDiskBytes(long osmFileSize) {
    // Similar to the OpenMapTiles profile: features take roughly the size of the input extract.
    return osmFileSize;
  }

  @Override
  public long estimateOutputBytes(long osmFileSize) {
    return osmFileSize;
  }
}
