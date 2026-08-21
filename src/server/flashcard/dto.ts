import { ValidationError } from '../http-error';

export interface CreateCardDto {
  question: string;
  answer: string;
  classId?: string;
  deckId?: string;
  deckIds?: string[];
  concepts?: string[];
  tags?: string[];
  pdfId?: string;
  pageNumber?: number;
  materialType?: string;
  sourceContent?: string;
  difficultyRating?: number;
  confidence?: number;
}

export type UpdateCardDto = Omit<CreateCardDto, 'deckId'> & { deckId?: string | null };

export interface CreateCardsDto {
  cards: CreateCardDto[];
}

export type CardGenerationCount = number | 'auto';

export interface GenerateCardsDto {
  sourceContent: string;
  count?: CardGenerationCount;
  classId?: string;
  deckId?: string;
  pdfId?: string;
  pageNumber?: number;
  materialType?: string;
}

export interface GenerateCardsFromMaterialsDto {
  documentIds: string[];
  count?: CardGenerationCount;
  deckId?: string;
}

export interface CreateDeckDto {
  name: string;
  description?: string;
  classId?: string;
}

export interface CreateClassCardDto extends CreateCardDto {
  deckId: string;
}

export interface UpdateDeckDto {
  name?: string;
  description?: string | null;
}

export interface ReorderDeckCardsDto { cardIds: string[]; }

export interface RecordReviewDto {
  cardId: string;
  isCorrect: boolean;
  sessionId?: string;
}

export interface StartSessionDto {
  deckId?: string;
}

export interface GenerateMcqDto {
  numChoices?: number;
}

export interface CreateCardLinkDto {
  sourceCardId: string;
  targetCardId: string;
  explanation: string;
}

export interface CreateCardLinksDto {
  links: CreateCardLinkDto[];
}

export interface SuggestCardLinksDto {
  deckId: string;
}

export interface ExplainCardLinkDto { sourceCardId: string; targetCardId: string; }
export interface UpdateCardLinkDto { explanation: string; }

type Input = Record<string, unknown>;

function object(value: unknown): Input {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError('Request body must be a JSON object');
  }
  return value as Input;
}

function requiredString(input: Input, key: string): string {
  const value = input[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ValidationError(`${key} must be a non-empty string`);
  }
  return value;
}

function optionalString(input: Input, key: string): string | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ValidationError(`${key} must be a string`);
  return value;
}

function optionalNullableString(input: Input, key: string): string | null | undefined {
  const value = input[key];
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') throw new ValidationError(`${key} must be a string or null`);
  return value;
}

function optionalInteger(input: Input, key: string, min: number, max = Number.MAX_SAFE_INTEGER): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ValidationError(`${key} must be an integer between ${min} and ${max}`);
  }
  return value as number;
}

function optionalGenerationCount(input: Input, key: string): CardGenerationCount | undefined {
  const value = input[key];
  if (value === undefined || value === 'auto') return value;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 10) {
    throw new ValidationError(`${key} must be "auto" or an integer between 1 and 10`);
  }
  return value as number;
}

function optionalStringArray(input: Input, key: string): string[] | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new ValidationError(`${key} must be an array of strings`);
  }
  return value;
}

export function parseCreateCard(value: unknown): CreateCardDto {
  const input = object(value);
  return {
    question: requiredString(input, 'question'),
    answer: requiredString(input, 'answer'),
    classId: optionalString(input, 'classId'),
    deckId: optionalString(input, 'deckId'),
    deckIds: optionalStringArray(input, 'deckIds'),
    concepts: optionalStringArray(input, 'concepts'),
    tags: optionalStringArray(input, 'tags'),
    pdfId: optionalString(input, 'pdfId'),
    pageNumber: optionalInteger(input, 'pageNumber', 1),
    materialType: optionalString(input, 'materialType'),
    sourceContent: optionalString(input, 'sourceContent'),
    difficultyRating: optionalInteger(input, 'difficultyRating', 1, 5),
    confidence: optionalInteger(input, 'confidence', 1, 5),
  };
}

export function parseCreateClassCard(value: unknown): CreateClassCardDto {
  const card = parseCreateCard(value);
  if (!card.deckId) throw new ValidationError('deckId must be a non-empty string');
  return card as CreateClassCardDto;
}

export function parseCreateCards(value: unknown): CreateCardsDto {
  const input = object(value);
  if (!Array.isArray(input.cards) || input.cards.length === 0 || input.cards.length > 10) {
    throw new ValidationError('cards must be an array containing between 1 and 10 cards');
  }
  return { cards: input.cards.map(parseCreateCard) };
}

export function parseUpdateCard(value: unknown): UpdateCardDto {
  const input = object(value);
  return {
    question: requiredString(input, 'question'),
    answer: requiredString(input, 'answer'),
    classId: optionalString(input, 'classId'),
    deckId: optionalNullableString(input, 'deckId'),
    deckIds: optionalStringArray(input, 'deckIds'),
    concepts: optionalStringArray(input, 'concepts'),
    tags: optionalStringArray(input, 'tags'),
    pdfId: optionalString(input, 'pdfId'),
    pageNumber: optionalInteger(input, 'pageNumber', 1),
    materialType: optionalString(input, 'materialType'),
    sourceContent: optionalString(input, 'sourceContent'),
    difficultyRating: optionalInteger(input, 'difficultyRating', 1, 5),
    confidence: optionalInteger(input, 'confidence', 1, 5),
  };
}

export function parseGenerateCards(value: unknown): GenerateCardsDto {
  const input = object(value);
  return {
    sourceContent: requiredString(input, 'sourceContent'),
    count: optionalGenerationCount(input, 'count'),
    classId: optionalString(input, 'classId'),
    deckId: optionalString(input, 'deckId'),
    pdfId: optionalString(input, 'pdfId'),
    pageNumber: optionalInteger(input, 'pageNumber', 1),
    materialType: optionalString(input, 'materialType'),
  };
}

export function parseGenerateCardsFromMaterials(value: unknown): GenerateCardsFromMaterialsDto {
  const input = object(value);
  const documentIds = optionalStringArray(input, 'documentIds');
  // Kiwi caps documentIds at 50 per request; rejecting here keeps the error on
  // this side of the network with a message a student can act on.
  if (!documentIds || documentIds.length === 0 || documentIds.length > 50) {
    throw new ValidationError('documentIds must contain between 1 and 50 class document IDs');
  }
  return {
    documentIds,
    count: optionalGenerationCount(input, 'count'),
    deckId: optionalString(input, 'deckId'),
  };
}

export function parseCreateDeck(value: unknown): CreateDeckDto {
  const input = object(value);
  return {
    name: requiredString(input, 'name'),
    description: optionalString(input, 'description'),
    classId: optionalString(input, 'classId'),
  };
}

export function parseUpdateDeck(value: unknown): UpdateDeckDto {
  const input = object(value);
  const name = optionalString(input, 'name');
  if (name !== undefined && name.length === 0) throw new ValidationError('name must be a non-empty string');
  return {
    name,
    description: optionalNullableString(input, 'description'),
  };
}

export function parseReorderDeckCards(value: unknown): ReorderDeckCardsDto {
  const input = object(value);
  if (!Array.isArray(input.cardIds) || input.cardIds.some((item) => typeof item !== 'string')) {
    throw new ValidationError('cardIds must be an array of strings');
  }
  return { cardIds: input.cardIds as string[] };
}

export function parseRecordReview(value: unknown): RecordReviewDto {
  const input = object(value);
  if (typeof input.isCorrect !== 'boolean') throw new ValidationError('isCorrect must be a boolean');
  return {
    cardId: requiredString(input, 'cardId'),
    isCorrect: input.isCorrect,
    sessionId: optionalString(input, 'sessionId'),
  };
}

export function parseStartSession(value: unknown): StartSessionDto {
  const input = object(value);
  return { deckId: optionalString(input, 'deckId') };
}

export function parseGenerateMcq(value: unknown): GenerateMcqDto {
  const input = object(value);
  return { numChoices: optionalInteger(input, 'numChoices', 2, 6) };
}

export function parseCreateCardLinks(value: unknown): CreateCardLinksDto {
  const input = object(value);
  if (!Array.isArray(input.links) || input.links.length === 0 || input.links.length > 20) {
    throw new ValidationError('links must be an array containing between 1 and 20 links');
  }
  return {
    links: input.links.map((value) => {
      const link = object(value);
      return {
        sourceCardId: requiredString(link, 'sourceCardId'),
        targetCardId: requiredString(link, 'targetCardId'),
        explanation: requiredString(link, 'explanation'),
      };
    }),
  };
}

export function parseSuggestCardLinks(value: unknown): SuggestCardLinksDto {
  const input = object(value);
  return { deckId: requiredString(input, 'deckId') };
}

export function parseExplainCardLink(value: unknown): ExplainCardLinkDto {
  const input = object(value);
  return { sourceCardId: requiredString(input, 'sourceCardId'), targetCardId: requiredString(input, 'targetCardId') };
}

export function parseUpdateCardLink(value: unknown): UpdateCardLinkDto {
  const input = object(value);
  return { explanation: requiredString(input, 'explanation') };
}
