import { MongoClient, type Collection, type Db, ObjectId } from 'mongodb';
import { config } from './config.js';

export interface UserDoc {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: Date;
}

// _id is the session token itself (a random string, see auth/session.ts) —
// looking up a session is then a single indexed _id read, no secondary
// index needed. expiresAt backs a TTL index so stale sessions are
// garbage-collected by MongoDB itself, no cron job required.
export interface SessionDoc {
  _id: string;
  userId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
}

// _id reuses the frontend's own client-generated project id (lib/id.js's
// uid('doc')) instead of a fresh ObjectId — a project created locally
// before ever being saved to the cloud keeps the exact same id once synced,
// so there's no id-remapping step anywhere in the client.
//
// `json` is presEditor's own versioned M11 project envelope
// (lib/projectFile.ts: {format, version, savedAt, state}) stored verbatim —
// the backend treats it as an opaque blob it round-trips, never
// interprets, so a client-side format migration never needs a server
// change.
export interface ProjectDoc {
  _id: string;
  ownerId: ObjectId;
  title: string;
  json: unknown;
  thumbnail: string | null;
  createdAt: Date;
  updatedAt: Date;
}

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDb(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(config.mongoUri);
  await client.connect();
  db = client.db();
  await ensureIndexes(db);
  return db;
}

async function ensureIndexes(database: Db) {
  await database.collection<UserDoc>('users').createIndex({ email: 1 }, { unique: true });
  await database.collection<SessionDoc>('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await database.collection<ProjectDoc>('projects').createIndex({ ownerId: 1, updatedAt: -1 });
}

export function users(): Collection<UserDoc> {
  if (!db) throw new Error('Database not connected yet');
  return db.collection<UserDoc>('users');
}

export function sessions(): Collection<SessionDoc> {
  if (!db) throw new Error('Database not connected yet');
  return db.collection<SessionDoc>('sessions');
}

export function projects(): Collection<ProjectDoc> {
  if (!db) throw new Error('Database not connected yet');
  return db.collection<ProjectDoc>('projects');
}

export async function closeDb() {
  await client?.close();
  db = null;
  client = null;
}
