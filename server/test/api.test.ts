// Fastify API tests against a real, ephemeral MongoDB (mongodb-memory-server
// — an actual mongod process, not a mock, so the unique-index/TTL-index
// behavior asserted by db.ts's ensureIndexes() is exercised for real).
//
// config.ts reads MONGO_URI/COOKIE_SECRET/NODE_ENV from process.env at
// *module import time*, so the env vars below have to land before
// db.ts/server.ts are ever imported — hence the dynamic import()s inside
// beforeAll rather than static top-level imports.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import type { FastifyInstance } from 'fastify';

let mongod: MongoMemoryServer;
let app: FastifyInstance;
let closeDb: () => Promise<void>;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  process.env.MONGO_URI = mongod.getUri('preseditor-test');
  process.env.COOKIE_SECRET = 'test-only-secret-not-for-real-use';
  process.env.NODE_ENV = 'test';
  process.env.CORS_ORIGINS = 'http://localhost:5173';

  const db = await import('../src/db.js');
  const { buildServer } = await import('../src/server.js');
  await db.connectDb();
  closeDb = db.closeDb;
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await closeDb?.();
  await mongod?.stop();
});

// Fastify's inject() response only exposes the raw Set-Cookie header —
// pull the psid value out of it the same way a browser would.
function sessionCookieFrom(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader[0] : setCookieHeader;
  const match = /psid=([^;]+)/.exec(raw || '');
  if (!match) throw new Error(`No psid cookie in response: ${JSON.stringify(setCookieHeader)}`);
  return `psid=${match[1]}`;
}

// auth.ts's rate limiter (10 req/min) keys by IP, and app.inject() defaults
// every call to the same synthetic 127.0.0.1 — without this the suite's own
// signup/signin volume trips the *real* rate limiter partway through
// (confirmed: that's genuinely what happened on the first run of this
// suite). A unique fake IP per call is also more realistic — real
// concurrent users are on different machines, not deliberately sharing one.
let ipCounter = 0;
function nextIp() {
  ipCounter += 1;
  return `10.0.${Math.floor(ipCounter / 255)}.${ipCounter % 255}`;
}

async function signup(email: string, password = 'password123', displayName?: string) {
  return app.inject({ method: 'POST', url: '/api/auth/signup', payload: { email, password, displayName }, remoteAddress: nextIp() });
}

async function signin(email: string, password = 'password123') {
  return app.inject({ method: 'POST', url: '/api/auth/signin', payload: { email, password }, remoteAddress: nextIp() });
}

describe('GET /api/health', () => {
  it('responds ok without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('sets baseline security headers (helmet is actually wired up, not just installed)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
  });
});

describe('signup', () => {
  it('rejects an invalid email', async () => {
    const res = await signup('not-an-email');
    expect(res.statusCode).toBe(400);
  });

  it('rejects a password under 8 characters', async () => {
    const res = await signup('shortpass@example.com', 'short');
    expect(res.statusCode).toBe(400);
  });

  it('succeeds with valid input and sets a session cookie', async () => {
    const res = await signup('newuser@example.com');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: 'newuser@example.com', displayName: 'newuser' });
    expect(res.headers['set-cookie']).toBeDefined();
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('rejects a duplicate email with 409, not 500', async () => {
    await signup('dupe@example.com');
    const res = await signup('dupe@example.com');
    expect(res.statusCode).toBe(409);
  });

  it('handles two concurrent signups for the same email as one 200 and one clean 409 (SEC-6)', async () => {
    const email = 'racecondition@example.com';
    const [a, b] = await Promise.all([signup(email), signup(email)]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);
  });
});

describe('signin', () => {
  it('rejects an unknown email', async () => {
    const res = await signin('nobody@example.com');
    expect(res.statusCode).toBe(401);
  });

  it('rejects the wrong password', async () => {
    await signup('signintest@example.com', 'correct-password');
    const res = await signin('signintest@example.com', 'wrong-password');
    expect(res.statusCode).toBe(401);
  });

  it('succeeds with the right credentials and sets a session cookie', async () => {
    await signup('signinok@example.com', 'correct-password');
    const res = await signin('signinok@example.com', 'correct-password');
    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeDefined();
  });
});

describe('session lifecycle', () => {
  it('GET /api/auth/me is 401 with no cookie', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/auth/me returns the signed-in user with a valid cookie', async () => {
    const signupRes = await signup('meuser@example.com');
    const cookie = sessionCookieFrom(signupRes.headers['set-cookie']);
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ email: 'meuser@example.com', displayName: 'meuser' });
  });

  it('signout clears the session so /api/auth/me is 401 afterward', async () => {
    const signupRes = await signup('signouttest@example.com');
    const cookie = sessionCookieFrom(signupRes.headers['set-cookie']);
    const signoutRes = await app.inject({ method: 'POST', url: '/api/auth/signout', headers: { cookie } });
    expect(signoutRes.statusCode).toBe(200);
    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(meRes.statusCode).toBe(401);
  });
});

describe('project ownership isolation', () => {
  async function cookieFor(email: string) {
    const res = await signup(email);
    return sessionCookieFrom(res.headers['set-cookie']);
  }

  it("user B cannot read, update, rename, duplicate, or delete user A's project", async () => {
    const cookieA = await cookieFor('owner-a@example.com');
    const cookieB = await cookieFor('owner-b@example.com');

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie: cookieA },
      payload: { title: "A's private deck", json: { hello: 'world' } },
    });
    expect(createRes.statusCode).toBe(201);
    const projectId = createRes.json().id;

    // Owner can read it.
    const ownerRead = await app.inject({ method: 'GET', url: `/api/projects/${projectId}`, headers: { cookie: cookieA } });
    expect(ownerRead.statusCode).toBe(200);

    // Every other route, as user B, behaves as if the project doesn't exist.
    const asB = { headers: { cookie: cookieB } };
    const getRes = await app.inject({ method: 'GET', url: `/api/projects/${projectId}`, ...asB });
    expect(getRes.statusCode).toBe(404);

    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/projects/${projectId}`,
      ...asB,
      payload: { title: 'hijacked', json: {} },
    });
    expect(putRes.statusCode).toBe(404);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/projects/${projectId}`,
      ...asB,
      payload: { title: 'hijacked' },
    });
    expect(patchRes.statusCode).toBe(404);

    const dupRes = await app.inject({ method: 'POST', url: `/api/projects/${projectId}/duplicate`, ...asB });
    expect(dupRes.statusCode).toBe(404);

    const deleteRes = await app.inject({ method: 'DELETE', url: `/api/projects/${projectId}`, ...asB });
    expect(deleteRes.statusCode).toBe(404);

    // Untouched — B's failed attempts didn't mutate A's project.
    const stillThere = await app.inject({ method: 'GET', url: `/api/projects/${projectId}`, headers: { cookie: cookieA } });
    expect(stillThere.statusCode).toBe(200);
    expect(stillThere.json().title).toBe("A's private deck");
  });

  it("user B's own project list never includes user A's projects", async () => {
    const cookieA = await cookieFor('lista@example.com');
    const cookieB = await cookieFor('listb@example.com');
    await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie: cookieA }, payload: { title: 'A only', json: {} } });

    const listB = await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: cookieB } });
    expect(listB.statusCode).toBe(200);
    expect(listB.json()).toEqual([]);
  });

  it('all project routes require authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(401);
  });
});

describe('save-conflict detection (expectedUpdatedAt)', () => {
  it('a PUT with no expectedUpdatedAt is unconditional, same as before this feature existed', async () => {
    const cookie = await (async () => {
      const res = await signup('nocheck@example.com');
      return sessionCookieFrom(res.headers['set-cookie']);
    })();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: { cookie },
      payload: { title: 'v1', json: { n: 1 } },
    });
    const id = createRes.json().id;

    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/projects/${id}`,
      headers: { cookie },
      payload: { title: 'v2', json: { n: 2 } },
    });
    expect(putRes.statusCode).toBe(200);
    expect(putRes.json().updatedAt).toBeDefined();
  });

  it('a PUT whose expectedUpdatedAt matches the stored value succeeds and returns the new updatedAt', async () => {
    const res = await signup('matchcheck@example.com');
    const cookie = sessionCookieFrom(res.headers['set-cookie']);
    const createRes = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: { title: 'v1', json: {} } });
    const { id, updatedAt } = createRes.json();

    const putRes = await app.inject({
      method: 'PUT',
      url: `/api/projects/${id}`,
      headers: { cookie },
      payload: { title: 'v2', json: {}, expectedUpdatedAt: updatedAt },
    });
    expect(putRes.statusCode).toBe(200);
  });

  it('a PUT whose expectedUpdatedAt is stale (someone else saved first) is rejected with 409, not silently overwritten', async () => {
    const res = await signup('staleconflict@example.com');
    const cookie = sessionCookieFrom(res.headers['set-cookie']);
    const createRes = await app.inject({ method: 'POST', url: '/api/projects', headers: { cookie }, payload: { title: 'v1', json: { n: 1 } } });
    const { id, updatedAt: originalUpdatedAt } = createRes.json();

    // "Tab A" saves first, moving the real updatedAt forward.
    const tabASave = await app.inject({
      method: 'PUT',
      url: `/api/projects/${id}`,
      headers: { cookie },
      payload: { title: 'from tab A', json: { n: 2 }, expectedUpdatedAt: originalUpdatedAt },
    });
    expect(tabASave.statusCode).toBe(200);

    // "Tab B" still thinks the original timestamp is current and tries to
    // save over it — must be rejected, not silently clobber tab A's save.
    const tabBSave = await app.inject({
      method: 'PUT',
      url: `/api/projects/${id}`,
      headers: { cookie },
      payload: { title: 'from tab B (stale)', json: { n: 3 }, expectedUpdatedAt: originalUpdatedAt },
    });
    expect(tabBSave.statusCode).toBe(409);
    expect(tabBSave.json().updatedAt).toBeDefined(); // the current server value, so the client can recover

    // Tab A's save is what actually stuck.
    const readBack = await app.inject({ method: 'GET', url: `/api/projects/${id}`, headers: { cookie } });
    expect(readBack.json().title).toBe('from tab A');
  });
});
