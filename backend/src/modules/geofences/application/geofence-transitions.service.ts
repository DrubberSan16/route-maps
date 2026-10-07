import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client';
import { PlatformEventsService } from '../../events/application/platform-events.service';
import { PlatformEventInput } from '../../events/domain/platform-event';

/** Fixes less accurate than this (meters) do not change whether a trip is inside a geofence. */
export const MAX_TRANSITION_ACCURACY_METERS = 100;
/** Pre-filter of candidate geofences around a fix (degrees, about 1 km; index assisted). */
const CANDIDATE_RADIUS_DEGREES = 0.01;

/** The trip whose new fixes are checked, locked by the caller for the transaction. */
export interface TransitionTrip {
  id: string;
  userId: string;
  name: string | null;
  deviceId: string | null;
  metadata: unknown;
  geofencesCheckedAt: Date | null;
}

export interface CheckedFix {
  id: string;
  recordedAt: Date;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  /** Active geofences of the account that contain the fix. */
  inside: string[];
  /** Active geofences within the fix's accuracy radius (it may still be inside them). */
  near: string[];
}

export interface Transition {
  kind: 'entered' | 'exited';
  geofenceId: string;
  fix: CheckedFix;
  enteredAt: Date;
}

/**
 * Enter/exit decisions for fixes in time order. A geofence is entered when a fix falls inside it
 * and left when a fix is farther from it than the fix's accuracy, so GPS noise along the border
 * does not produce a burst of events. `state` (geofence → entered at) is updated in place.
 */
export function detectTransitions(state: Map<string, Date>, fixes: CheckedFix[]): Transition[] {
  const transitions: Transition[] = [];
  for (const fix of fixes) {
    const near = new Set([...fix.inside, ...fix.near]);
    for (const geofenceId of fix.inside) {
      if (state.has(geofenceId)) continue;
      state.set(geofenceId, fix.recordedAt);
      transitions.push({ kind: 'entered', geofenceId, fix, enteredAt: fix.recordedAt });
    }
    for (const [geofenceId, enteredAt] of state) {
      if (near.has(geofenceId)) continue;
      state.delete(geofenceId);
      transitions.push({ kind: 'exited', geofenceId, fix, enteredAt });
    }
  }
  return transitions;
}

/**
 * Emits `geofence.entered` and `geofence.exited` for the fixes of a trip as they arrive (live or
 * uploaded later from the offline queue). Each trip keeps which geofences it is inside of and the
 * time of the last fix checked: fixes that arrive older than that one, or with an accuracy worse
 * than MAX_TRANSITION_ACCURACY_METERS, do not change anything.
 */
@Injectable()
export class GeofenceTransitionsService {
  constructor(private readonly events: PlatformEventsService) {}

  /** Runs inside the transaction that stored the fixes; returns how many events it emitted. */
  async process(
    tx: Prisma.TransactionClient,
    trip: TransitionTrip,
    fixIds: string[],
  ): Promise<number> {
    if (fixIds.length === 0) return 0;
    const states = await tx.tripGeofenceState.findMany({
      where: { tripId: trip.id },
      include: { geofence: { select: { active: true } } },
    });
    if (states.length === 0) {
      const watched = await tx.geofence.count({ where: { userId: trip.userId, active: true } });
      if (watched === 0) return 0;
    }

    const fixes = await this.checkFixes(tx, trip, fixIds);
    if (fixes.length === 0) return 0;

    // Geofences disabled meanwhile are forgotten without an exit event.
    const state = new Map(
      states.filter((row) => row.geofence.active).map((row) => [row.geofenceId, row.enteredAt]),
    );
    const transitions = detectTransitions(state, fixes);

    await tx.tripGeofenceState.deleteMany({ where: { tripId: trip.id } });
    if (state.size > 0) {
      await tx.tripGeofenceState.createMany({
        data: [...state].map(([geofenceId, enteredAt]) => ({
          tripId: trip.id,
          geofenceId,
          enteredAt,
        })),
      });
    }
    await tx.$executeRaw`
      UPDATE trips SET geofences_checked_at = ${fixes[fixes.length - 1].recordedAt}::timestamptz
      WHERE id = ${trip.id}::uuid`;

    if (transitions.length === 0) return 0;
    const geofences = await tx.geofence.findMany({
      where: { id: { in: [...new Set(transitions.map((item) => item.geofenceId))] } },
      select: { id: true, name: true, type: true, metadata: true },
    });
    const byId = new Map(geofences.map((geofence) => [geofence.id, geofence]));
    for (const transition of transitions) {
      await this.events.emit(this.toEvent(trip, transition, byId.get(transition.geofenceId)), tx);
    }
    return transitions.length;
  }

  private async checkFixes(
    tx: Prisma.TransactionClient,
    trip: TransitionTrip,
    fixIds: string[],
  ): Promise<CheckedFix[]> {
    const ids = Prisma.join(fixIds.map((id) => Prisma.sql`${id}::uuid`));
    const rows = await tx.$queryRaw<
      {
        id: string;
        recorded_at: Date;
        latitude: number;
        longitude: number;
        accuracy: number | null;
        inside: string[];
        near: string[];
      }[]
    >`
      SELECT p.id, p.recorded_at, ST_Y(p.location) AS latitude, ST_X(p.location) AS longitude,
             p.accuracy,
             COALESCE(array_agg(g.id) FILTER (WHERE ST_Intersects(g.area, p.location)),
                      '{}') AS inside,
             COALESCE(array_agg(g.id) FILTER (
                        WHERE p.accuracy > 0
                          AND ST_DWithin(g.area::geography, p.location::geography, p.accuracy)),
                      '{}') AS near
      FROM trip_points p
      LEFT JOIN geofences g
        ON g.user_id = ${trip.userId}::uuid AND g.active
       AND ST_DWithin(g.area, p.location, ${CANDIDATE_RADIUS_DEGREES}::double precision)
      WHERE p.trip_id = ${trip.id}::uuid AND p.id IN (${ids})
        AND (${trip.geofencesCheckedAt}::timestamptz IS NULL
             OR p.recorded_at > ${trip.geofencesCheckedAt}::timestamptz)
        AND (p.accuracy IS NULL OR p.accuracy <= ${MAX_TRANSITION_ACCURACY_METERS}::double precision)
      GROUP BY p.id
      ORDER BY p.recorded_at`;
    return rows.map((row) => ({
      id: row.id,
      recordedAt: row.recorded_at,
      latitude: row.latitude,
      longitude: row.longitude,
      accuracy: row.accuracy,
      inside: row.inside,
      near: row.near,
    }));
  }

  private toEvent(
    trip: TransitionTrip,
    transition: Transition,
    geofence: { id: string; name: string; type: string; metadata: unknown } | undefined,
  ): PlatformEventInput {
    const { fix } = transition;
    const data: Record<string, unknown> = {
      trip: { id: trip.id, name: trip.name, deviceId: trip.deviceId, metadata: trip.metadata },
      geofence: {
        id: transition.geofenceId,
        name: geofence?.name ?? null,
        type: geofence?.type ?? null,
        metadata: geofence?.metadata ?? null,
      },
      position: {
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy: fix.accuracy,
        recordedAt: fix.recordedAt,
      },
      enteredAt: transition.enteredAt,
    };
    if (transition.kind === 'exited') {
      data.exitedAt = fix.recordedAt;
      data.dwellSeconds = Math.max(
        0,
        Math.round((fix.recordedAt.getTime() - transition.enteredAt.getTime()) / 1000),
      );
    }
    return {
      type: transition.kind === 'entered' ? 'geofence.entered' : 'geofence.exited',
      accountId: trip.userId,
      data,
    };
  }
}
