import { ValidationError } from '../http-error';

export interface CreateCardDto {
  question: string;
  answer: string;
  classId?: string;
  deckId?: string;
  concepts?: string[];
  tags?: string[];
  pdfId?: string;
  pageNumber?: number;
  materialType?: string;
  sourceContent?: string;
  difficultyRating?: number;
  confidence?: number;
}

export type UpdateCardDto = CreateCardDto;

export interface GenerateCardsDto {
  sourceContent: string;
  count?: number;
  classId?: string;
  deckId?: string;
  pdfId?: string;
  pageNumber?: number;
  materialType?: string;
}

export interface CreateDeckDto {
  name: string;
  description?: string;
  classId?: string;
}

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

function optionalInteger(input: Input, key: string, min: number, max = Number.MAX_SAFE_INTEGER): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ValidationError(`${key} must be an integer between ${min} and ${max}`);
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

export const parseUpdateCard = parseCreateCard;

export function parseGenerateCards(value: unknown): GenerateCardsDto {
  const input = object(value);
  return {
    sourceContent: requiredString(input, 'sourceContent'),
    count: optionalInteger(input, 'count', 1, 10),
    classId: optionalString(input, 'classId'),
    deckId: optionalString(input, 'deckId'),
    pdfId: optionalString(input, 'pdfId'),
    pageNumber: optionalInteger(input, 'pageNumber', 1),
    materialType: optionalString(input, 'materialType'),
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
