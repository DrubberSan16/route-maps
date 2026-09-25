import 'package:flutter/material.dart';

import '../../../core/utils/formatters.dart';
import '../../../domain/entities/route.dart';
import 'maneuver_icon.dart';

/// Turn-by-turn list of a route.
Future<void> showStepsSheet(BuildContext context, RouteOption option) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  showDragHandle: true,
  builder: (context) => DraggableScrollableSheet(
    expand: false,
    initialChildSize: 0.6,
    maxChildSize: 0.95,
    builder: (context, controller) => ListView.separated(
      controller: controller,
      itemCount: option.steps.length + 1,
      separatorBuilder: (_, _) => const Divider(height: 1),
      itemBuilder: (context, index) {
        if (index == 0) {
          return ListTile(
            title: Text(
              'Indicaciones · ${formatDuration(option.durationSeconds)} '
              '(${formatDistance(option.distanceMeters)})',
              style: Theme.of(context).textTheme.titleMedium,
            ),
          );
        }
        final step = option.steps[index - 1];
        return ListTile(
          leading: Icon(maneuverIcon(step.maneuver)),
          title: Text(step.instruction),
          subtitle: step.streetNames.isEmpty ? null : Text(step.streetNames.join(', ')),
          trailing: step.distanceMeters > 0 ? Text(formatDistance(step.distanceMeters)) : null,
        );
      },
    ),
  ),
);
