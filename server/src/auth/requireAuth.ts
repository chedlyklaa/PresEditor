import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ObjectId } from 'mongodb';
import { resolveSession, SESSION_COOKIE } from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: ObjectId;
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const sessionId = req.cookies[SESSION_COOKIE];
  const userId = await resolveSession(sessionId);
  if (!userId) {
    reply.code(401).send({ error: 'Non authentifié.' });
    return;
  }
  req.userId = userId;
}
