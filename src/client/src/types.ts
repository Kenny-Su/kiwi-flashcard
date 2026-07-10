export interface KiwiContext {
  classId: string;
  className?: string;
  userId: string;
  username?: string;
  userRole?: string;
  appId?: string;
  appSlug?: string;
}

export interface Card {
  id: string;
  question: string;
  answer: string;
  concepts: string[];
  tags: string[];
  classId: string;
  deckId?: string | null;
  pdfId?: string | null;
  pageNumber?: number | null;
  materialType?: string | null;
  sourceContent?: string | null;
  reviewCount: number;
  lastReviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Deck {
  id: string;
  name: string;
  description?: string | null;
  classId: string;
  cards: Card[];
  createdAt: string;
  updatedAt: string;
}

export interface Stats {
  total: number;
  reviewed: number;
  recentlyCreated: number;
}

export interface MultipleChoiceQuestion {
  question: string;
  choices: string[];
  correctIndex: number;
  explanation?: string;
}
