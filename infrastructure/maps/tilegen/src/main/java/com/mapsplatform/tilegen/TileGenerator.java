package com.mapsplatform.tilegen;

import com.mapsplatform.tilegen.layers.NaturalEarth;
import com.onthegomap.planetiler.Planetiler;
import com.onthegomap.planetiler.config.Arguments;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Command line entry point.
 *
 * <pre>
 * java -jar tilegen-with-deps.jar \
 *   --osm_path=/data/imports/guayaquil.osm.pbf \
 *   --output=/data/maps/ecuador/guayaquil.pmtiles \
 *   --name="Guayaquil" \
 *   [--water_polygons=/data/imports/water-polygons-split-3857.zip]
 *
 * java -jar tilegen-with-deps.jar \
 *   --natural_earth=/data/imports/naturalearth \
 *   --gazetteer=/data/maps/world/world.places.json \
 *   --output=/data/maps/world/world.pmtiles --maxzoom=7 --name="Mundo"
 * </pre>
 * <p>
 * The second form builds the world base map from the Natural Earth shapefiles ({@code <name>.zip}, see
 * {@link NaturalEarth#SOURCES}) and writes its countries and cities for the place search.
 * <p>
 * Any other Planetiler option can be passed too (for example {@code --tmpdir}, {@code --threads} or {@code --bounds}).
 * Nothing is downloaded: inputs are prepared by the region scripts.
 */
public final class TileGenerator {

  private TileGenerator() {}

  public static void main(String[] args) {
    run(Arguments.fromArgsOrConfigFile(args));
  }

  static void run(Arguments arguments) {
    Path osm = arguments.file("osm_path", "OpenStreetMap extract (.osm.pbf) to render", null);
    Path naturalEarth = arguments.file("natural_earth",
      "folder with the Natural Earth 10m shapefiles (<name>.zip) of the world base map", null);
    Path gazetteer = arguments.file("gazetteer",
      "JSON file to write the countries and cities of the world base map to (with --natural_earth)", null);
    Path output = arguments.file("output", "PMTiles file to write", Path.of("data", "output.pmtiles"));
    Path waterPolygons = arguments.file("water_polygons",
      "optional OSMCoastline water polygons (water-polygons-split-3857.zip) to draw oceans", null);
    String name = arguments.getString("name", "human readable tileset name", "");

    if (!output.getFileName().toString().endsWith(".pmtiles")) {
      throw new IllegalArgumentException("--output must end with .pmtiles: " + output);
    }
    if (osm == null && naturalEarth == null) {
      throw new IllegalArgumentException("--osm_path (a region) or --natural_earth (the world base map) is required");
    }
    if (gazetteer != null && naturalEarth == null) {
      throw new IllegalArgumentException("--gazetteer needs --natural_earth");
    }

    MapsPlatformProfile profile = new MapsPlatformProfile(name, osm == null);
    Planetiler planetiler = Planetiler.create(arguments).setProfile(profile);
    if (osm != null) {
      if (!Files.isRegularFile(osm)) {
        throw new IllegalArgumentException("--osm_path file not found: " + osm);
      }
      planetiler.addOsmSource(MapsPlatformProfile.OSM_SOURCE, osm);
    }
    if (naturalEarth != null) {
      for (String source : NaturalEarth.SOURCES) {
        Path shapefile = naturalEarth.resolve(source + ".zip");
        if (!Files.isRegularFile(shapefile)) {
          throw new IllegalArgumentException("Natural Earth file not found: " + shapefile);
        }
        // The projection comes from the .prj file inside the archive (WGS 84).
        planetiler.addShapefileSource(source, shapefile);
      }
    }
    if (waterPolygons != null) {
      if (!Files.isRegularFile(waterPolygons)) {
        throw new IllegalArgumentException("--water_polygons file not found: " + waterPolygons);
      }
      planetiler.addShapefileSource("EPSG:3857", MapsPlatformProfile.WATER_POLYGONS_SOURCE, waterPolygons);
    }
    planetiler.overwriteOutput(output).run();
    if (gazetteer != null) {
      try {
        profile.placeIndex().write(gazetteer);
      } catch (IOException e) {
        throw new UncheckedIOException("Could not write " + gazetteer, e);
      }
    }
  }
}
