import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:maps_platform/features/account/account_screen.dart';
import 'package:maps_platform/presentation/providers.dart';

import '../helpers/fakes.dart';

void main() {
  late FakeAuthRepository auth;
  bool? closedWith;

  Future<void> open(WidgetTester tester) async {
    auth = FakeAuthRepository(testSession);
    closedWith = null;
    await tester.pumpWidget(
      ProviderScope(
        overrides: [authRepositoryProvider.overrideWithValue(auth)],
        child: MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () async => closedWith = await showDialog<bool>(
                  context: context,
                  builder: (_) => const ChangePasswordDialog(),
                ),
                child: const Text('Abrir'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('Abrir'));
    await tester.pumpAndSettle();
  }

  Future<void> submit(
    WidgetTester tester, {
    required String current,
    required String next,
    String? repeat,
  }) async {
    await tester.enterText(find.byKey(const Key('current-password-field')), current);
    await tester.enterText(find.byKey(const Key('new-password-field')), next);
    await tester.enterText(find.byKey(const Key('repeat-password-field')), repeat ?? next);
    await tester.tap(find.widgetWithText(FilledButton, 'Cambiar'));
    await tester.pumpAndSettle();
  }

  testWidgets('changes the password and keeps the session with the new tokens', (tester) async {
    await open(tester);
    await submit(tester, current: testPassword, next: 'Nueva-clave-2026');

    expect(auth.passwordChanges, [(current: testPassword, next: 'Nueva-clave-2026')]);
    expect(auth.currentSession!.accessToken, 'access-2');
    expect(find.byType(ChangePasswordDialog), findsNothing);
    expect(closedWith, isTrue);
  });

  testWidgets('checks the new password before sending it', (tester) async {
    await open(tester);

    await submit(tester, current: testPassword, next: 'corta');
    expect(find.text('Usa al menos 8 caracteres'), findsOneWidget);

    await submit(tester, current: testPassword, next: testPassword);
    expect(find.text('Debe ser distinta de la actual'), findsOneWidget);

    await submit(tester, current: testPassword, next: 'Nueva-clave-2026', repeat: 'Otra-2026');
    expect(find.text('No coincide con la contraseña nueva'), findsOneWidget);

    expect(auth.passwordChanges, isEmpty);
    expect(find.byType(ChangePasswordDialog), findsOneWidget);
  });

  testWidgets('shows why the server refused it and stays open', (tester) async {
    await open(tester);
    await submit(tester, current: 'otra-clave', next: 'Nueva-clave-2026');

    expect(find.text('La contraseña actual no es correcta.'), findsOneWidget);
    expect(find.byType(ChangePasswordDialog), findsOneWidget);
    expect(auth.passwordChanges, isEmpty);

    await tester.tap(find.text('Cancelar'));
    await tester.pumpAndSettle();
    expect(closedWith, isFalse);
    expect(auth.currentSession!.accessToken, 'access');
  });

  testWidgets('the account screen offers it while logged in', (tester) async {
    auth = FakeAuthRepository(testSession);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          authRepositoryProvider.overrideWithValue(auth),
          synchronizationServiceProvider.overrideWithValue(RecordingSyncService()),
          connectivityServiceProvider.overrideWithValue(FakeConnectivityService()),
        ],
        child: const MaterialApp(home: AccountScreen()),
      ),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.text('Cambiar contraseña'));
    await tester.pumpAndSettle();
    await submit(tester, current: testPassword, next: 'Nueva-clave-2026');

    expect(find.text('Contraseña cambiada. Tus otras sesiones se cerraron.'), findsOneWidget);
    expect(find.text(testUser.email), findsOneWidget);
    expect(auth.passwordChanges, hasLength(1));
  });
}
