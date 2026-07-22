export const config = {
  port: Number(process.env.PORT || 4000),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/preseditor',
  cookieSecret: process.env.COOKIE_SECRET || 'dev-only-insecure-secret-change-me',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()),
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  // Session lifetime — enforced both as the cookie's maxAge and as a Mongo
  // TTL index on sessions.expiresAt (db.ts), so an expired session is both
  // unusable and automatically garbage-collected without a cron job.
  sessionTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
};
