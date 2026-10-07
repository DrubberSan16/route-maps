import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer, IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { AppConfigService } from '../src/config/app-config.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { ApiKeyAuthenticatorService } from '../src/modules/integrations/application/api-key-authenticator.service';
import { verifySignature } from '../src/modules/integrations/domain/webhook-signature';
import { SecretBox } from '../src/modules/integrations/infrastructure/secret-box';
import { WebhookDispatcher } from '../src/modules/integrations/infrastructure/webhook-dispatcher';
import { WebhookSender } from '../src/modules/integrations/infrastructure/webhook-sender';
import { MapRegionService } from '../src/modules/regions/application/map-region.service';
import { ROUTING_PROVIDER } from '../src/modules/routing/domain/interfaces/routing-provider';
import { ROUTING_PROFILES } from '../src/modules/routing/domain/value-objects/routing-profile';

/** Names of the integrations this suite creates (removed before and after it runs). */
const PREFIX = 'e2e admin';
const RUN = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
const PASSWORD = 'E2e-Admin-Password-2026';
const TEMPORARY_PASSWORD = /^[A-HJ-NP-Za-km-np-z2-9]{4}(-[A-HJ-NP-Za-km-np-z2-9]{4}){3}$/;

// A depot in the north of Guayaquil, away from the trips of the other suite.
const DEPOT = { latitude: -2.13, longitude: -79.9 };
const FAR_AWAY = { latitude: -2.15, longitude: -79.9 };
const REGION = 'e2e-admin-salinas';

/** The part of the event data the suite reads (the rest is checked with toMatchObject). */
interface EventData {
  geofence?: { id: string };
  trip?: { id: string; status: string };
  region?: { code: string };
  dwellSeconds?: number;
}

interface Received {
  /** Path the webhook was sent to. */
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
  event: {
    id: string;
    seq: string;
    type: string;
    accountId: string | null;
    account: { id: string; email: string; name: string } | null;
    data: EventData;
  };
}

interface Delivery {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  nextAttemptAt: string | null;
}

describe('Administration and integrations (e2e)', () => {
  let app: NestExpressApplication;
  let http: App;
  let prisma: PrismaService;
  let dispatcher: WebhookDispatcher;
  let receiver: Server;
  let receiverUrl: string;
  let receiverStatus = 200;
  const received: Received[] = [];
  /** Geofence the operator creates for the driver's account. */
  let depotId: string;

  const tokens: Record<'admin' | 'operator' | 'driver', string> = {
    admin: '',
    operator: '',
    driver: '',
  };
  const ids: Record<'admin' | 'operator' | 'driver', string> = {
    admin: '',
    operator: '',
    driver: '',
  };
  const email = (who: string) => `e2e-${who}-${RUN}@example.com`;

  const as = (who: keyof typeof tokens) => ({
    get: (path: string) =>
      request(http).get(`/api/v1${path}`).set('Authorization', `Bearer ${tokens[who]}`),
    post: (path: string) =>
      request(http).post(`/api/v1${path}`).set('Authorization', `Bearer ${tokens[who]}`),
    patch: (path: string) =>
      request(http).patch(`/api/v1${path}`).set('Authorization', `Bearer ${tokens[who]}`),
    delete: (path: string) =>
      request(http).delete(`/api/v1${path}`).set('Authorization', `Bearer ${tokens[who]}`),
  });
  const withKey = (key: string) => ({
    get: (path: string) => request(http).get(`/api/v1${path}`).set('X-API-Key', key),
    post: (path: string) => request(http).post(`/api/v1${path}`).set('X-API-Key', key),
  });

  // Sign-ins are limited per client address: each one of the suite comes from its own.
  let clients = 0;
  const client = () => `198.51.100.${++clients}`;
  const signIn = (address: string, password: string) =>
    request(http)
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', client())
      .send({ email: address, password });
  const login = async (address: string, password = PASSWORD) =>
    (await signIn(address, password).expect(200)).body.data as {
      accessToken: string;
      refreshToken: string;
      user: { id: string };
    };

  const signUp = async (who: keyof typeof tokens, role?: 'ADMIN' | 'OPERATOR') => {
    const address = email(who);
    await request(http)
      .post('/api/v1/auth/register')
      .set('X-Forwarded-For', client())
      .send({ email: address, password: PASSWORD, name: `E2E ${who}` })
      .expect(201);
    if (role) await prisma.user.update({ where: { email: address }, data: { role } });
    const session = await login(address);
    tokens[who] = session.accessToken;
    ids[who] = session.user.id;
  };

  /** Sends every due delivery, as the worker process does. */
  const deliver = async () => {
    for (let round = 0; round < 10 && (await dispatcher.runOnce()) > 0; round++);
  };

  const ago = (seconds: number) => new Date(Date.now() - seconds * 1000).toISOString();

  const cleanUp = async () => {
    const integrations = await prisma.integration.findMany({
      where: { name: { startsWith: PREFIX } },
      select: { userId: true, user: { select: { serviceAccount: true } } },
    });
    await prisma.integration.deleteMany({ where: { name: { startsWith: PREFIX } } });
    const serviceAccounts = integrations
      .filter((integration) => integration.user.serviceAccount)
      .map((integration) => integration.userId);
    await prisma.user.deleteMany({ where: { id: { in: serviceAccounts } } });
  };

  beforeAll(async () => {
    receiver = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        received.push({ url: req.url ?? '', headers: req.headers, body, event: JSON.parse(body) });
        res
          .writeHead(receiverStatus, { 'content-type': 'text/plain' })
          .end(`status ${receiverStatus}`);
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/route-maps`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ROUTING_PROVIDER)
      .useValue({
        name: 'e2e-unused',
        supportedProfiles: () => [...ROUTING_PROFILES],
        calculateRoute: () => Promise.reject(new Error('Not used by this suite')),
        health: () => Promise.resolve('up' as const),
      })
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ bufferLogs: true });
    configureApp(app);
    await app.init();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    const config = app.get(AppConfigService);
    dispatcher = new WebhookDispatcher(prisma, new WebhookSender(config), new SecretBox(config));

    await cleanUp();
    await signUp('admin', 'ADMIN');
    await signUp('operator', 'OPERATOR');
    await signUp('driver');
    // Administrators left by earlier runs would hide the last-administrator rule.
    await prisma.user.updateMany({
      where: { role: 'ADMIN', id: { not: ids.admin } },
      data: { active: false },
    });
  });

  afterAll(async () => {
    if (prisma) await cleanUp();
    await app?.close();
    receiver?.closeAllConnections();
    await new Promise<void>((resolve) => (receiver ? receiver.close(() => resolve()) : resolve()));
  });

  describe('panel access', () => {
    it('keeps the panel to administrators and operators', async () => {
      await request(http).get('/api/v1/admin/overview').expect(401);
      await as('driver')
        .get('/admin/overview')
        .expect(403)
        .expect(({ body }) => expect(body.error.code).toBe('FORBIDDEN'));

      await as('operator').get('/admin/overview').expect(200);
      await as('operator').get('/admin/trips').expect(200);
      for (const path of ['/admin/users', '/admin/audit', '/admin/integrations']) {
        await as('operator').get(path).expect(403);
      }

      const meta = (await as('admin').get('/admin/meta').expect(200)).body.data;
      expect(meta.user).toMatchObject({ id: ids.admin, role: 'ADMIN', email: email('admin') });
      expect(meta.scopes).toEqual(expect.arrayContaining(['trips:read', 'events:read']));
      expect(meta.eventTypes).toEqual(expect.arrayContaining(['geofence.entered']));
      expect(meta.webhooks).toMatchObject({ maxAttempts: 8 });
    });

    it('summarises the platform for the overview', async () => {
      const overview = (await as('admin').get('/admin/overview').expect(200)).body.data;
      expect(overview.accounts.administrators).toBeGreaterThanOrEqual(1);
      expect(overview.accounts.operators).toBeGreaterThanOrEqual(1);
      expect(overview.series).toHaveLength(14);
      expect(overview.series[13].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(overview.webhooks).toEqual(
        expect.objectContaining({ pending: expect.any(Number), failing: expect.any(Number) }),
      );
    });
  });

  describe('accounts', () => {
    let memberId: string;
    let memberPassword: string;

    it('creates an account with a temporary password shown once', async () => {
      const res = await as('admin')
        .post('/admin/users')
        .send({ email: email('member'), name: 'E2E member', role: 'OPERATOR' })
        .expect(201);
      expect(res.body.data.temporaryPassword).toMatch(TEMPORARY_PASSWORD);
      expect(res.body.data.user).toMatchObject({ role: 'OPERATOR', active: true });
      expect(JSON.stringify(res.body)).not.toContain('passwordHash');
      memberId = res.body.data.user.id;
      memberPassword = res.body.data.temporaryPassword;

      const session = await login(email('member'), memberPassword);
      expect(session.user.id).toBe(memberId);

      await as('admin')
        .post('/admin/users')
        .send({ email: email('member'), name: 'Again' })
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe('EMAIL_ALREADY_REGISTERED'));
      await as('admin').post('/admin/users').send({ email: 'bad', name: 'x' }).expect(400);
    });

    it('finds accounts and shows their detail', async () => {
      const list = (await as('admin').get(`/admin/users?q=${RUN}&limit=10`).expect(200)).body.data;
      expect((list.items as { email: string }[]).map((user) => user.email)).toEqual(
        expect.arrayContaining([email('admin'), email('operator'), email('driver')]),
      );
      const operators = (await as('admin').get(`/admin/users?q=${RUN}&role=OPERATOR`).expect(200))
        .body.data;
      expect(
        (operators.items as { role: string }[]).every((user) => user.role === 'OPERATOR'),
      ).toBe(true);

      const detail = (await as('admin').get(`/admin/users/${ids.driver}`).expect(200)).body.data;
      expect(detail).toMatchObject({
        email: email('driver'),
        // Registration and sign-in each opened a session.
        counts: { activeSessions: 2, trips: 0 },
        devices: [],
        integrations: [],
      });
      await as('admin').get('/admin/users/00000000-0000-4000-8000-000000000000').expect(404);
    });

    it('lets operators pick accounts by email, without the rest of the account list', async () => {
      const found = (await as('operator').get(`/admin/accounts?q=e2e-driver-${RUN}`).expect(200))
        .body.data as { id: string; email: string }[];
      expect(found).toEqual([
        {
          id: ids.driver,
          email: email('driver'),
          name: expect.any(String),
          role: 'USER',
          active: true,
          serviceAccount: false,
        },
      ]);
      // Accounts whose email starts with the text come before those that only contain it.
      const byRun = (await as('operator').get(`/admin/accounts?q=e2e-&limit=20`).expect(200)).body
        .data as { email: string }[];
      expect(byRun.every((account) => account.email.startsWith('e2e-'))).toBe(true);
      await as('operator').get('/admin/accounts').expect(400);
      await as('operator').get('/admin/accounts?q=a&limit=21').expect(400);
      await as('driver').get(`/admin/accounts?q=${RUN}`).expect(403);
    });

    it('disables an account at once and re-enables it with new sessions only', async () => {
      const session = await login(email('member'), memberPassword);
      const member = (path: string) =>
        request(http).get(`/api/v1${path}`).set('Authorization', `Bearer ${session.accessToken}`);
      await member('/admin/overview').expect(200);

      await as('admin').patch(`/admin/users/${memberId}`).send({ active: false }).expect(200);

      await member('/admin/overview')
        .expect(401)
        .expect(({ body }) => expect(body.error.code).toBe('ACCOUNT_DISABLED'));
      await request(http)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      await signIn(email('member'), memberPassword)
        .expect(403)
        .expect(({ body }) => expect(body.error.code).toBe('ACCOUNT_DISABLED'));

      await as('admin').patch(`/admin/users/${memberId}`).send({ active: true }).expect(200);
      // The tokens issued before it was disabled stay closed.
      await member('/admin/overview')
        .expect(401)
        .expect(({ body }) => expect(body.error.code).toBe('SESSION_REVOKED'));
      await login(email('member'), memberPassword);
    });

    it('changes roles, with effect on the next request', async () => {
      const session = await login(email('member'), memberPassword);
      const member = (path: string) =>
        request(http).get(`/api/v1${path}`).set('Authorization', `Bearer ${session.accessToken}`);
      await member('/admin/trips').expect(200);

      const updated = await as('admin')
        .patch(`/admin/users/${memberId}`)
        .send({ role: 'USER', name: 'E2E member (driver)' })
        .expect(200);
      expect(updated.body.data).toMatchObject({ role: 'USER', name: 'E2E member (driver)' });
      await member('/admin/trips').expect(403);
    });

    it('resets passwords and closes sessions', async () => {
      const session = await login(email('member'), memberPassword);

      const reset = await as('admin')
        .post(`/admin/users/${memberId}/password`)
        .send({})
        .expect(200);
      expect(reset.body.data.temporaryPassword).toMatch(TEMPORARY_PASSWORD);
      await request(http)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(401)
        .expect(({ body }) => expect(body.error.code).toBe('SESSION_REVOKED'));
      await signIn(email('member'), memberPassword).expect(401);
      memberPassword = reset.body.data.temporaryPassword;

      const chosen = await as('admin')
        .post(`/admin/users/${memberId}/password`)
        .send({ password: 'Chosen-Password-2026' })
        .expect(200);
      expect(chosen.body.data).toEqual({ temporaryPassword: null });
      memberPassword = 'Chosen-Password-2026';

      const next = await login(email('member'), memberPassword);
      await as('admin').post(`/admin/users/${memberId}/sessions/revoke`).expect(200);
      await request(http)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${next.accessToken}`)
        .expect(401);
    });

    it('lets members change their own password', async () => {
      const session = await login(email('member'), memberPassword);
      const change = (body: object) =>
        request(http)
          .post('/api/v1/auth/password')
          .set('Authorization', `Bearer ${session.accessToken}`)
          .send(body);
      await change({ currentPassword: 'wrong', newPassword: 'Another-Password-2026' })
        .expect(400)
        .expect(({ body }) => expect(body.error.code).toBe('INVALID_CURRENT_PASSWORD'));
      const changed = await change({
        currentPassword: memberPassword,
        newPassword: 'Another-Password-2026',
      }).expect(200);
      memberPassword = 'Another-Password-2026';
      await request(http)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${changed.body.data.accessToken}`)
        .expect(200);
      // The session that asked for the change was replaced by the new one.
      await request(http)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(401);
    });

    it('protects the administrators from themselves and keeps one active', async () => {
      for (const body of [{ role: 'USER' }, { active: false }]) {
        await as('admin')
          .patch(`/admin/users/${ids.admin}`)
          .send(body)
          .expect(409)
          .expect(({ body: error }) => expect(error.error.code).toBe('SELF_CHANGE_NOT_ALLOWED'));
      }
      await as('admin').delete(`/admin/users/${ids.admin}`).expect(409);
      await as('admin').post(`/admin/users/${ids.admin}/password`).send({}).expect(409);

      // Two administrators demoting each other at the same time: one of them stays.
      const second = await as('admin')
        .post('/admin/users')
        .send({ email: email('second-admin'), name: 'E2E second', role: 'ADMIN' })
        .expect(201);
      const secondSession = await login(
        email('second-admin'),
        second.body.data.temporaryPassword as string,
      );
      const [first, other] = await Promise.all([
        as('admin').patch(`/admin/users/${second.body.data.user.id}`).send({ role: 'USER' }),
        request(http)
          .patch(`/api/v1/admin/users/${ids.admin}`)
          .set('Authorization', `Bearer ${secondSession.accessToken}`)
          .send({ role: 'USER' }),
      ]);
      const statuses = [first.status, other.status].sort();
      expect(statuses[0]).toBe(200);
      expect([403, 409]).toContain(statuses[1]);
      const admins = await prisma.user.count({ where: { role: 'ADMIN', active: true } });
      expect(admins).toBe(1);

      // Whoever is still administrator deletes the other account.
      const survivor = first.status === 200 ? 'admin' : 'second';
      if (survivor === 'second') {
        tokens.admin = secondSession.accessToken;
        ids.admin = second.body.data.user.id;
      }
      const removed = survivor === 'admin' ? second.body.data.user.id : ids.admin;
      await prisma.user.update({ where: { id: removed }, data: { role: 'ADMIN' } });
    });

    it('deletes accounts with their data, except those used by integrations', async () => {
      await as('admin').delete(`/admin/users/${memberId}`).expect(200);
      await as('admin').get(`/admin/users/${memberId}`).expect(404);
      const audit = (
        await as('admin').get(`/admin/audit?targetId=${memberId}&limit=50`).expect(200)
      ).body.data;
      expect((audit.items as { action: string }[]).map((entry) => entry.action)).toEqual(
        expect.arrayContaining([
          'user.create',
          'user.disable',
          'user.enable',
          'user.role',
          'user.password_reset',
          'user.sessions_revoke',
          'user.delete',
        ]),
      );
      expect(audit.items[0]).toMatchObject({
        action: 'user.delete',
        actorEmail: expect.stringMatching(/^e2e-.*@example\.com$/),
        summary: email('member'),
      });
    });
  });

  describe('operation across accounts', () => {
    let tripId: string;

    it('lists the trips of every account and shows the live ones', async () => {
      const trip = await request(http)
        .post('/api/v1/trips')
        .set('Authorization', `Bearer ${tokens.driver}`)
        .send({ name: 'Ruta norte', metadata: { vehicle: 'GYE-1234' } })
        .expect(201);
      tripId = trip.body.data.id;
      expect(trip.body.data.metadata).toEqual({ vehicle: 'GYE-1234' });
      await request(http)
        .post('/api/v1/tracking/location')
        .set('Authorization', `Bearer ${tokens.driver}`)
        .send({ tripId, ...FAR_AWAY, accuracy: 6, speed: 8, timestamp: ago(30) })
        .expect(201);

      const list = (
        await as('operator').get(`/admin/trips?userId=${ids.driver}&status=ACTIVE`).expect(200)
      ).body.data;
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).toMatchObject({
        id: tripId,
        user: { email: email('driver') },
        pointCount: 1,
      });
      const byText = (await as('operator').get(`/admin/trips?q=driver-${RUN}`).expect(200)).body
        .data;
      expect(byText.total).toBe(1);

      const live = (await as('operator').get('/admin/trips/live').expect(200)).body.data;
      expect((live as { tripId: string }[]).find((item) => item.tripId === tripId)).toMatchObject({
        userEmail: email('driver'),
        position: { latitude: FAR_AWAY.latitude, accuracy: 6 },
      });

      const detail = (await as('operator').get(`/admin/trips/${tripId}`).expect(200)).body.data;
      expect(detail).toMatchObject({ id: tripId, geofencesInside: [], route: null });
      const path = (await as('operator').get(`/admin/trips/${tripId}/path`).expect(200)).body.data;
      expect(path.totalPoints).toBe(1);
    });

    it('manages geofences and shared places for the accounts', async () => {
      const geofence = await as('operator')
        .post('/admin/geofences')
        .send({
          accountId: ids.driver,
          name: 'Bodega E2E',
          type: 'CIRCLE',
          center: DEPOT,
          radiusMeters: 150,
          metadata: { code: 'B-01' },
        })
        .expect(201);
      expect(geofence.body.data).toMatchObject({
        userId: ids.driver,
        owner: { email: email('driver') },
      });
      depotId = geofence.body.data.id;
      const own = await request(http)
        .get('/api/v1/geofences')
        .set('Authorization', `Bearer ${tokens.driver}`)
        .expect(200);
      expect((own.body.data as { id: string }[]).map((item) => item.id)).toContain(
        geofence.body.data.id,
      );
      const listed = (await as('operator').get(`/admin/geofences?userId=${ids.driver}`).expect(200))
        .body.data;
      expect(listed.items[0].geometry.type).toBe('Polygon');
      await as('operator')
        .patch(`/admin/geofences/${geofence.body.data.id}`)
        .send({ radiusMeters: 200 })
        .expect(200)
        .expect(({ body }) => expect(body.data.radiusMeters).toBe(200));
      await as('operator')
        .post('/admin/geofences')
        .send({ accountId: ids.driver, name: 'x', type: 'CIRCLE', center: DEPOT, radiusMeters: 0 })
        .expect(400);

      const place = await as('operator')
        .post('/admin/places')
        .send({ name: `Terminal ${RUN}`, category: 'transport', location: DEPOT })
        .expect(201);
      expect(place.body.data.userId).toBeNull();
      const search = await request(http)
        .get(`/api/v1/places?q=${RUN}`)
        .set('Authorization', `Bearer ${tokens.driver}`)
        .expect(200);
      expect((search.body.data as { id: string }[]).map((item) => item.id)).toContain(
        place.body.data.id,
      );
      const shared = (await as('operator').get(`/admin/places?scope=shared&q=${RUN}`).expect(200))
        .body.data;
      expect(shared.items).toEqual([
        expect.objectContaining({ id: place.body.data.id, owner: null, favorites: 0 }),
      ]);
      await as('operator')
        .patch(`/admin/places/${place.body.data.id}`)
        .send({ address: 'Av. de las Américas' })
        .expect(200);

      const privatePlace = await request(http)
        .post('/api/v1/places')
        .set('Authorization', `Bearer ${tokens.driver}`)
        .send({ name: `Casa ${RUN}`, location: FAR_AWAY })
        .expect(201);
      // Places of the accounts are listed, not edited.
      await as('operator').patch(`/admin/places/${privatePlace.body.data.id}`).send({}).expect(404);
      await as('operator').delete(`/admin/places/${privatePlace.body.data.id}`).expect(404);
      const mine = (
        await as('operator').get(`/admin/places?scope=private&userId=${ids.driver}`).expect(200)
      ).body.data;
      expect(mine.items[0]).toMatchObject({ owner: { email: email('driver') } });

      await as('operator').delete(`/admin/places/${place.body.data.id}`).expect(200);
    });

    it('finishes the trip of an account and records it', async () => {
      const finished = await as('operator').post(`/admin/trips/${tripId}/finish`).expect(200);
      expect(finished.body.data.status).toBe('COMPLETED');
      await as('operator')
        .post(`/admin/trips/${tripId}/cancel`)
        .expect(409)
        .expect(({ body }) => expect(body.error.code).toBe('TRIP_NOT_ACTIVE'));

      const audit = (await as('admin').get(`/admin/audit?targetId=${tripId}`).expect(200)).body
        .data;
      expect(audit.items[0]).toMatchObject({
        action: 'trip.finish',
        actorEmail: email('operator'),
        summary: `Ruta norte · ${email('driver')}`,
      });
      const geofenceAudit = (await as('admin').get('/admin/audit?action=geofence.').expect(200))
        .body.data;
      expect(geofenceAudit.items.length).toBeGreaterThanOrEqual(2);
    });

    it('lists devices and the operations uploaded by them', async () => {
      const installationId = `e2e-admin-device-${RUN}`;
      await request(http)
        .post('/api/v1/sync/push')
        .set('Authorization', `Bearer ${tokens.driver}`)
        .send({
          installationId,
          operations: [
            {
              id: `op-${RUN}`,
              entity: 'place',
              operation: 'CREATE',
              payload: { name: `Sync ${RUN}`, location: DEPOT },
            },
          ],
        })
        .expect(200);

      const devices = (await as('operator').get(`/admin/devices?q=${installationId}`).expect(200))
        .body.data;
      expect(devices.items).toEqual([
        expect.objectContaining({
          installationId,
          user: expect.objectContaining({ id: ids.driver }),
        }),
      ]);
      const events = (
        await as('operator').get(`/admin/sync-events?userId=${ids.driver}`).expect(200)
      ).body.data;
      expect(events.items[0]).toMatchObject({ entity: 'place', status: 'APPLIED' });
      expect(events.items[0]).not.toHaveProperty('payload');
      const detail = (
        await as('operator').get(`/admin/sync-events/${events.items[0].id}`).expect(200)
      ).body.data;
      expect(detail.payload).toMatchObject({ name: `Sync ${RUN}` });
    });
  });

  describe('integrations', () => {
    let fleet: { id: string; account: { id: string; email: string; serviceAccount: boolean } };
    let fleetKey: string;
    let fleetKeyId: string;

    it('connects an application with its own account and a key shown once', async () => {
      const created = await as('admin')
        .post('/admin/integrations')
        .send({ name: `${PREFIX} fleet ${RUN}` })
        .expect(201);
      fleet = created.body.data;
      expect(fleet.account).toMatchObject({ serviceAccount: true, active: true });
      expect(fleet.account.email).toMatch(/^svc-[0-9a-f]{12}@integrations\.invalid$/);

      const key = await as('admin')
        .post(`/admin/integrations/${fleet.id}/keys`)
        .send({ name: 'Servidor', scopes: ['trips:read', 'trips:write', 'events:read'] })
        .expect(201);
      fleetKey = key.body.data.key;
      fleetKeyId = key.body.data.apiKey.id;
      expect(fleetKey).toMatch(/^rmk_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
      expect(key.body.data.apiKey).toMatchObject({
        status: 'ACTIVE',
        lastFour: fleetKey.slice(-4),
      });
      await as('admin')
        .post(`/admin/integrations/${fleet.id}/keys`)
        .send({ name: 'x', scopes: ['admin:everything'] })
        .expect(400);
      await as('admin')
        .post(`/admin/integrations/${fleet.id}/keys`)
        .send({ name: 'x', scopes: ['trips:read'], expiresAt: '2001-01-01T00:00:00Z' })
        .expect(400);

      const detail = (await as('admin').get(`/admin/integrations/${fleet.id}`).expect(200)).body
        .data;
      expect(JSON.stringify(detail)).not.toContain(fleetKey);
      expect(detail.keys).toHaveLength(1);
      expect(detail.rateLimitPerMinute).toBe(600);

      // The account of an integration never signs in with a password.
      await signIn(fleet.account.email, 'anything-at-all').expect(401);
    });

    it('lets the key act as its account within its scopes', async () => {
      const me = await withKey(fleetKey).get('/integrations/me').expect(200);
      expect(me.body.data).toMatchObject({
        integration: { id: fleet.id, eventScope: 'ACCOUNT' },
        account: { id: fleet.account.id },
        key: { scopes: ['trips:read', 'trips:write', 'events:read'] },
        rateLimitPerMinute: 600,
      });
      await as('admin')
        .get('/integrations/me')
        .expect(403)
        .expect(({ body }) => expect(body.error.code).toBe('API_KEY_REQUIRED'));

      const trip = await withKey(fleetKey)
        .post('/trips')
        .send({ name: 'Entrega 1', metadata: { order: 'PED-1' } })
        .expect(201);
      expect(trip.body.data.userId).toBe(fleet.account.id);
      const trips = await withKey(fleetKey).get('/trips').expect(200);
      expect((trips.body.data.items as { id: string }[]).map((item) => item.id)).toEqual([
        trip.body.data.id,
      ]);

      await withKey(fleetKey)
        .get('/geofences')
        .expect(403)
        .expect(({ body }) => {
          expect(body.error.code).toBe('API_KEY_SCOPE_MISSING');
          expect(body.error.details).toEqual({
            required: ['geofences:read'],
            missing: ['geofences:read'],
          });
        });
      for (const path of ['/admin/overview', '/auth/me', '/sync/pull']) {
        await withKey(fleetKey)
          .get(path)
          .expect(403)
          .expect(({ body }) => expect(body.error.code).toBe('API_KEY_NOT_ALLOWED'));
      }
      await withKey('rmk_000000000000_' + 'x'.repeat(43))
        .get('/trips')
        .expect(401)
        .expect(({ body }) => expect(body.error.code).toBe('INVALID_API_KEY'));
    });

    it('applies the quota of each integration and counts its requests', async () => {
      const limitedIntegration = (
        await as('admin')
          .post('/admin/integrations')
          .send({ name: `${PREFIX} quota ${RUN}`, rateLimitPerMinute: 3 })
          .expect(201)
      ).body.data;
      const limitedKey = (
        await as('admin')
          .post(`/admin/integrations/${limitedIntegration.id}/keys`)
          .send({ name: 'Pruebas', scopes: ['trips:read'] })
          .expect(201)
      ).body.data.key as string;

      const statuses: number[] = [];
      for (let attempt = 0; attempt < 5; attempt++) {
        statuses.push((await withKey(limitedKey).get('/trips')).status);
      }
      expect(statuses).toEqual([200, 200, 200, 429, 429]);
      await withKey(limitedKey)
        .get('/trips')
        .expect(429)
        .expect(({ body }) => expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED'));
      // Other integrations and the people using the apps keep their own limits.
      await withKey(fleetKey).get('/trips').expect(200);
      await as('driver').get('/trips').expect(200);

      await app.get(ApiKeyAuthenticatorService).flush();
      const usage = (
        await as('admin')
          .get(`/admin/integrations/${limitedIntegration.id}/usage?days=7`)
          .expect(200)
      ).body.data;
      expect(usage.days).toHaveLength(7);
      expect(usage.days[6]).toMatchObject({ requests: 6, errors: 3 });
      const key = (
        await as('admin').get(`/admin/integrations/${limitedIntegration.id}`).expect(200)
      ).body.data.keys[0];
      expect(key.lastUsedAt).not.toBeNull();
      const list = (await as('admin').get(`/admin/integrations?q=${RUN}`).expect(200)).body.data;
      expect(
        (list.items as { id: string }[]).find((item) => item.id === limitedIntegration.id),
      ).toMatchObject({ requestsToday: 6, activeKeys: 1 });
    });

    it('stops a revoked key and a disabled integration at once', async () => {
      const second = await as('admin')
        .post(`/admin/integrations/${fleet.id}/keys`)
        .send({ name: 'Respaldo', scopes: ['trips:read'] })
        .expect(201);
      const backupKey = second.body.data.key as string;
      await withKey(backupKey).get('/trips').expect(200);

      await as('admin')
        .patch(`/admin/integrations/${fleet.id}`)
        .send({ active: false })
        .expect(200);
      await withKey(backupKey)
        .get('/trips')
        .expect(401)
        .expect(({ body }) =>
          expect(body.error.message).toBe('The integration of this API key is disabled'),
        );
      await as('admin').patch(`/admin/integrations/${fleet.id}`).send({ active: true }).expect(200);
      await withKey(backupKey).get('/trips').expect(200);

      await as('admin').delete(`/admin/integrations/${fleet.id}/keys/${fleetKeyId}`).expect(200);
      await withKey(fleetKey)
        .get('/trips')
        .expect(401)
        .expect(({ body }) => expect(body.error.message).toBe('This API key was revoked'));
      await withKey(backupKey).get('/trips').expect(200);

      // Disabling the account of the integration stops its keys too.
      await as('admin')
        .patch(`/admin/users/${fleet.account.id}`)
        .send({ active: false })
        .expect(200);
      await withKey(backupKey).get('/trips').expect(401);
      await as('admin')
        .patch(`/admin/users/${fleet.account.id}`)
        .send({ active: true })
        .expect(200);
      await withKey(backupKey).get('/trips').expect(200);
      await as('admin')
        .patch(`/admin/users/${fleet.account.id}`)
        .send({ role: 'ADMIN' })
        .expect(400);
    });
  });

  describe('events and webhooks', () => {
    let integration: { id: string };
    let webhook: { id: string };
    let secret: string;
    let key: string;
    let geofenceId: string;
    let tripId: string;

    it('subscribes an endpoint of an integration acting as an existing account', async () => {
      integration = (
        await as('admin')
          .post('/admin/integrations')
          .send({
            name: `${PREFIX} erp ${RUN}`,
            accountId: ids.driver,
            contactEmail: 'ti@example.com',
          })
          .expect(201)
      ).body.data;

      await as('admin')
        .post(`/admin/integrations/${integration.id}/webhooks`)
        .send({ url: 'ftp://example.com/hook', events: ['*'] })
        .expect(400)
        .expect(({ body }) => expect(body.error.code).toBe('INVALID_WEBHOOK_URL'));
      await as('admin')
        .post(`/admin/integrations/${integration.id}/webhooks`)
        .send({ url: receiverUrl, events: ['trip.exploded'] })
        .expect(400);

      const created = await as('admin')
        .post(`/admin/integrations/${integration.id}/webhooks`)
        .send({ url: receiverUrl, events: ['*'], description: 'ERP' })
        .expect(201);
      webhook = created.body.data.webhook;
      secret = created.body.data.secret;
      expect(secret).toMatch(/^whsec_/);
      const stored = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: webhook.id } });
      expect(stored.secret).not.toContain(secret);

      key = (
        await as('admin')
          .post(`/admin/integrations/${integration.id}/keys`)
          .send({ name: 'ERP', scopes: ['events:read', 'geofences:read'] })
          .expect(201)
      ).body.data.key;
    });

    it('sends signed trip and geofence events of the account', async () => {
      const driver = (method: 'get' | 'post', path: string) =>
        request(http)[method](`/api/v1${path}`).set('Authorization', `Bearer ${tokens.driver}`);
      geofenceId = (
        await driver('post', '/geofences')
          .send({ name: 'Cliente E2E', type: 'CIRCLE', center: DEPOT, radiusMeters: 120 })
          .expect(201)
      ).body.data.id;
      tripId = (
        await driver('post', '/trips')
          .send({ name: 'Visita', metadata: { order: 'PED-2041' } })
          .expect(201)
      ).body.data.id;
      const fix = (position: typeof DEPOT, secondsAgo: number) => ({
        tripId,
        ...position,
        accuracy: 5,
        timestamp: ago(secondsAgo),
      });
      // Outside, inside for two fixes, then far away again (uploaded as one batch).
      await driver('post', '/tracking/locations/batch')
        .send({
          locations: [fix(FAR_AWAY, 300), fix(DEPOT, 240), fix(DEPOT, 180), fix(FAR_AWAY, 60)],
        })
        .expect(201);
      // Uploading the same batch again changes nothing.
      await driver('post', '/tracking/locations/batch')
        .send({ locations: [fix(DEPOT, 240), fix(FAR_AWAY, 60)] })
        .expect(201);
      await driver('post', `/trips/${tripId}/finish`).send({}).expect(200);

      await deliver();

      const mine = received.filter((item) => item.event.accountId === ids.driver);
      const types = mine.map((item) => item.event.type);
      // The depot geofence the operator created for the account is crossed as well.
      const crossings = (id: string) =>
        mine
          .filter((item) => item.event.data?.geofence?.id === id)
          .sort((a, b) => Number(BigInt(a.event.seq) - BigInt(b.event.seq)))
          .map((item) => item.event.type);
      expect(crossings(geofenceId)).toEqual(['geofence.entered', 'geofence.exited']);
      expect(crossings(depotId)).toEqual(['geofence.entered', 'geofence.exited']);
      expect(types).toEqual(expect.arrayContaining(['trip.started', 'trip.finished']));
      for (const item of mine) {
        expect(item.headers['content-type']).toBe('application/json');
        expect(item.headers['x-routemaps-event']).toBe(item.event.type);
        expect(item.headers['x-routemaps-event-id']).toBe(item.event.id);
        expect(
          verifySignature(secret, String(item.headers['x-routemaps-signature']), item.body),
        ).toBe(true);
      }

      const ofGeofence = (type: string) =>
        mine.find(
          (item) => item.event.type === type && item.event.data.geofence?.id === geofenceId,
        )!.event;
      const entered = ofGeofence('geofence.entered');
      const exited = ofGeofence('geofence.exited');
      expect(entered.data).toMatchObject({
        trip: { id: tripId, metadata: { order: 'PED-2041' } },
        geofence: { id: geofenceId, name: 'Cliente E2E', type: 'CIRCLE' },
        position: { latitude: DEPOT.latitude, longitude: DEPOT.longitude, accuracy: 5 },
      });
      expect(exited.data.dwellSeconds).toBe(180);
      expect(BigInt(exited.seq)).toBeGreaterThan(BigInt(entered.seq));
      const finished = mine.find((item) => item.event.type === 'trip.finished')!.event;
      expect(finished.data.trip).toMatchObject({ id: tripId, status: 'COMPLETED' });
    });

    it('serves the same events to the key through the feed, with a cursor', async () => {
      const first = await withKey(key).get(
        '/events?after=0&types=geofence.entered,geofence.exited',
      );
      expect(first.status).toBe(200);
      const items = first.body.data.items as {
        id: string;
        type: string;
        accountId: string;
        data: { geofence: { id: string } };
      }[];
      const ofThisGeofence = items.filter((item) => item.data.geofence.id === geofenceId);
      expect(ofThisGeofence.map((item) => item.type)).toEqual([
        'geofence.entered',
        'geofence.exited',
      ]);
      expect(items.every((item) => item.accountId === ids.driver)).toBe(true);

      const cursor = first.body.data.next as string;
      const next = await withKey(key)
        .get(`/events?after=${cursor}&types=geofence.entered,geofence.exited`)
        .expect(200);
      expect(next.body.data).toEqual({ items: [], next: cursor, hasMore: false });
      const rest = await withKey(key).get(`/events?after=${cursor}`).expect(200);
      expect((rest.body.data.items as { type: string }[]).map((item) => item.type)).toContain(
        'trip.finished',
      );
      await withKey(key).get('/events?after=-1').expect(400);
    });

    it('retries failed deliveries and lets the panel send them again', async () => {
      receiverStatus = 500;
      const test = await as('admin')
        .post(`/admin/integrations/${integration.id}/webhooks/${webhook.id}/test`)
        .expect(202);
      await deliver();
      const failed = (
        await as('admin')
          .get(`/admin/integrations/${integration.id}/deliveries/${test.body.data.deliveryId}`)
          .expect(200)
      ).body.data;
      // Test events are tried once.
      expect(failed).toMatchObject({
        status: 'FAILED',
        attempts: 1,
        responseStatus: 500,
        responseBody: 'status 500',
        eventType: 'webhook.test',
      });

      // A real event that fails waits for its next attempt.
      const trip = await request(http)
        .post('/api/v1/trips')
        .set('Authorization', `Bearer ${tokens.driver}`)
        .send({ name: 'Reintento' })
        .expect(201);
      await deliver();
      const pendingItems = (
        await as('admin')
          .get(`/admin/integrations/${integration.id}/deliveries?status=PENDING`)
          .expect(200)
      ).body.data.items as Delivery[];
      const pending = pendingItems.find(
        (item) => item.eventType === 'trip.started' && item.attempts === 1,
      )!;
      expect(pending).toBeDefined();
      expect(new Date(pending.nextAttemptAt!).getTime()).toBeGreaterThan(Date.now() + 50_000);
      const detail = (await as('admin').get(`/admin/integrations/${integration.id}`).expect(200))
        .body.data;
      expect(detail.webhooks[0].consecutiveFailures).toBeGreaterThanOrEqual(1);

      receiverStatus = 200;
      await as('admin')
        .post(`/admin/integrations/${integration.id}/deliveries/${pending.id}/retry`)
        .expect(200);
      await as('admin')
        .post(`/admin/integrations/${integration.id}/deliveries/${test.body.data.deliveryId}/retry`)
        .expect(200);
      await deliver();
      const after = (
        await as('admin')
          .get(`/admin/integrations/${integration.id}/deliveries?limit=50`)
          .expect(200)
      ).body.data.items as Delivery[];
      expect(after.find((item) => item.id === pending.id)?.status).toBe('SUCCEEDED');
      expect(after.find((item) => item.id === test.body.data.deliveryId)?.status).toBe('SUCCEEDED');
      expect(received.some((item) => item.event.data?.trip?.id === trip.body.data.id)).toBe(true);
      const healed = (await as('admin').get(`/admin/integrations/${integration.id}`).expect(200))
        .body.data;
      expect(healed.webhooks[0].consecutiveFailures).toBe(0);
    });

    it('signs with the new secret after a rotation and pauses disabled endpoints', async () => {
      const rotated = await as('admin')
        .post(`/admin/integrations/${integration.id}/webhooks/${webhook.id}/rotate-secret`)
        .expect(200);
      const newSecret = rotated.body.data.secret as string;
      expect(newSecret).not.toBe(secret);

      await as('admin')
        .patch(`/admin/integrations/${integration.id}/webhooks/${webhook.id}`)
        .send({ active: false })
        .expect(200);
      const count = received.length;
      const paused = (
        await request(http)
          .post('/api/v1/trips')
          .set('Authorization', `Bearer ${tokens.driver}`)
          .send({ name: 'Pausa' })
          .expect(201)
      ).body.data;
      await deliver();
      expect(received).toHaveLength(count);

      // A delivery queued before the pause waits for it to end: the summary does not report it
      // as late (that warning means the worker stopped).
      const event = await prisma.platformEvent.findFirstOrThrow({
        where: { type: 'trip.started', data: { path: ['trip', 'id'], equals: paused.id } },
      });
      const waiting = await prisma.webhookDelivery.create({
        data: {
          eventId: event.id,
          endpointId: webhook.id,
          nextAttemptAt: new Date(Date.now() - 60 * 60_000),
        },
      });
      const late = (await as('admin').get('/admin/overview').expect(200)).body.data.webhooks
        .oldestPendingAt as string | null;
      expect(late === null || new Date(late) > waiting.nextAttemptAt).toBe(true);

      await as('admin')
        .patch(`/admin/integrations/${integration.id}/webhooks/${webhook.id}`)
        .send({ active: true })
        .expect(200);
      const test = await as('admin')
        .post(`/admin/integrations/${integration.id}/webhooks/${webhook.id}/test`)
        .expect(202);
      await deliver();
      const delivered = received.find(
        (item) => item.headers['x-routemaps-delivery'] === test.body.data.deliveryId,
      )!;
      expect(
        verifySignature(
          newSecret,
          String(delivered.headers['x-routemaps-signature']),
          delivered.body,
        ),
      ).toBe(true);
      expect(
        verifySignature(secret, String(delivered.headers['x-routemaps-signature']), delivered.body),
      ).toBe(false);
    });

    it('announces regions to every integration and records who published them', async () => {
      const storage = process.env.E2E_STORAGE_PATH!;
      const put = async (path: string, data: Buffer | string) => {
        await mkdir(dirname(join(storage, path)), { recursive: true });
        await writeFile(join(storage, path), data);
      };
      await put(`maps/ecuador/${REGION}.pmtiles`, Buffer.alloc(4096, `${RUN}`));
      await put(
        `maps/ecuador/${REGION}.region.json`,
        JSON.stringify({
          code: REGION,
          name: 'Salinas (e2e)',
          country: 'EC',
          version: `2026.10.${RUN.slice(-6)}`,
          bbox: [-81.02, -2.24, -80.9, -2.18],
          minZoom: 0,
          maxZoom: 14,
          mapFile: `ecuador/${REGION}.pmtiles`,
        }),
      );
      await as('admin').post('/maps/regions/sync').send({}).expect(200);
      await deliver();
      const published = received.find(
        (item) => item.event.type === 'region.published' && item.event.data.region?.code === REGION,
      );
      expect(published?.event.accountId).toBeNull();

      await as('admin').patch(`/maps/regions/${REGION}`).send({ enabled: false }).expect(200);
      await deliver();
      expect(
        received.some(
          (item) =>
            item.event.type === 'region.disabled' && item.event.data.region?.code === REGION,
        ),
      ).toBe(true);

      const regions = (await as('operator').get('/admin/regions').expect(200)).body.data;
      expect((regions as { id: string }[]).find((region) => region.id === REGION)).toMatchObject({
        enabled: false,
        downloads: { devices: 0, upToDate: 0 },
      });
      const audit = (await as('admin').get('/admin/audit?targetType=region').expect(200)).body.data;
      expect((audit.items as { action: string }[]).map((entry) => entry.action)).toEqual(
        expect.arrayContaining(['region.sync', 'region.disable']),
      );
      await app.get(MapRegionService).setEnabled(REGION, true);
    });

    it('lists the events with how their deliveries went', async () => {
      const list = (
        await as('operator')
          .get(`/admin/events?accountId=${ids.driver}&type=geofence.exited`)
          .expect(200)
      ).body.data;
      expect(list.items[0]).toMatchObject({
        type: 'geofence.exited',
        account: { id: ids.driver, email: email('driver'), name: 'E2E driver' },
        deliveries: { SUCCEEDED: 1, FAILED: 0 },
      });
      const detail = (await as('operator').get(`/admin/events/${list.items[0].id}`).expect(200))
        .body.data;
      expect(detail.deliveries).toEqual([
        expect.objectContaining({
          status: 'SUCCEEDED',
          webhook: { id: webhook.id, url: receiverUrl },
          integration: { id: integration.id, name: `${PREFIX} erp ${RUN}` },
        }),
      ]);
    });

    it('gives the events of every account to an integration that asks for them', async () => {
      const fleetWide = (
        await as('admin')
          .post('/admin/integrations')
          .send({ name: `${PREFIX} reports ${RUN}`, eventScope: 'ALL_ACCOUNTS' })
          .expect(201)
      ).body.data;
      expect(fleetWide.eventScope).toBe('ALL_ACCOUNTS');
      await as('admin')
        .post(`/admin/integrations/${fleetWide.id}/webhooks`)
        .send({ url: `${receiverUrl}/reports`, events: ['trip.started', 'trip.cancelled'] })
        .expect(201);
      const reportsKey = (
        await as('admin')
          .post(`/admin/integrations/${fleetWide.id}/keys`)
          .send({ name: 'Reportes', scopes: ['events:read', 'trips:read'] })
          .expect(201)
      ).body.data.key as string;
      const own = (
        await as('admin')
          .post('/admin/integrations')
          .send({ name: `${PREFIX} own ${RUN}` })
          .expect(201)
      ).body.data;
      expect(own.eventScope).toBe('ACCOUNT');
      const ownKey = (
        await as('admin')
          .post(`/admin/integrations/${own.id}/keys`)
          .send({ name: 'Propia', scopes: ['events:read'] })
          .expect(201)
      ).body.data.key as string;
      const me = (await withKey(reportsKey).get('/integrations/me').expect(200)).body.data;
      expect(me.integration).toEqual({
        id: fleetWide.id,
        name: `${PREFIX} reports ${RUN}`,
        eventScope: 'ALL_ACCOUNTS',
      });

      const trip = (await as('driver').post('/trips').send({ name: 'Toda la flota' }).expect(201))
        .body.data;
      await as('driver').post(`/trips/${trip.id}/cancel`).send({}).expect(200);
      await deliver();

      const ofTrip = (item: { data: EventData }) => item.data?.trip?.id === trip.id;
      const reported = received
        .filter((item) => item.url === '/route-maps/reports' && ofTrip(item.event))
        .map((item) => item.event)
        .sort((a, b) => Number(BigInt(a.seq) - BigInt(b.seq)));
      expect(reported.map((event) => event.type)).toEqual(['trip.started', 'trip.cancelled']);
      expect(reported[0].account).toEqual({
        id: ids.driver,
        email: email('driver'),
        name: 'E2E driver',
      });

      const after = (BigInt(reported[0].seq) - 1n).toString();
      const feed = (await withKey(reportsKey).get(`/events?after=${after}`).expect(200)).body.data
        .items as { type: string; account: { id: string } | null; data: EventData }[];
      expect(feed.filter(ofTrip).map((event) => event.type)).toEqual([
        'trip.started',
        'trip.cancelled',
      ]);
      expect(feed.find(ofTrip)?.account).toMatchObject({ id: ids.driver });
      // An integration limited to its account does not see them.
      const ownFeed = (await withKey(ownKey).get(`/events?after=${after}`).expect(200)).body.data
        .items as { data: EventData }[];
      expect(ownFeed.some(ofTrip)).toBe(false);
      // Its key still acts only as its own account.
      const trips = (await withKey(reportsKey).get('/trips').expect(200)).body.data.items as {
        id: string;
      }[];
      expect(trips.map((item) => item.id)).not.toContain(trip.id);

      // Back to its own account: the next trips of the driver are not sent to it.
      await as('admin')
        .patch(`/admin/integrations/${fleetWide.id}`)
        .send({ eventScope: 'ACCOUNT' })
        .expect(200);
      const meNow = (await withKey(reportsKey).get('/integrations/me').expect(200)).body.data;
      expect(meNow.integration.eventScope).toBe('ACCOUNT');
      const later = (await as('driver').post('/trips').send({ name: 'Solo la cuenta' }).expect(201))
        .body.data;
      await deliver();
      expect(
        received.some(
          (item) => item.url === '/route-maps/reports' && item.event.data?.trip?.id === later.id,
        ),
      ).toBe(false);
      const laterFeed = (
        await withKey(reportsKey).get(`/events?after=${after}&types=trip.started`).expect(200)
      ).body.data.items as { data: EventData }[];
      expect(laterFeed.some((event) => event.data?.trip?.id === later.id)).toBe(false);
    });

    it('keeps the data of an account when its integration is deleted', async () => {
      await as('admin')
        .delete(`/admin/users/${ids.driver}`)
        .expect(409)
        .expect(({ body }) => expect(body.error.message).toMatch(/integration/));
      await as('admin').delete(`/admin/integrations/${integration.id}`).expect(200);
      await withKey(key).get('/events').expect(401);
      await request(http)
        .get(`/api/v1/trips/${tripId}`)
        .set('Authorization', `Bearer ${tokens.driver}`)
        .expect(200);
    });
  });

  it('documents API keys and the administration in OpenAPI', async () => {
    const res = await request(http).get('/api/docs-json').expect(200);
    expect(res.body.components.securitySchemes['api-key']).toEqual({
      type: 'apiKey',
      in: 'header',
      name: 'X-API-Key',
    });
    expect(Object.keys(res.body.paths as object)).toEqual(
      expect.arrayContaining([
        '/api/v1/admin/overview',
        '/api/v1/admin/users',
        '/api/v1/admin/integrations/{id}/webhooks',
        '/api/v1/events',
        '/api/v1/integrations/me',
      ]),
    );
    expect(res.body.paths['/api/v1/trips'].get.security).toEqual(
      expect.arrayContaining([{ 'api-key': [] }]),
    );
  });
});
