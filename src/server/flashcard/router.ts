import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { AppTokenVerifier } from '../auth/app-token.guard';
import type { AppRequestContext } from '../auth/app-token.types';
import { getAppContext } from '../auth/request-context';
import {
  parseCreateCard,
  parseCreateClassCard,
  parseCreateCardLinks,
  parseCreateCards,
  parseCreateDeck,
  parseGenerateCards,
  parseGenerateCardsFromMaterials,
  parseGenerateMcq,
  parseExplainCardLink,
  parseRecordReview,
  parseReorderDeckCards,
  parseStartSession,
  parseSuggestCardLinks,
  parseUpdateCard,
  parseUpdateCardLink,
  parseUpdateDeck,
} from './dto';
import { FlashcardService } from './flashcard.service';
import { ExportTicketService } from './export-tickets';

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
  exports = new ExportTicketService(),
): Router {
  const router = Router();

  // A random, short-lived, single-use URL lets an embedded app hand the file
  // to a top-level browser download without putting the app token in the URL.
  router.get('/exports/:ticket', (request, response, next) => {
    try {
      const file = exports.consume(request.params.ticket);
      response.setHeader('Content-Type', file.contentType);
      const fallback = file.filename.replace(/[^\x20-\x7E]/g, '_');
      response.setHeader('Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
      response.setHeader('Cache-Control', 'no-store');
      response.send(file.contents);
    } catch (error) { next(error); }
  });

  router.use(asyncHandler(async (request, _response, next) => {
    request.appContext = await verifier.authenticate(request);
    next();
  }));

  router.post('/exports', asyncHandler(async (request, response) => {
    const ticket = exports.create(request.body);
    response.status(201).json({ downloadUrl: `/api/exports/${ticket}` });
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

  router.post('/cards/batch', asyncHandler(async (request, response) => {
    response.status(201).json(await flashcards.createCards(getAppContext(request), parseCreateCards(request.body)));
  }));

  router.patch('/cards/:id', asyncHandler(async (request, response) => {
    response.json(await flashcards.updateCard(getAppContext(request), request.params.id, parseUpdateCard(request.body)));
  }));

  router.delete('/cards/:id', asyncHandler(async (request, response) => {
    response.json(await flashcards.deleteCard(getAppContext(request), request.params.id));
  }));

  router.post('/cards/generate', asyncHandler(async (request, response) => {
    response.json(await flashcards.generateCards(getAppContext(request), parseGenerateCards(request.body)));
  }));

  router.get('/materials', asyncHandler(async (request, response) => {
    response.json(await flashcards.listMaterials(getAppContext(request)));
  }));

  router.post('/cards/generate-from-materials', asyncHandler(async (request, response) => {
    response.json(await flashcards.generateCardsFromMaterials(getAppContext(request), parseGenerateCardsFromMaterials(request.body)));
  }));

  router.post('/cards/:id/mcq', asyncHandler(async (request, response) => {
    const dto = parseGenerateMcq(request.body);
    response.status(201).json(await flashcards.generateMcq(getAppContext(request), request.params.id, dto.numChoices || 4));
  }));

  router.get('/card-links', asyncHandler(async (request, response) => {
    const deckId = typeof request.query.deckId === 'string' ? request.query.deckId : '';
    response.json(await flashcards.listCardLinks(getAppContext(request), deckId));
  }));

  router.post('/card-links', asyncHandler(async (request, response) => {
    response.status(201).json(await flashcards.createCardLinks(getAppContext(request), parseCreateCardLinks(request.body)));
  }));

  router.post('/card-links/explain', asyncHandler(async (request, response) => {
    response.json(await flashcards.explainCardLink(getAppContext(request), parseExplainCardLink(request.body)));
  }));

  router.patch('/card-links/:id', asyncHandler(async (request, response) => {
    response.json(await flashcards.updateCardLink(getAppContext(request), request.params.id, parseUpdateCardLink(request.body)));
  }));

  router.delete('/card-links/:id', asyncHandler(async (request, response) => {
    response.json(await flashcards.deleteCardLink(getAppContext(request), request.params.id));
  }));

  router.post('/card-links/suggest', asyncHandler(async (request, response) => {
    response.json(await flashcards.suggestCardLinks(getAppContext(request), parseSuggestCardLinks(request.body)));
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

  router.get('/class-decks', asyncHandler(async (request, response) => {
    response.json(await flashcards.listClassDecks(getAppContext(request)));
  }));

  router.post('/class-decks', asyncHandler(async (request, response) => {
    response.status(201).json(await flashcards.createClassDeck(getAppContext(request), parseCreateDeck(request.body)));
  }));

  router.patch('/class-decks/:deckId', asyncHandler(async (request, response) => {
    response.json(await flashcards.updateClassDeck(getAppContext(request), request.params.deckId, parseUpdateDeck(request.body)));
  }));

  router.delete('/class-decks/:deckId', asyncHandler(async (request, response) => {
    response.json(await flashcards.deleteClassDeck(getAppContext(request), request.params.deckId));
  }));

  router.post('/class-decks/:deckId/generate-from-materials', asyncHandler(async (request, response) => {
    response.json(await flashcards.generateClassCardsFromMaterials(getAppContext(request), request.params.deckId, parseGenerateCardsFromMaterials(request.body)));
  }));

  router.post('/class-decks/:deckId/cards/batch', asyncHandler(async (request, response) => {
    response.status(201).json(await flashcards.createClassCards(getAppContext(request), request.params.deckId, parseCreateCards(request.body)));
  }));

  router.post('/class-cards', asyncHandler(async (request, response) => {
    response.status(201).json(await flashcards.createClassCard(getAppContext(request), parseCreateClassCard(request.body)));
  }));

  router.patch('/class-cards/:cardId', asyncHandler(async (request, response) => {
    response.json(await flashcards.updateClassCard(getAppContext(request), request.params.cardId, parseUpdateCard(request.body)));
  }));

  router.delete('/class-cards/:cardId', asyncHandler(async (request, response) => {
    response.json(await flashcards.deleteClassCard(getAppContext(request), request.params.cardId));
  }));

  router.put('/class-decks/:deckId/cards/order', asyncHandler(async (request, response) => {
    response.json(await flashcards.reorderClassDeckCards(getAppContext(request), request.params.deckId, parseReorderDeckCards(request.body)));
  }));

  router.post('/decks', asyncHandler(async (request, response) => {
    response.status(201).json(await flashcards.createDeck(getAppContext(request), parseCreateDeck(request.body)));
  }));

  router.patch('/decks/:deckId', asyncHandler(async (request, response) => {
    response.json(await flashcards.updateDeck(getAppContext(request), request.params.deckId, parseUpdateDeck(request.body)));
  }));

  router.delete('/decks/:deckId', asyncHandler(async (request, response) => {
    response.json(await flashcards.deleteDeck(getAppContext(request), request.params.deckId));
  }));

  router.post('/decks/:deckId/cards/:cardId', asyncHandler(async (request, response) => {
    response.status(201).json(await flashcards.addCardToDeck(getAppContext(request), request.params.deckId, request.params.cardId));
  }));

  router.delete('/decks/:deckId/cards/:cardId', asyncHandler(async (request, response) => {
    response.json(await flashcards.removeCardFromDeck(getAppContext(request), request.params.deckId, request.params.cardId));
  }));

  router.put('/decks/:deckId/cards/order', asyncHandler(async (request, response) => {
    response.json(await flashcards.reorderDeckCards(getAppContext(request), request.params.deckId, parseReorderDeckCards(request.body)));
  }));

  router.post('/sessions', asyncHandler(async (request, response) => {
    response.status(201).json(await flashcards.startSession(getAppContext(request), parseStartSession(request.body)));
  }));

  router.post('/sessions/:sessionId/end', asyncHandler(async (request, response) => {
    response.status(201).json(await flashcards.endSession(getAppContext(request), request.params.sessionId));
  }));

  return router;
}
