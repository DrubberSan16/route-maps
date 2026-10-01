package com.mapsplatform.tilegen;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.onthegomap.planetiler.config.Arguments;
import com.onthegomap.planetiler.pmtiles.ReadablePmtiles;
import com.onthegomap.planetiler.util.LayerAttrStats;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** Whole runs of the generator on a few native features. */
class TileGeneratorTest {

  private static final String ROAD = """
    {"type":"Feature","properties":{"class":"primary","name":"Avenida 9 de Octubre"},
     "geometry":{"type":"LineString","coordinates":[[-79.90,-2.19],[-79.88,-2.19]]}}""";
  private static final String POPULATION = """
    {"type":"Feature","properties":{"pop":1200},"geometry":{"type":"Point","coordinates":[-79.89,-2.19]}}""";
  private static final String RAIN = """
    {"type":"Feature","properties":{"rango":"1000 - 2000"},
     "geometry":{"type":"Polygon","coordinates":[[[-80.2,-2.5],[-79.6,-2.5],[-79.6,-1.9],[-80.2,-1.9],[-80.2,-2.5]]]}}""";

  private static void write(Path dir, String name, String feature) throws IOException {
    Files.writeString(dir.resolve(name + ".geojson"), "{\"type\":\"FeatureCollection\",\"features\":[" + feature + "]}");
  }

  private static Path nativeData(Path dir, boolean withOverlays) throws IOException {
    Path data = Files.createDirectories(dir.resolve("native"));
    write(data, "map-roads", ROAD);
    if (withOverlays) {
      write(data, "map-population", POPULATION);
      write(data, "climate-precipitation-regions", RAIN);
    }
    return data;
  }

  private static Path generate(Path dir, Path data, String file, String... extra) {
    Path output = dir.resolve(file);
    String[] args = {
      "--native_data=" + data, "--output=" + output, "--tmpdir=" + dir.resolve("tmp-" + file), "--threads=2",
      "--name=Guayaquil"
    };
    String[] all = new String[args.length + extra.length];
    System.arraycopy(args, 0, all, 0, args.length);
    System.arraycopy(extra, 0, all, args.length, extra.length);
    TileGenerator.run(Arguments.fromArgs(all));
    return output;
  }

  private static Set<String> layers(Path archive) throws IOException {
    try (var pmtiles = (ReadablePmtiles) ReadablePmtiles.newReadFromFile(archive)) {
      return pmtiles.metadata().vectorLayers().stream().map(LayerAttrStats.VectorLayer::id)
        .collect(Collectors.toSet());
    }
  }

  @Test
  void overlaysGoToTheirOwnArchiveSoTheMapStaysLight(@TempDir Path dir) throws IOException {
    Path data = nativeData(dir, true);

    Path map = generate(dir, data, "guayaquil.pmtiles", "--native_layers=map");
    Path overlays = generate(dir, data, "guayaquil.overlays.pmtiles", "--native_layers=overlays", "--maxzoom=12");

    assertEquals(Set.of("transportation"), layers(map));
    assertEquals(Set.of("population", "climate"), layers(overlays));
    try (var pmtiles = (ReadablePmtiles) ReadablePmtiles.newReadFromFile(overlays)) {
      assertEquals(12, pmtiles.getHeader().maxZoom());
    }
  }

  @Test
  void byDefaultEverythingIsInOneArchive(@TempDir Path dir) throws IOException {
    Path map = generate(dir, nativeData(dir, true), "guayaquil.pmtiles");

    assertEquals(Set.of("transportation", "population", "climate"), layers(map));
  }

  @Test
  void withoutOverlayLayersThereIsNoOverlayArchive(@TempDir Path dir) throws IOException {
    Path data = nativeData(dir, false);

    var error = assertThrows(IllegalArgumentException.class,
      () -> generate(dir, data, "guayaquil.overlays.pmtiles", "--native_layers=overlays"));
    assertTrue(error.getMessage().contains("no overlay layers"), error.getMessage());
    assertThrows(IllegalArgumentException.class,
      () -> generate(dir, data, "guayaquil.pmtiles", "--native_layers=roads"));
  }
}
