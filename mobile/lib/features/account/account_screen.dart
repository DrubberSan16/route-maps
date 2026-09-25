import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/utils/formatters.dart';
import '../../domain/entities/sync.dart';
import '../../domain/entities/user.dart';
import '../../presentation/providers.dart';
import '../../presentation/widgets/connection_banner.dart';
import 'account_controller.dart';

/// Account (optional) and synchronization status.
class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider).value;
    return Scaffold(
      appBar: AppBar(title: const Text('Cuenta y sincronización')),
      body: ListView(
        children: [
          const ConnectionBanner(
            message: 'Sin conexión: tus cambios se guardan en el teléfono y se enviarán después.',
          ),
          if (session == null) const _LoginForm() else _SessionView(session: session),
          const Divider(),
          const _SyncStatus(),
          ListTile(
            dense: true,
            leading: const Icon(Icons.dns_outlined),
            title: Text('Servidor: ${ref.watch(appConfigProvider).apiBaseUrl}'),
          ),
        ],
      ),
    );
  }
}

class _SessionView extends ConsumerWidget {
  const _SessionView({required this.session});

  final AuthSession session;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final form = ref.watch(accountControllerProvider);
    return Column(
      children: [
        ListTile(
          leading: const Icon(Icons.account_circle, size: 40),
          title: Text(session.user.name),
          subtitle: Text(session.user.email),
        ),
        if (form.error case final error?)
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(error, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ),
        Align(
          alignment: Alignment.centerRight,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: OutlinedButton(
              onPressed: form.isBusy
                  ? null
                  : () => ref.read(accountControllerProvider.notifier).logout(),
              child: const Text('Cerrar sesión'),
            ),
          ),
        ),
      ],
    );
  }
}

class _LoginForm extends ConsumerStatefulWidget {
  const _LoginForm();

  @override
  ConsumerState<_LoginForm> createState() => _LoginFormState();
}

class _LoginFormState extends ConsumerState<_LoginForm> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _register = false;

  @override
  void dispose() {
    _name.dispose();
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final form = ref.watch(accountControllerProvider);
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Form(
        key: _formKey,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'La cuenta es opcional: el mapa, las descargas y las rutas funcionan sin ella. '
              'Inicia sesión para guardar tus rutas y recorridos en el servidor.',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
            const SizedBox(height: 12),
            if (_register)
              TextFormField(
                key: const Key('name-field'),
                controller: _name,
                decoration: const InputDecoration(labelText: 'Nombre'),
                textInputAction: TextInputAction.next,
                validator: (value) =>
                    (value == null || value.trim().isEmpty) ? 'Escribe tu nombre' : null,
              ),
            TextFormField(
              key: const Key('email-field'),
              controller: _email,
              decoration: const InputDecoration(labelText: 'Correo electrónico'),
              keyboardType: TextInputType.emailAddress,
              autofillHints: const [AutofillHints.email],
              textInputAction: TextInputAction.next,
              validator: (value) =>
                  (value == null || !value.contains('@')) ? 'Escribe un correo válido' : null,
            ),
            TextFormField(
              key: const Key('password-field'),
              controller: _password,
              decoration: const InputDecoration(labelText: 'Contraseña'),
              obscureText: true,
              autofillHints: const [AutofillHints.password],
              validator: (value) => _register && (value == null || value.length < 8)
                  ? 'Usa al menos 8 caracteres'
                  : (value == null || value.isEmpty)
                  ? 'Escribe tu contraseña'
                  : null,
            ),
            if (form.error case final error?)
              Padding(
                padding: const EdgeInsets.only(top: 12),
                child: Text(error, style: TextStyle(color: Theme.of(context).colorScheme.error)),
              ),
            const SizedBox(height: 16),
            FilledButton(
              onPressed: form.isBusy ? null : _submit,
              child: Text(_register ? 'Crear cuenta' : 'Iniciar sesión'),
            ),
            TextButton(
              onPressed: form.isBusy ? null : () => setState(() => _register = !_register),
              child: Text(_register ? 'Ya tengo cuenta' : 'Crear una cuenta'),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;
    final controller = ref.read(accountControllerProvider.notifier);
    if (_register) {
      await controller.register(_name.text.trim(), _email.text.trim(), _password.text);
    } else {
      await controller.login(_email.text.trim(), _password.text);
    }
  }
}

class _SyncStatus extends ConsumerWidget {
  const _SyncStatus();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(syncStateProvider).value ?? const SyncState();
    final service = ref.read(synchronizationServiceProvider);
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Sincronización', style: theme.textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(
            state.pending == 0
                ? 'No hay cambios pendientes.'
                : '${state.pending} cambios pendientes de enviar.',
            key: const Key('sync-pending'),
          ),
          if (state.failed > 0)
            Text(
              '${state.failed} cambios rechazados por el servidor.',
              style: TextStyle(color: theme.colorScheme.error),
            ),
          Text(
            state.lastSyncAt == null
                ? 'Todavía no se sincronizó.'
                : 'Última sincronización: ${formatRelative(state.lastSyncAt!)}.',
          ),
          if (!state.isAuthenticated)
            const Text('Inicia sesión para enviar tus cambios al servidor.'),
          if (state.lastError case final error?)
            Text(error, style: TextStyle(color: theme.colorScheme.error)),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            children: [
              FilledButton.tonal(
                onPressed: state.isSyncing || !state.isAuthenticated ? null : service.synchronize,
                child: Text(state.isSyncing ? 'Sincronizando…' : 'Sincronizar ahora'),
              ),
              if (state.failed > 0)
                OutlinedButton(
                  onPressed: service.retryFailed,
                  child: const Text('Reintentar rechazados'),
                ),
            ],
          ),
        ],
      ),
    );
  }
}
