package com.mapsplatform.tilegen.layers;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.VectorTile;
import com.onthegomap.planetiler.geo.GeometryException;
import com.onthegomap.planetiler.reader.SourceFeature;
import java.util.List;

/** One vector tile layer of the platform schema (see docs/maps.md). */
public interface Layer {

  /** Name of the layer inside the vector tiles. */
  String name();

  /** Emits zero or more output features for an OSM element. */
  void processOsm(SourceFeature feature, FeatureCollector features);

  /** Merges or filters the features of this layer in a finished tile. */
  default List<VectorTile.Feature> postProcess(int zoom, List<VectorTile.Feature> items)
    throws GeometryException {
    return items;
  }
}
