import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GeocodingUnavailableError } from '../domain/geocoding-provider';
import { NominatimGeocodingProvider } from './nominatim-geocoding.provider';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, '__fixtures__', name), 'utf8'));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('NominatimGeocodingProvider', () => {
  const provider = new NominatimGeocodingProvider({
    baseUrl: 'http://nominatim:8080/',
    timeoutMs: 1000,
    defaultCountryCodes: 'EC',
  });
  let fetchMock: jest.SpyInstance<Promise<Response>, Parameters<typeof fetch>>;

  const requestedUrl = () => new URL(fetchMock.mock.calls[0][0]);

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => fetchMock.mockRestore());

  describe('search', () => {
    it('maps jsonv2 results with their address, bbox and OSM id', async () => {
      fetchMock.mockResolvedValue(jsonResponse(fixture('nominatim-search.json')));

      const results = await provider.search({ text: 'Casino', limit: 2, language: 'es' });

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({
        displayName: 'Casino, Rue Princesse Antoinette, La Condamine, Mónaco, 98000, Mónaco',
        name: 'Casino',
        latitude: 43.735333,
        longitude: 7.421016,
        category: 'shop',
        type: 'convenience',
        address: {
          road: 'Rue Princesse Antoinette',
          houseNumber: undefined,
          neighbourhood: undefined,
          suburb: 'La Condamine',
          city: 'Mónaco',
          state: undefined,
          postcode: '98000',
          country: 'Mónaco',
          countryCode: 'MC',
        },
        // Nominatim sends [minLat, maxLat, minLon, maxLon].
        bbox: [7.420966, 43.735283, 7.421066, 43.735383],
        sourceId: 'osm:node:954713831',
      });
      expect(results[1]).toMatchObject({ name: 'Place du Casino', sourceId: 'osm:way:4229659' });
    });

    it('asks for jsonv2 with address details, the language and the default countries', async () => {
      fetchMock.mockResolvedValue(jsonResponse([]));

      await provider.search({ text: 'Malecón 2000', limit: 5, language: 'es' });

      const url = requestedUrl();
      expect(`${url.origin}${url.pathname}`).toBe('http://nominatim:8080/search');
      expect(Object.fromEntries(url.searchParams)).toEqual({
        q: 'Malecón 2000',
        format: 'jsonv2',
        addressdetails: '1',
        limit: '5',
        countrycodes: 'ec',
        'accept-language': 'es',
      });
    });

    it('prefers the countries of the request and biases towards the given point', async () => {
      fetchMock.mockResolvedValue(jsonResponse([]));

      await provider.search({
        text: 'hospital',
        limit: 10,
        countryCodes: ['MC', 'FR'],
        near: { latitude: -2.19, longitude: -79.88 },
      });

      const params = requestedUrl().searchParams;
      expect(params.get('countrycodes')).toBe('mc,fr');
      // ~50 km box as left,top,right,bottom; without `bounded` it is only a preference.
      expect(params.get('viewbox')).toBe('-80.33000,-1.74000,-79.43000,-2.64000');
      expect(params.has('bounded')).toBe(false);
    });
  });

  describe('reverse', () => {
    it('maps the nearest place', async () => {
      fetchMock.mockResolvedValue(jsonResponse(fixture('nominatim-reverse.json')));

      const result = await provider.reverse(43.7384, 7.4246, 'es');

      expect(Object.fromEntries(requestedUrl().searchParams)).toEqual({
        lat: '43.7384',
        lon: '7.4246',
        format: 'jsonv2',
        addressdetails: '1',
        'accept-language': 'es',
      });
      expect(result).toMatchObject({
        displayName: "Avenue de l'Hermitage, Monte-Carlo, Mónaco, 98000, Mónaco",
        name: "Avenue de l'Hermitage",
        category: 'highway',
        address: { road: "Avenue de l'Hermitage", suburb: 'Monte-Carlo', countryCode: 'MC' },
        sourceId: 'osm:way:4229537',
      });
      expect(result?.latitude).toBeCloseTo(43.738283, 6);
      expect(result?.longitude).toBeCloseTo(7.424561, 6);
    });

    it('returns null when there is nothing nearby', async () => {
      fetchMock.mockResolvedValue(jsonResponse(fixture('nominatim-reverse-not-found.json')));

      await expect(provider.reverse(-60, -120)).resolves.toBeNull();
    });
  });

  describe('errors', () => {
    it('reports a rejected request as unavailable geocoding', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: 'Bad Request' }, 400));

      const search = provider.search({ text: 'x', limit: 1 });

      await expect(search).rejects.toBeInstanceOf(GeocodingUnavailableError);
      await expect(search).rejects.toThrow('Nominatim rejected the request (400)');
    });

    it.each([
      ['a server error', () => Promise.resolve(jsonResponse({}, 503))],
      ['a network failure', () => Promise.reject(new TypeError('fetch failed'))],
    ])('reports %s as Nominatim being unavailable', async (_case, respond) => {
      fetchMock.mockImplementation(respond);

      await expect(provider.reverse(43.7, 7.4)).rejects.toThrow('Nominatim is unavailable');
    });
  });

  describe('health', () => {
    it('is up when /status answers status 0', async () => {
      fetchMock.mockResolvedValue(jsonResponse(fixture('nominatim-status.json')));

      await expect(provider.health()).resolves.toBe('up');
      expect(requestedUrl().pathname).toBe('/status');
    });

    it('is down when the status is not OK or the server cannot be reached', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: 700, message: 'No database' }));
      await expect(provider.health()).resolves.toBe('down');

      fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
      await expect(provider.health()).resolves.toBe('down');
    });
  });
});
