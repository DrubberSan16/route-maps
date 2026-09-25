import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/domain/services/connectivity_service.dart';
import 'package:maps_platform/infrastructure/connectivity/reachability_connectivity_service.dart';

import '../helpers/async.dart';

class FakeNetworkMonitor implements NetworkMonitor {
  FakeNetworkMonitor(this.network);

  bool network;
  final _changes = StreamController<bool>.broadcast();

  void change(bool value) {
    network = value;
    _changes.add(value);
  }

  @override
  Future<bool> hasNetwork() async => network;

  @override
  Stream<bool> watchNetwork() => _changes.stream;
}

void main() {
  group('ReachabilityConnectivityService', () {
    late FakeNetworkMonitor monitor;
    late bool apiAnswers;
    late int probes;
    late ReachabilityConnectivityService service;

    setUp(() {
      monitor = FakeNetworkMonitor(true);
      apiAnswers = true;
      probes = 0;
      service = ReachabilityConnectivityService(
        network: monitor,
        probe: () async {
          probes++;
          await Future<void>.delayed(const Duration(milliseconds: 5));
          return apiAnswers;
        },
        offlineRecheckInterval: const Duration(milliseconds: 30),
        onlineRecheckInterval: const Duration(hours: 1),
      );
    });

    tearDown(() => service.dispose());

    test('Wi-Fi without Internet is offline', () async {
      apiAnswers = false;
      expect(await service.checkNow(), ConnectivityStatus.offline);
      expect(probes, 1);
    });

    test('without any network interface the API is not even probed', () async {
      monitor.network = false;
      expect(await service.checkNow(), ConnectivityStatus.offline);
      expect(probes, 0);
    });

    test('the status is published after the first real check, then on every change', () async {
      monitor.network = false;
      final statuses = <ConnectivityStatus>[];
      final subscription = service.watchStatus().listen(statuses.add);
      await Future<void>.delayed(Duration.zero);
      expect(statuses, isEmpty, reason: 'nothing is known before the first check');

      await service.start();
      monitor.change(true);
      await eventually(() => statuses.length == 2);
      expect(statuses, [ConnectivityStatus.offline, ConnectivityStatus.online]);
      expect(service.status, ConnectivityStatus.online);

      // A late listener gets the current status right away.
      expect(await service.watchStatus().first, ConnectivityStatus.online);
      await subscription.cancel();
    });

    test('a failed request while online triggers a new check', () async {
      await service.start();
      expect(service.status, ConnectivityStatus.online);
      apiAnswers = false;
      service.reportNetworkFailure();
      await eventually(() => service.status == ConnectivityStatus.offline);
    });

    test('with network but no Internet it keeps checking until the API answers', () async {
      apiAnswers = false;
      await service.start();
      expect(service.status, ConnectivityStatus.offline);
      apiAnswers = true;
      await eventually(() => service.status == ConnectivityStatus.online);
      expect(probes, greaterThanOrEqualTo(2));
    });

    test('simultaneous checks share one probe', () async {
      final results = await Future.wait([service.checkNow(), service.checkNow()]);
      expect(results, [ConnectivityStatus.online, ConnectivityStatus.online]);
      expect(probes, 1);
    });
  });

  group('healthProbe', () {
    late HttpServer server;
    late void Function(HttpResponse response) respond;

    setUp(() async {
      server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      server.listen((request) async {
        respond(request.response);
        await request.response.close();
      });
    });

    tearDown(() => server.close(force: true));

    Future<bool> probe() =>
        healthProbe(Dio(), Uri.parse('http://127.0.0.1:${server.port}/health/live'))();

    test('the platform answering its liveness endpoint means online', () async {
      respond = (response) => response
        ..headers.contentType = ContentType.json
        ..write(jsonEncode({'status': 'ok'}));
      expect(await probe(), isTrue);
    });

    test('a captive portal page is not Internet', () async {
      respond = (response) => response
        ..headers.contentType = ContentType.html
        ..write('<html><body>Inicia sesión en la red Wi-Fi</body></html>');
      expect(await probe(), isFalse);
    });

    test('an unavailable platform is not reachable', () async {
      respond = (response) => response.statusCode = HttpStatus.badGateway;
      expect(await probe(), isFalse);
    });

    test('an unreachable host is offline', () async {
      final port = server.port;
      await server.close(force: true);
      expect(await healthProbe(Dio(), Uri.parse('http://127.0.0.1:$port/health/live'))(), isFalse);
    });
  });
}
