import { randomBytes } from 'node:crypto';
import type { ObjectId } from 'mongodb';
import { sessions } from '../db.js';
import { config } from '../config.js';

export const SESSION_COOKIE = 'psid';

export async function createSession(userId: ObjectId): Promise<{ id: string; expiresAt: Date }> {
  const id = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + config.sessionTtlMs);
  await sessions().insertOne({ _id: id, userId, createdAt: new Date(), expiresAt });
  return { id, expiresAt };
}

export async function resolveSession(sessionId: string | undefined): Promise<ObjectId | null> {
  if (!sessionId) return null;
  const doc = await sessions().findOne({ _id: sessionId });
  if (!doc) return null;
  if (doc.expiresAt.getTime() <= Date.now()) return null; // belt-and-suspenders — Mongo's TTL sweep isn't instantaneous
  return doc.userId;
}

export async function destroySession(sessionId: string | undefined): Promise<void> {
  if (!sessionId) return;
  await sessions().deleteOne({ _id: sessionId });
}
