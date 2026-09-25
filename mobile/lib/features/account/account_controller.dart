import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/app_exception.dart';
import '../../presentation/providers.dart';

@immutable
class AccountFormState {
  const AccountFormState({this.isBusy = false, this.error});

  final bool isBusy;
  final String? error;
}

final accountControllerProvider = NotifierProvider.autoDispose<AccountController, AccountFormState>(
  AccountController.new,
);

/// Login, registration and logout. The session unlocks synchronization; the
/// rest of the app works without an account.
class AccountController extends Notifier<AccountFormState> {
  @override
  AccountFormState build() => const AccountFormState();

  Future<bool> login(String email, String password) =>
      _run(() => ref.read(authRepositoryProvider).login(email: email, password: password));

  Future<bool> register(String name, String email, String password) => _run(
    () => ref.read(authRepositoryProvider).register(email: email, password: password, name: name),
  );

  /// Ends the session. A trip being recorded is finished first: the phone
  /// stops tracking an account that has left, and the trip is sent when that
  /// account logs in again.
  Future<bool> logout() => _run(() async {
    final recorder = ref.read(tripRecorderProvider);
    if (recorder.state.isRecording) await recorder.finish();
    await ref.read(authRepositoryProvider).logout();
  });

  Future<bool> _run(Future<void> Function() action) async {
    state = const AccountFormState(isBusy: true);
    try {
      await action();
      if (ref.mounted) state = const AccountFormState();
      return true;
    } on AppException catch (error) {
      if (ref.mounted) state = AccountFormState(error: error.message);
      return false;
    }
  }
}
