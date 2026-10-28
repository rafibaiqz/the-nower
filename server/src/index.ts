/** Entry point: `npm run dev -w server` or `node server/dist/index.js`. */
import { config } from './config';
import { log } from './log';
import { createGameServer } from './server';

process.on('unhandledRejection', (err) => log.error('unhandled rejection', { err: String(err) }));
process.on('uncaughtException', (err) => log.error('uncaught exception', { err: String(err?.stack ?? err) }));

const server = await createGameServer(config.port, config.host);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    log.info(`received ${sig}, shutting down`);
    await server.close();
    process.exit(0);
  });
}
