/// Transport profiles supported by the routing API (`profile` field).
enum RoutingProfile {
  car('CAR', 'Auto'),
  truck('TRUCK', 'Camión'),
  motorcycle('MOTORCYCLE', 'Moto'),
  bicycle('BICYCLE', 'Bicicleta'),
  pedestrian('PEDESTRIAN', 'A pie');

  const RoutingProfile(this.apiValue, this.label);

  /// Value sent to and received from the API.
  final String apiValue;

  /// Spanish label for the UI.
  final String label;

  static RoutingProfile fromApi(String value) {
    for (final profile in values) {
      if (profile.apiValue == value) return profile;
    }
    throw FormatException('Unknown routing profile "$value"');
  }
}
