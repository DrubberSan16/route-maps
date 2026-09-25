import { ManeuverType } from '../../domain/entities/route-result';

export interface OsrmManeuver {
  type: string;
  modifier?: string;
  exit?: number;
}

const DIRECTION_ES: Record<string, string> = {
  left: 'a la izquierda',
  right: 'a la derecha',
  'slight left': 'levemente a la izquierda',
  'slight right': 'levemente a la derecha',
  'sharp left': 'bruscamente a la izquierda',
  'sharp right': 'bruscamente a la derecha',
};

const ordinal = (n: number) => `${n}.ª`;

/**
 * Builds a Spanish instruction from an OSRM maneuver. OSRM only returns
 * maneuver types; Valhalla returns localised narrative itself.
 */
export function buildSpanishInstruction(maneuver: OsrmManeuver, name: string): string {
  const street = name.trim();
  const onto = street ? ` por ${street}` : '';
  const modifier = maneuver.modifier ?? 'straight';
  const turn = DIRECTION_ES[modifier];

  switch (maneuver.type) {
    case 'depart':
      return `Inicie el recorrido${onto}`;
    case 'arrive': {
      const side = modifier.endsWith('left')
        ? 'izquierda'
        : modifier.endsWith('right')
          ? 'derecha'
          : '';
      return side ? `Ha llegado a su destino, a la ${side}` : 'Ha llegado a su destino';
    }
    case 'roundabout turn':
      return turn ? `En la rotonda, gire ${turn}${onto}` : `En la rotonda, continúe recto${onto}`;
    case 'roundabout':
    case 'rotary':
      return maneuver.exit
        ? `En la rotonda, tome la ${ordinal(maneuver.exit)} salida${onto}`
        : `Entre en la rotonda${onto}`;
    case 'exit roundabout':
    case 'exit rotary':
      return `Salga de la rotonda${onto}`;
    case 'merge':
      return `Incorpórese${onto}`;
    case 'on ramp':
      return `Tome la rampa${turn ? ` ${turn}` : ''}${onto}`;
    case 'off ramp':
      return `Tome la salida${turn ? ` ${turn}` : ''}${onto}`;
    case 'fork':
      return `En la bifurcación, manténgase ${turn ?? 'recto'}${onto}`;
    case 'end of road':
      return `Al final de la vía, gire ${turn ?? 'según la vía'}${onto}`;
    default:
      if (modifier === 'uturn') return `Dé la vuelta en U${onto}`;
      if (modifier === 'straight' || !turn)
        return street ? `Continúe por ${street}` : 'Continúe recto';
      return `Gire ${turn}${onto}`;
  }
}

export function osrmManeuverType(maneuver: OsrmManeuver): ManeuverType {
  switch (maneuver.type) {
    case 'depart':
      return 'DEPART';
    case 'arrive':
      return 'ARRIVE';
    case 'roundabout':
    case 'rotary':
      return 'ROUNDABOUT_ENTER';
    case 'exit roundabout':
    case 'exit rotary':
      return 'ROUNDABOUT_EXIT';
    case 'merge':
      return 'MERGE';
    case 'on ramp':
      return 'RAMP';
    case 'off ramp':
      return 'EXIT';
  }
  switch (maneuver.modifier) {
    case 'left':
      return 'TURN_LEFT';
    case 'right':
      return 'TURN_RIGHT';
    case 'slight left':
      return 'SLIGHT_LEFT';
    case 'slight right':
      return 'SLIGHT_RIGHT';
    case 'sharp left':
      return 'SHARP_LEFT';
    case 'sharp right':
      return 'SHARP_RIGHT';
    case 'uturn':
      return 'UTURN';
    default:
      return 'CONTINUE';
  }
}
