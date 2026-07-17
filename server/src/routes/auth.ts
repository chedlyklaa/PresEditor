import type { FastifyInstance } from 'fastify';
import { ObjectId, MongoServerError } from 'mongodb';
import { users } from '../db.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { createSession, destroySession, SESSION_COOKIE } from '../auth/session.js';
import { requireAuth } from '../auth/requireAuth.js';
import { config } from '../config.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Auth routes are rate-limited separately from the rest of the API (see
// server.ts) — brute-force/credential-stuffing protection on exactly the
// endpoints that take a password, not on read-only project routes.
const AUTH_RATE_LIMIT = { max: 10, timeWindow: '1 minute' };

function cookieOpts(expiresAt: Date) {
  return {
    httpOnly: true,
    path: '/',
    sameSite: 'lax' as const,
    secure: config.isProd,
    expires: expiresAt,
  };
}

export default async function authRoutes(app: FastifyInstance) {
  app.post<{ Body: { email?: string; password?: string; displayName?: string } }>(
    '/api/auth/signup',
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (req, reply) => {
      const email = (req.body?.email || '').trim().toLowerCase();
      const password = req.body?.password || '';
      const displayName = (req.body?.displayName || '').trim().slice(0, 80) || email.split('@')[0];
      if (!EMAIL_RE.test(email)) return reply.code(400).send({ error: 'Adresse e-mail invalide.' });
      if (password.length < 8) return reply.code(400).send({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });

      const existing = await users().findOne({ email });
      if (existing) return reply.code(409).send({ error: 'Un compte existe déjà avec cette adresse.' });

      const passwordHash = await hashPassword(password);
      const _id = new ObjectId();
      try {
        await users().insertOne({ _id, email, passwordHash, displayName, createdAt: new Date() });
      } catch (err) {
        // Two concurrent signups for the same email can both pass the
        // findOne check above and race to insertOne — the unique index on
        // `email` (db.ts) still catches it, but as an uncaught duplicate-key
        // error otherwise surfaced to the client as a raw 500. Give the
        // second one the same 409 the check above would have given it.
        if (err instanceof MongoServerError && err.code === 11000) {
          return reply.code(409).send({ error: 'Un compte existe déjà avec cette adresse.' });
        }
        throw err;
      }
      const session = await createSession(_id);
      reply.setCookie(SESSION_COOKIE, session.id, cookieOpts(session.expiresAt));
      return { email, displayName };
    }
  );

  app.post<{ Body: { email?: string; password?: string } }>(
    '/api/auth/signin',
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (req, reply) => {
      const email = (req.body?.email || '').trim().toLowerCase();
      const password = req.body?.password || '';
      const user = await users().findOne({ email });
      if (!user || !(await verifyPassword(password, user.passwordHash))) {
        return reply.code(401).send({ error: 'Adresse e-mail ou mot de passe incorrect.' });
      }
      const session = await createSession(user._id);
      reply.setCookie(SESSION_COOKIE, session.id, cookieOpts(session.expiresAt));
      return { email: user.email, displayName: user.displayName };
    }
  );

  app.post('/api/auth/signout', { config: { rateLimit: AUTH_RATE_LIMIT } }, async (req, reply) => {
    await destroySession(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', { preHandler: requireAuth }, async (req, reply) => {
    const user = await users().findOne({ _id: req.userId });
    if (!user) return reply.code(401).send({ error: 'Non authentifié.' });
    return { email: user.email, displayName: user.displayName };
  });
}
