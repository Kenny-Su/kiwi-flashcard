import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { AppTokenVerifier } from '../auth/app-token.guard';
import type { AppRequestContext } from '../auth/app-token.types';
import { getAppContext } from '../auth/request-context';
import {
  parseCreateCard,
  parseCreateDeck,
  parseGenerateCards,
  parseGenerateMcq,
  parseRecordReview,
  parseStartSession,
  parseUpdateCard,
} from './dto';
import { FlashcardService } from './flashcard.service';

type AppRequest = Request & { appContext?: AppRequestContext };
type AsyncHandler = (request: AppRequest, response: Response, next: NextFunction) => Promise<void>;

function asyncHandler(handler: AsyncHandler): RequestHandler {
  return (request, response, next) => {
    void handler(request as AppRequest, response, next).catch(next);
  };
}

export function createFlashcardRouter(
  flashcards: FlashcardService,
  verifier = new AppTokenVerifier(),
): Router {
  const router = Router();

  router.use(asyncHandler(async (request, _response, next) => {
    request.appContext = await verifier.authenticate(request);
    next();
  }));

  router.get('/cards', asyncHandler(async (request, response) => {
    response.json(await flashcards.listCards(getAppContext(request)));
  }));

  router.get('/cards/search', asyncHandler(async (request, response) => {
    const query = typeof request.query.q === 'string' ? request.query.q : '';
    response.json(await flashcards.searchCards(getAppContext(request), query));
  }));

  router.post('/cards', asyncHandler(async (request, response) => {
    response.status(201).json(await flashcards.createCard(getAppContext(request), parseCreateCard(request.body)));
  }));

  router.patch('/cards/:id', asyncHandler(async (request, response) => {
    response.json(await flashcards.updateCard(getAppContext(request), request.params.id, parseUpdateCard(request.body)));
  }));

  router.delete('/cards/:id', asyncHandler(async (request, response) => {
    response.json(await flashcards.deleteCard(getAppContext(request), request.params.id));
  }));

  router.post('/cards/generate', asyncHandler(async (request, response) => {
    response.status(201).json(await flashcards.generateCards(getAppContext(request), parseGenerateCards(request.body)));
  }));

  router.post('/cards/:id/mcq', asyncHandler(async (request, response) => {
    const dto = parseGenerateMcq(request.body);
    response.status(201).json(await flashcards.generateMcq(getAppContext(request), request.params.id, dto.numChoices || 4));
  }));

  router.post('/reviews', asyncHandler(async (request, response) => {
    response.status(201).json(await flashcards.recordReview(getAppContext(request), parseRecordReview(request.body)));
  }));

  router.get('/stats', asyncHandler(async (request, response) => {
    response.json(await flashcards.stats(getAppContext(request)));
  }));

  router.get('/decks', asyncHandler(async (request, response) => {
    response.json(await flashcards.listDecks(getAppContext(request)));
  }));

  router.post('/decks', asyncHandler(async (request, response) => {
    response.status(201).json(await flashcards.createDeck(getAppContext(request), parseCreateDeck(request.body)));
  }));

  router.post('/decks/:deckId/cards/:cardId', asyncHandler(async (request, response) => {
    response.status(201).json(await flashcards.addCardToDeck(getAppContext(request), request.params.deckId, request.params.cardId));
  }));

  router.post('/sessions', asyncHandler(async (request, response) => {
    response.status(201).json(await flashcards.startSession(getAppContext(request), parseStartSession(request.body)));
  }));

  router.post('/sessions/:sessionId/end', asyncHandler(async (request, response) => {
    response.status(201).json(await flashcards.endSession(getAppContext(request), request.params.sessionId));
  }));

  return router;
}
