import { buildSpanishInstruction, OsrmManeuver, osrmManeuverType } from './osrm-instructions';

describe('OSRM instructions', () => {
  it.each<[OsrmManeuver, string, string]>([
    [{ type: 'depart' }, 'Avenida 9 de Octubre', 'Inicie el recorrido por Avenida 9 de Octubre'],
    [{ type: 'depart' }, '', 'Inicie el recorrido'],
    [{ type: 'arrive' }, '', 'Ha llegado a su destino'],
    [{ type: 'arrive', modifier: 'left' }, '', 'Ha llegado a su destino, a la izquierda'],
    [{ type: 'turn', modifier: 'left' }, 'Malecón', 'Gire a la izquierda por Malecón'],
    [{ type: 'turn', modifier: 'sharp right' }, '', 'Gire bruscamente a la derecha'],
    [{ type: 'new name', modifier: 'straight' }, 'Av. Olmedo', 'Continúe por Av. Olmedo'],
    [{ type: 'continue', modifier: 'uturn' }, '', 'Dé la vuelta en U'],
    [
      { type: 'roundabout', modifier: 'right', exit: 2 },
      'Av. de las Américas',
      'En la rotonda, tome la 2.ª salida por Av. de las Américas',
    ],
    [{ type: 'rotary' }, '', 'Entre en la rotonda'],
    [
      { type: 'exit roundabout', modifier: 'right' },
      'Av. Quito',
      'Salga de la rotonda por Av. Quito',
    ],
    [{ type: 'roundabout turn', modifier: 'left' }, '', 'En la rotonda, gire a la izquierda'],
    [{ type: 'roundabout turn', modifier: 'straight' }, '', 'En la rotonda, continúe recto'],
    [{ type: 'merge', modifier: 'slight left' }, 'Perimetral', 'Incorpórese por Perimetral'],
    [{ type: 'on ramp', modifier: 'right' }, '', 'Tome la rampa a la derecha'],
    [{ type: 'off ramp', modifier: 'slight right' }, '', 'Tome la salida levemente a la derecha'],
    [
      { type: 'fork', modifier: 'slight left' },
      '',
      'En la bifurcación, manténgase levemente a la izquierda',
    ],
    [{ type: 'end of road', modifier: 'right' }, '', 'Al final de la vía, gire a la derecha'],
  ])('%j on "%s" reads "%s"', (maneuver, street, expected) => {
    expect(buildSpanishInstruction(maneuver, street)).toBe(expected);
  });

  it.each<[OsrmManeuver, string]>([
    [{ type: 'depart' }, 'DEPART'],
    [{ type: 'arrive', modifier: 'right' }, 'ARRIVE'],
    [{ type: 'roundabout', exit: 1 }, 'ROUNDABOUT_ENTER'],
    [{ type: 'exit rotary' }, 'ROUNDABOUT_EXIT'],
    [{ type: 'merge' }, 'MERGE'],
    [{ type: 'on ramp' }, 'RAMP'],
    [{ type: 'off ramp' }, 'EXIT'],
    [{ type: 'turn', modifier: 'left' }, 'TURN_LEFT'],
    [{ type: 'turn', modifier: 'slight right' }, 'SLIGHT_RIGHT'],
    [{ type: 'continue', modifier: 'uturn' }, 'UTURN'],
    [{ type: 'new name', modifier: 'straight' }, 'CONTINUE'],
  ])('%j is normalised to %s', (maneuver, expected) => {
    expect(osrmManeuverType(maneuver)).toBe(expected);
  });
});
