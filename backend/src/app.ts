import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createApiRoutes } from './routes/apiRoutes.js';
import { AppError } from './services/AppError.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(): express.Express {
  const app = express();

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Permissions-Policy', 'camera=(self)');
    res.setHeader('Service-Worker-Allowed', '/');
    next();
  });

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.use('/api', createApiRoutes());

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'Rota da API não encontrada.' });
  });

  const frontendDistPath = path.resolve(__dirname, '../../frontend/dist');
  const indexHtmlPath = path.join(frontendDistPath, 'index.html');

  if (fs.existsSync(frontendDistPath) && fs.existsSync(indexHtmlPath)) {
    app.use(express.static(frontendDistPath));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(indexHtmlPath);
    });
  }

  app.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({
          error: err.message,
          ...(err.details ? { details: err.details } : {}),
        });
        return;
      }

      if (
        err &&
        typeof err === 'object' &&
        'type' in err &&
        (err as { type?: string }).type === 'entity.parse.failed'
      ) {
        res.status(400).json({ error: 'JSON inválido no corpo da requisição.' });
        return;
      }

      if (
        err &&
        typeof err === 'object' &&
        'type' in err &&
        (err as { type?: string }).type === 'entity.too.large'
      ) {
        res.status(413).json({ error: 'Payload excede o limite máximo de 10MB.' });
        return;
      }

      const message =
        err instanceof Error ? err.message : 'Erro interno inesperado no servidor.';
      console.error('[NailComparer API Error]', err);
      res.status(500).json({ error: message });
    }
  );

  return app;
}
