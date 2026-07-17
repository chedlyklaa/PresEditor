import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import authRoutes from './routes/auth.js';
import projectRoutes from './routes/projects.js';

export async function buildServer() {
  // Project JSON embeds data-URL images (see presEditor's lib/assets.ts —
  // deduped by exact equality, not hashed/compressed), so a single project
  // payload can legitimately run into the tens of MB. Fastify's 1MB default
  // bodyLimit would reject those outright.
  const app = Fastify({ logger: true, bodyLimit: 50 * 1024 * 1024 });

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });
  await app.register(cookie);
  // Global default is generous; auth.ts tightens this per-route (signup/
  // signin/signout) via each route's own `config.rateLimit` override, since
  // those are the only endpoints a credential-stuffing/brute-force attempt
  // would hit.
  await app.register(rateLimit, { global: false, max: 100, timeWindow: '1 minute' });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(authRoutes);
  await app.register(projectRoutes);

  return app;
}
