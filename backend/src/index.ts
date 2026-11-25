import { createApp } from './app.js';
import { closeDatabase } from './db/database.js';
import { runSeed } from './db/seed.js';

const PORT = Number(process.env.PORT ?? 3001);

export function startServer(): ReturnType<ReturnType<typeof createApp>['listen']> {
  const seedResult = runSeed();
  console.log(
    `[NailComparer] SQLite pronto em ${seedResult.databasePath} (${seedResult.totalDesigns} designs)`
  );

  const app = createApp();
  const server = app.listen(PORT, () => {
    console.log(`[NailComparer] Nail AR Studio API listening on http://localhost:${PORT}`);
  });

  const shutdown = (signal: string) => {
    console.log(`[NailComparer] Recebido ${signal}, encerrando servidor...`);
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return server;
}

startServer();
