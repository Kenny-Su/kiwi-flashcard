import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AppTokenVerifier } from './auth/app-token.guard';
import { SqliteService } from './database/sqlite.service';
import { FlashcardService } from './flashcard/flashcard.service';
import { KiwiMcpService } from './flashcard/kiwi-mcp.service';
import { KiwiMaterialsService } from './flashcard/kiwi-materials.service';
import { createFlashcardRouter } from './flashcard/router';
import { HttpError } from './http-error';

export interface AppDependencies {
  sqlite?: SqliteService;
  kiwiMcp?: KiwiMcpService;
  kiwiMaterials?: KiwiMaterialsService;
  tokenVerifier?: AppTokenVerifier;
  clientDir?: string;
}

export function createApp(dependencies: AppDependencies = {}): Express {
  const app = express();
  const sqlite = dependencies.sqlite || new SqliteService();
  const kiwiMcp = dependencies.kiwiMcp || new KiwiMcpService();
  const kiwiMaterials = dependencies.kiwiMaterials || new KiwiMaterialsService();
  const tokenVerifier = dependencies.tokenVerifier || new AppTokenVerifier();
  const flashcards = new FlashcardService(sqlite, kiwiMcp, kiwiMaterials);
  const origins = (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.disable('x-powered-by');
  app.use(cors({ origin: origins.includes('*') ? true : origins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_request, response) => {
    response.json({ status: 'ok', app: 'kiwi-flashcard', timestamp: new Date().toISOString() });
  });
  app.use('/api', createFlashcardRouter(flashcards, tokenVerifier));

  const clientDir = dependencies.clientDir || join(process.cwd(), 'dist', 'client');
  if (existsSync(clientDir)) {
    app.use(express.static(clientDir));
    app.use('/student', express.static(clientDir));
  }

  app.use('/api', (_request, response) => {
    response.status(404).json({ statusCode: 404, message: 'API route not found' });
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      response.status(error.status).json({ statusCode: error.status, message: error.message });
      return;
    }

    if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
      response.status(400).json({ statusCode: 400, message: 'Invalid JSON body' });
      return;
    }

    const message = error instanceof Error ? error.message : 'Internal server error';
    console.error(error);
    response.status(500).json({ statusCode: 500, message });
  });

  return app;
}
