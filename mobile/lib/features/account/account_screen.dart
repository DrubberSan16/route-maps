import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/errors/app_exception.dart';
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
            child: Wrap(
              spacing: 8,
              children: [
                TextButton(
                  onPressed: form.isBusy ? null : () => _changePassword(context),
                  child: const Text('Cambiar contraseña'),
                ),
                OutlinedButton(
                  onPressed: form.isBusy
                      ? null
                      : () => ref.read(accountControllerProvider.notifier).logout(),
                  child: const Text('Cerrar sesión'),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Future<void> _changePassword(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    final changed = await showDialog<bool>(
      context: context,
      builder: (_) => const ChangePasswordDialog(),
    );
    if (changed ?? false) {
      messenger.showSnackBar(
        const SnackBar(content: Text('Contraseña cambiada. Tus otras sesiones se cerraron.')),
      );
    }
  }
}

/// Asks for the current password and the new one (twice). Closes with `true`
/// once the server changed it.
class ChangePasswordDialog extends ConsumerStatefulWidget {
  const ChangePasswordDialog({super.key});

  @override
  ConsumerState<ChangePasswordDialog> createState() => _ChangePasswordDialogState();
}

class _ChangePasswordDialogState extends ConsumerState<ChangePasswordDialog> {
  final _formKey = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _repeat = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _repeat.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return AlertDialog(
      title: const Text('Cambiar contraseña'),
      content: SingleChildScrollView(
        child: Form(
          key: _formKey,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                key: const Key('current-password-field'),
                controller: _current,
                decoration: const InputDecoration(labelText: 'Contraseña actual'),
                obscureText: true,
                autofillHints: const [AutofillHints.password],
                textInputAction: TextInputAction.next,
                validator: (value) =>
                    (value == null || value.isEmpty) ? 'Escribe tu contraseña actual' : null,
              ),
              TextFormField(
                key: const Key('new-password-field'),
                controller: _next,
                decoration: const InputDecoration(labelText: 'Contraseña nueva'),
                obscureText: true,
                autofillHints: const [AutofillHints.newPassword],
                textInputAction: TextInputAction.next,
                validator: (value) => (value == null || value.length < 8)
                    ? 'Usa al menos 8 caracteres'
                    : value == _current.text
                    ? 'Debe ser distinta de la actual'
                    : null,
              ),
              TextFormField(
                key: const Key('repeat-password-field'),
                controller: _repeat,
                decoration: const InputDecoration(labelText: 'Repite la contraseña nueva'),
                obscureText: true,
                autofillHints: const [AutofillHints.newPassword],
                onFieldSubmitted: (_) => _submit(),
                validator: (value) =>
                    value != _next.text ? 'No coincide con la contraseña nueva' : null,
              ),
              const SizedBox(height: 12),
              Text(
                'Tu sesión seguirá abierta en este teléfono y se cerrará en los demás.',
                style: theme.textTheme.bodySmall,
              ),
              if (_error case final error?)
                Padding(
                  padding: const EdgeInsets.only(top: 12),
                  child: Text(error, style: TextStyle(color: theme.colorScheme.error)),
                ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: _busy ? null : _submit,
          child: Text(_busy ? 'Cambiando…' : 'Cambiar'),
        ),
      ],
    );
  }

  Future<void> _submit() async {
    if (_busy || !_formKey.currentState!.validate()) return;
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await ref
          .read(authRepositoryProvider)
          .changePassword(currentPassword: _current.text, newPassword: _next.text);
      if (mounted) Navigator.of(context).pop(true);
    } on AppException catch (error) {
      if (mounted) {
        setState(() {
          _busy = false;
          _error = error.message;
        });
      }
    }
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
