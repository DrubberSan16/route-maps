import {
  GeocodingProvider,
  GeocodingResult,
  GeocodingUnavailableError,
} from '../domain/geocoding-provider';
import { CompositeGeocodingProvider, mergeResults } from './composite-geocoding.provider';
import { WorldPlaceIndex, WorldPlaceMatch } from './world-place-index';

const result = (name: string, latitude: number, longitude: number): GeocodingResult => ({
  displayName: name,
  name,
  latitude,
  longitude,
  category: null,
  type: null,
  address: {},
  bbox: null,
  sourceId: null,
});

const world = (matches: WorldPlaceMatch[], available = true) =>
  ({
    search: jest.fn().mockResolvedValue(matches),
    available: jest.fn().mockResolvedValue(available),
  }) as unknown as WorldPlaceIndex;

const detailedProvider = (overrides: Partial<GeocodingProvider>): GeocodingProvider => ({
  name: 'nominatim',
  enabled: true,
  search: jest.fn().mockResolvedValue([]),
  reverse: jest.fn().mockResolvedValue(null),
  health: jest.fn().mockResolvedValue('up'),
  ...overrides,
});

const lima = { result: result('Lima', -12.046, -77.043), important: true };
const limaOhio = { result: result('Lima', 40.743, -84.105), important: false };
const query = { text: 'Lima', limit: 10 };

describe('mergeResults', () => {
  it('puts important world places first, then detailed results, then other places', () => {
    const street = result('Calle Lima', -2.19, -79.88);

    expect(mergeResults([lima, limaOhio], [street], 10).map((r) => r.latitude)).toEqual([
      -12.046, -2.19, 40.743,
    ]);
  });

  it('drops a detailed result that is the same place as a world one, and applies the limit', () => {
    const limaFromNominatim = result('Lima', -12.05, -77.04);

    expect(mergeResults([lima], [limaFromNominatim], 10)).toEqual([lima.result]);
    expect(mergeResults([lima, limaOhio], [], 1)).toEqual([lima.result]);
  });

  it('prefers the best nearby place of the prepared country found by its popular name', () => {
    const dominican = { result: result('Santo Domingo', 18.47, -69.89), important: true };
    const colorados = { ...result('Santo Domingo de los Colorados', -0.25, -79.17), type: 'city' };
    const clinic = { ...result('Santo Domingo', -0.26, -79.18), type: 'clinic' };

    expect(
      mergeResults([dominican], [colorados, clinic], 5, {
        text: 'Santo Domingo',
        limit: 5,
        near: { latitude: -0.25, longitude: -79.17 },
      }),
    ).toEqual([colorados, dominican.result, clinic]);
  });

  it('keeps the order of the detailed index (a park before a namesake parish)', () => {
    const park = { ...result('Parque la Carolina', -0.18, -78.48), type: 'park' };
    const parish = { ...result('La Carolina', 0.67, -78.24), type: 'administrative' };

    expect(
      mergeResults([], [park, parish], 5, {
        text: 'La Carolina',
        limit: 5,
        near: { latitude: -0.2, longitude: -78.49 },
      }),
    ).toEqual([park, parish]);
  });

  it('puts the world namesake first when the map shows another continent', () => {
    const dominican = { result: result('Santo Domingo', 18.47, -69.89), important: true };
    const colorados = { ...result('Santo Domingo de los Colorados', -0.25, -79.17), type: 'city' };

    expect(
      mergeResults([dominican], [colorados], 5, {
        text: 'Santo Domingo',
        limit: 5,
        near: { latitude: 40.42, longitude: -3.7 },
      })[0],
    ).toBe(dominican.result);
  });

  it('prefers an exact prepared-country place near the requested map centre', () => {
    const macasar = { result: result('Macasar', -5.14, 119.41), important: true };
    const macas = { ...result('Macas', -2.31, -78.11), type: 'city' };

    expect(
      mergeResults([macasar], [macas], 5, {
        text: 'Macas',
        limit: 5,
        near: { latitude: -2.31, longitude: -78.11 },
      })[0],
    ).toBe(macas);
  });
});

describe('CompositeGeocodingProvider', () => {
  it('keeps answering "unavailable" when nothing can search', async () => {
    const detailed = detailedProvider({
      enabled: false,
      search: jest.fn().mockRejectedValue(new GeocodingUnavailableError('disabled')),
    });
    const provider = new CompositeGeocodingProvider(detailed, world([], false));

    await expect(provider.search(query)).rejects.toBeInstanceOf(GeocodingUnavailableError);
  });

  it('searches the world places alone while the detailed provider is disabled', async () => {
    const detailed = detailedProvider({ enabled: false });
    const provider = new CompositeGeocodingProvider(detailed, world([lima, limaOhio]));

    await expect(provider.search(query)).resolves.toEqual([lima.result, limaOhio.result]);
    expect(detailed.search).not.toHaveBeenCalled();
    await expect(
      new CompositeGeocodingProvider(detailed, world([])).search(query),
    ).resolves.toEqual([]);
  });

  it('merges both sources and survives a failing detailed provider', async () => {
    const street = result('Calle Lima', -2.19, -79.88);
    const provider = new CompositeGeocodingProvider(
      detailedProvider({ search: jest.fn().mockResolvedValue([street]) }),
      world([lima]),
    );
    await expect(provider.search(query)).resolves.toEqual([lima.result, street]);

    const failing = detailedProvider({
      search: jest.fn().mockRejectedValue(new GeocodingUnavailableError('down')),
    });
    await expect(
      new CompositeGeocodingProvider(failing, world([lima])).search(query),
    ).resolves.toEqual([lima.result]);
    await expect(
      new CompositeGeocodingProvider(failing, world([])).search(query),
    ).rejects.toBeInstanceOf(GeocodingUnavailableError);
  });

  it('is degraded for a while after the detailed provider fails', async () => {
    let now = 1_000;
    const detailed = detailedProvider({
      search: jest.fn().mockRejectedValue(new GeocodingUnavailableError('down')),
    });
    const provider = new CompositeGeocodingProvider(detailed, world([lima]), () => now);
    expect(provider.degraded).toBe(false);

    await provider.search(query);
    expect(provider.degraded).toBe(true);
    now += CompositeGeocodingProvider.DEGRADED_MS;
    expect(provider.degraded).toBe(false);
  });

  it('delegates reverse geocoding, name and health to the detailed provider', async () => {
    const detailed = detailedProvider({ reverse: jest.fn().mockResolvedValue(street()) });
    const provider = new CompositeGeocodingProvider(detailed, world([]));

    await expect(provider.reverse(-2.19, -79.88, 'es')).resolves.toMatchObject({ name: 'Malecón' });
    expect(detailed.reverse).toHaveBeenCalledWith(-2.19, -79.88, 'es');
    await expect(provider.health()).resolves.toBe('up');
    expect(provider.name).toBe('nominatim');
    expect(provider.enabled).toBe(true);
  });
});

function street(): GeocodingResult {
  return result('Malecón', -2.19, -79.88);
}
