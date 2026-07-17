import { connectDb } from './db.js';
import { buildServer } from './server.js';
import { config } from './config.js';

async function main() {
  await connectDb();
  const app = await buildServer();
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
