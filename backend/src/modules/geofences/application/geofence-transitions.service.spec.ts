import { CheckedFix, detectTransitions } from './geofence-transitions.service';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 7, 12, minute));

const fix = (minute: number, inside: string[] = [], near: string[] = []): CheckedFix => ({
  id: `fix-${minute}`,
  recordedAt: at(minute),
  latitude: -2.19,
  longitude: -79.88,
  accuracy: 10,
  inside,
  near,
});

const summary = (transitions: ReturnType<typeof detectTransitions>) =>
  transitions.map((item) => `${item.kind}:${item.geofenceId}@${item.fix.id}`);

describe('detectTransitions', () => {
  it('enters when a fix falls inside and exits when a fix is clearly outside', () => {
    const state = new Map<string, Date>();
    const transitions = detectTransitions(state, [
      fix(0),
      fix(1, ['depot']),
      fix(2, ['depot']),
      fix(3),
    ]);

    expect(summary(transitions)).toEqual(['entered:depot@fix-1', 'exited:depot@fix-3']);
    expect(transitions[1].enteredAt).toEqual(at(1));
    expect(state.size).toBe(0);
  });

  it('does not exit while the fix is within its accuracy of the border', () => {
    const state = new Map<string, Date>();
    const transitions = detectTransitions(state, [
      fix(0, ['depot']),
      // Outside the polygon but closer to it than the GPS accuracy: still inside.
      fix(1, [], ['depot']),
      fix(2, ['depot']),
      fix(3, [], ['depot']),
    ]);

    expect(summary(transitions)).toEqual(['entered:depot@fix-0']);
    expect(state.get('depot')).toEqual(at(0));
  });

  it('continues from the stored state of earlier batches', () => {
    const state = new Map([['depot', at(0)]]);
    const transitions = detectTransitions(state, [fix(10, ['depot']), fix(11, ['client'])]);

    expect(summary(transitions)).toEqual(['entered:client@fix-11', 'exited:depot@fix-11']);
    // The exit keeps the original entry time, for the dwell time.
    expect(transitions[1].enteredAt).toEqual(at(0));
    expect([...state.keys()]).toEqual(['client']);
  });

  it('handles overlapping geofences independently', () => {
    const state = new Map<string, Date>();
    const transitions = detectTransitions(state, [
      fix(0, ['city']),
      fix(1, ['city', 'depot']),
      fix(2, ['city']),
      fix(3),
    ]);

    expect(summary(transitions)).toEqual([
      'entered:city@fix-0',
      'entered:depot@fix-1',
      'exited:depot@fix-2',
      'exited:city@fix-3',
    ]);
  });

  it('produces nothing without fixes', () => {
    const state = new Map([['depot', at(0)]]);
    expect(detectTransitions(state, [])).toEqual([]);
    expect(state.get('depot')).toEqual(at(0));
  });
});
