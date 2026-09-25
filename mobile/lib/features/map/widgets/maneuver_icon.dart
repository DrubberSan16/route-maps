import 'package:flutter/material.dart';

import '../../../domain/entities/route.dart';

/// Icon for a normalized maneuver (see [Maneuvers]).
IconData maneuverIcon(String maneuver) => switch (maneuver) {
  Maneuvers.depart => Icons.trip_origin,
  Maneuvers.arrive => Icons.flag,
  Maneuvers.waypoint => Icons.place,
  Maneuvers.turnLeft => Icons.turn_left,
  Maneuvers.turnRight => Icons.turn_right,
  Maneuvers.slightLeft => Icons.turn_slight_left,
  Maneuvers.slightRight => Icons.turn_slight_right,
  Maneuvers.sharpLeft => Icons.turn_sharp_left,
  Maneuvers.sharpRight => Icons.turn_sharp_right,
  Maneuvers.uturn => Icons.u_turn_left,
  Maneuvers.continueStraight => Icons.straight,
  Maneuvers.roundaboutEnter || Maneuvers.roundaboutExit => Icons.roundabout_right,
  Maneuvers.merge => Icons.merge,
  Maneuvers.ramp => Icons.ramp_right,
  Maneuvers.exit => Icons.fork_right,
  Maneuvers.ferry => Icons.directions_boat,
  _ => Icons.navigation,
};
