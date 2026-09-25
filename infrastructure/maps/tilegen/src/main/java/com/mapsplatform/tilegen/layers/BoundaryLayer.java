package com.mapsplatform.tilegen.layers;

import com.onthegomap.planetiler.FeatureCollector;
import com.onthegomap.planetiler.FeatureMerge;
import com.onthegomap.planetiler.VectorTile;
import com.onthegomap.planetiler.reader.SourceFeature;
import com.onthegomap.planetiler.reader.osm.OsmElement;
import com.onthegomap.planetiler.reader.osm.OsmReader;
import com.onthegomap.planetiler.reader.osm.OsmRelationInfo;
import com.onthegomap.planetiler.util.Parse;
import java.util.List;

/**
 * {@code boundary}: administrative boundaries (admin levels 2 to 8) as lines, built from the ways of boundary
 * relations. Attributes: {@code admin_level}, {@code maritime}, {@code disputed}.
 */
public final class BoundaryLayer implements Layer {

  public static final String NAME = "boundary";
  static final int MIN_ADMIN_LEVEL = 2;
  static final int MAX_ADMIN_LEVEL = 8;

  /** What the first OSM pass remembers about each administrative boundary relation. */
  public record AdminRelation(long id, int adminLevel, boolean disputed, boolean maritime)
    implements OsmRelationInfo {

    @Override
    public long estimateMemoryUsageBytes() {
      return 32;
    }
  }

  @Override
  public String name() {
    return NAME;
  }

  /** Called for every relation before ways are processed. */
  public List<OsmRelationInfo> preprocessOsmRelation(OsmElement.Relation relation) {
    if (!relation.hasTag("type", "boundary") || !relation.hasTag("boundary", "administrative", "disputed")) {
      return null;
    }
    Integer level = Parse.parseIntOrNull(relation.getTag("admin_level"));
    if (level == null || level < MIN_ADMIN_LEVEL || level > MAX_ADMIN_LEVEL) {
      return null;
    }
    boolean disputed = relation.hasTag("boundary", "disputed") || Tags.isYes(relation, "disputed");
    boolean maritime = Tags.isYes(relation, "maritime");
    return List.of(new AdminRelation(relation.id(), level, disputed, maritime));
  }

  static int minZoom(int adminLevel) {
    if (adminLevel <= 2) {
      return 0;
    }
    if (adminLevel <= 4) {
      return 4;
    }
    return adminLevel <= 6 ? 8 : 10;
  }

  @Override
  public void processOsm(SourceFeature feature, FeatureCollector features) {
    if (!feature.canBeLine()) {
      return;
    }
    Integer adminLevel = null;
    boolean disputed = feature.hasTag("boundary", "disputed") || Tags.isYes(feature, "disputed");
    boolean maritime = Tags.isYes(feature, "maritime") || feature.hasTag("natural", "coastline") ||
      feature.hasTag("boundary_type", "maritime");
    for (OsmReader.RelationMember<AdminRelation> member : feature.relationInfo(AdminRelation.class)) {
      AdminRelation relation = member.relation();
      if (adminLevel == null || relation.adminLevel() < adminLevel) {
        adminLevel = relation.adminLevel();
      }
      disputed |= relation.disputed();
      maritime |= relation.maritime();
    }
    if (adminLevel == null && feature.hasTag("boundary", "administrative")) {
      Integer own = Parse.parseIntOrNull(feature.getTag("admin_level"));
      if (own != null && own >= MIN_ADMIN_LEVEL && own <= MAX_ADMIN_LEVEL) {
        adminLevel = own;
      }
    }
    if (adminLevel == null) {
      return;
    }
    var line = features.line(NAME)
      .setAttr("admin_level", adminLevel)
      .setMinZoom(minZoom(adminLevel))
      .setMinPixelSize(0)
      .setSortKeyDescending(adminLevel);
    if (disputed) {
      line.setAttr("disputed", true);
    }
    if (maritime) {
      line.setAttr("maritime", true);
    }
  }

  @Override
  public List<VectorTile.Feature> postProcess(int zoom, List<VectorTile.Feature> items) {
    return zoom >= Zooms.MAX ? items : FeatureMerge.mergeLineStrings(items, 0, 0.1, 4);
  }
}
