import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/app_exception.dart';
import '../../domain/services/connectivity_service.dart';
import '../../presentation/providers.dart';

@immutable
class CatalogState {
  const CatalogState({this.isRefreshing = false, this.error, this.refreshedAt});

  final bool isRefreshing;
  final String? error;
  final DateTime? refreshedAt;
}

final catalogControllerProvider = NotifierProvider<CatalogController, CatalogState>(
  CatalogController.new,
);

/// Keeps the cached region catalog up to date: refreshed whenever the API
/// becomes reachable and on demand. The catalog also tells which stored
/// regions have a newer version.
class CatalogController extends Notifier<CatalogState> {
  @override
  CatalogState build() {
    ref.listen(connectivityStatusProvider, (previous, next) {
      final nowOnline = next.value == ConnectivityStatus.online;
      if (nowOnline && previous?.value != ConnectivityStatus.online) unawaited(refresh());
    });
    return const CatalogState();
  }

  Future<void> refresh() async {
    if (state.isRefreshing) return;
    state = CatalogState(isRefreshing: true, refreshedAt: state.refreshedAt);
    try {
      await ref.read(regionRepositoryProvider).refreshCatalog();
      if (!ref.mounted) return;
      state = CatalogState(refreshedAt: DateTime.now());
    } on AppException catch (error) {
      if (!ref.mounted) return;
      state = CatalogState(error: error.message, refreshedAt: state.refreshedAt);
    }
  }
}

/// Free space on the storage used for maps (null when unknown).
final freeSpaceProvider = FutureProvider.autoDispose<int?>((ref) {
  // Changes with every completed download or deletion.
  ref.watch(downloadedRegionsProvider);
  return ref.watch(offlineStorageProvider).freeBytes();
});
