import { createServer } from 'node:http';
import { createApp } from './app';
import { SqliteService } from './database/sqlite.service';

async function start() {
  const port = Number(process.env.PORT || 8002);
  const sqlite = new SqliteService();

  const server = createServer(createApp({ sqlite }));
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once('error', onError);
    server.listen(port, () => {
      server.off('error', onError);
      resolve();
    });
  });
  console.log(`Kiwi Flashcard listening on http://localhost:${port}`);

  const shutdown = (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => {
      sqlite.close();
      process.exit(0);
    });
  };

  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
