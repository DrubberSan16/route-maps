package com.mapsplatform.tilegen;

import com.onthegomap.planetiler.Planetiler;
import com.onthegomap.planetiler.config.Arguments;
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
 * </pre>
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
    Path osm = arguments.inputFile("osm_path", "OpenStreetMap extract (.osm.pbf) to render",
      Path.of("data", "input.osm.pbf"));
    Path output = arguments.file("output", "PMTiles file to write", Path.of("data", "output.pmtiles"));
    Path waterPolygons = arguments.file("water_polygons",
      "optional OSMCoastline water polygons (water-polygons-split-3857.zip) to draw oceans", null);
    String name = arguments.getString("name", "human readable tileset name", "");

    if (!output.getFileName().toString().endsWith(".pmtiles")) {
      throw new IllegalArgumentException("--output must end with .pmtiles: " + output);
    }

    Planetiler planetiler = Planetiler.create(arguments)
      .setProfile(new MapsPlatformProfile(name))
      .addOsmSource(MapsPlatformProfile.OSM_SOURCE, osm);
    if (waterPolygons != null) {
      if (!Files.isRegularFile(waterPolygons)) {
        throw new IllegalArgumentException("--water_polygons file not found: " + waterPolygons);
      }
      planetiler.addShapefileSource("EPSG:3857", MapsPlatformProfile.WATER_POLYGONS_SOURCE, waterPolygons);
    }
    planetiler.overwriteOutput(output).run();
  }
}
