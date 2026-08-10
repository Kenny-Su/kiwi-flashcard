import { HttpError } from '../http-error';
import type { AppRequestContext } from '../auth/app-token.types';

export interface MaterialDocument {
  documentId: string;
  fileName: string;
  totalChunks: number;
}

export interface MaterialSource {
  text: string;
  documents: MaterialDocument[];
  truncated: boolean;
}

interface ChunkResponse {
  classId: string;
  documents: Array<{
    documentId: string;
    fileName: string;
    totalChunks: number;
    chunks: Array<{ chunkId: string; index: number; pageNumber: number | null; type: string; text: string }>;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
}

export const MATERIALS_SCOPE = 'class:materials:chunks:read';

// Kiwi caps a page at 200 chunks; asking for the maximum keeps the number of
// round trips down when we walk a whole class.
const PAGE_LIMIT = 200;
// A class that somehow exceeds this is truncated rather than paged forever.
const MAX_PAGES = 40;
// Roughly 6k tokens of source. The approved generate-cards prompt returns at
// most 1600 tokens, so a larger excerpt buys nothing and costs latency.
const MAX_SOURCE_CHARS = 24_000;
const DOCUMENT_CACHE_TTL_MS = 5 * 60_000;

type Fetch = typeof fetch;

/**
 * Reads the parsed text chunks Kiwi already holds for a class's documents, so
 * students can generate cards from real lecture material instead of pasting it.
 *
 * Kiwi returns only availability-gated materials — the same set the student can
 * see in the class — and image/table chunks arrive as their text description,
 * never raw image data.
 */
export class KiwiMaterialsService {
  private readonly documentCache = new Map<string, { expiresAt: number; documents: MaterialDocument[] }>();

  constructor(
    private readonly baseUrl = process.env.KIWI_API_URL || 'http://localhost:3000',
    private readonly fetchImpl: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * The token carries the scopes Kiwi granted this app for this class. Checking
   * here turns a mid-flow 403 from Kiwi into one clear message at the point the
   * student opens the picker.
   */
  static hasMaterialsScope(scopes: string[]): boolean {
    return scopes.some((scope) => scope === MATERIALS_SCOPE
      || (scope.endsWith(':*') && MATERIALS_SCOPE.startsWith(scope.slice(0, -1))));
  }

  async listDocuments(ctx: AppRequestContext): Promise<MaterialDocument[]> {
    this.assertScope(ctx);

    const cached = this.documentCache.get(ctx.classId);
    if (cached && cached.expiresAt > this.now()) return cached.documents;

    const documents = new Map<string, MaterialDocument>();
    await this.walkChunks(ctx, undefined, (page) => {
      for (const document of page.documents) {
        if (!documents.has(document.documentId)) {
          documents.set(document.documentId, {
            documentId: document.documentId,
            fileName: document.fileName,
            totalChunks: document.totalChunks,
          });
        }
      }
    });

    const list = [...documents.values()];
    this.documentCache.set(ctx.classId, { expiresAt: this.now() + DOCUMENT_CACHE_TTL_MS, documents: list });
    return list;
  }

  /**
   * Assembles the selected documents into prompt-ready source text. Page
   * numbers are kept inline so generated cards can cite where they came from.
   */
  async getSourceText(ctx: AppRequestContext, documentIds: string[]): Promise<MaterialSource> {
    this.assertScope(ctx);
    if (documentIds.length === 0) throw new HttpError(400, 'Select at least one class document');

    const documents = new Map<string, MaterialDocument>();
    const parts: string[] = [];
    let length = 0;
    let truncated = false;
    let currentDocumentId: string | null = null;

    await this.walkChunks(ctx, documentIds, (page) => {
      for (const document of page.documents) {
        // The heading is written with the document's first usable chunk, not on
        // sight: a document Kiwi has not finished parsing carries empty chunks,
        // and a bare filename in the prompt would read as content.
        const heading = `## ${document.fileName}`;
        let headingWritten = currentDocumentId === document.documentId;

        for (const chunk of document.chunks) {
          const text = chunk.text.trim();
          if (!text) continue;
          const line = chunk.pageNumber === null ? text : `[p. ${chunk.pageNumber}] ${text}`;
          const addition = line.length + 1 + (headingWritten ? 0 : heading.length + 1);
          if (length + addition > MAX_SOURCE_CHARS) {
            truncated = true;
            return false; // stop paging; we have all the source the prompt can use
          }
          if (!headingWritten) {
            parts.push(heading);
            headingWritten = true;
            currentDocumentId = document.documentId;
          }
          parts.push(line);
          length += addition;
          documents.set(document.documentId, {
            documentId: document.documentId,
            fileName: document.fileName,
            totalChunks: document.totalChunks,
          });
        }
      }
      return true;
    });

    const text = parts.join('\n').trim();
    if (!text) {
      throw new HttpError(404, 'Those class documents have no readable text yet. Kiwi may still be processing them.');
    }
    return { text, documents: [...documents.values()], truncated };
  }

  /**
   * Pages through the chunk endpoint, handing each page to `onPage`. Returning
   * false from `onPage` stops early.
   */
  private async walkChunks(
    ctx: AppRequestContext,
    documentIds: string[] | undefined,
    onPage: (page: ChunkResponse) => boolean | void,
  ): Promise<void> {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response = await this.fetchPage(ctx, documentIds, cursor);
      if (onPage(response) === false) return;
      if (!response.hasMore || !response.nextCursor) return;
      cursor = response.nextCursor;
    }
  }

  private async fetchPage(
    ctx: AppRequestContext,
    documentIds: string[] | undefined,
    cursor: string | undefined,
  ): Promise<ChunkResponse> {
    const url = new URL(`/api/kiwi-apps/classes/${encodeURIComponent(ctx.classId)}/document-chunks`, this.baseUrl);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    if (documentIds?.length) url.searchParams.set('documentIds', documentIds.join(','));
    if (cursor) url.searchParams.set('cursor', cursor);

    let response: Response;
    try {
      response = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${ctx.token}` } });
    } catch (error) {
      throw new HttpError(502, `Could not reach Kiwi to read class materials: ${error instanceof Error ? error.message : 'request failed'}`);
    }

    if (!response.ok) throw await this.toHttpError(response);
    return (await response.json()) as ChunkResponse;
  }

  private async toHttpError(response: Response): Promise<HttpError> {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    const detail = body?.message;

    if (response.status === 401) {
      return new HttpError(401, 'Kiwi rejected the app token while reading class materials. Reload the page to get a fresh one.');
    }
    if (response.status === 403) {
      return new HttpError(403, detail || `This app is not allowed to read class materials (missing "${MATERIALS_SCOPE}").`);
    }
    return new HttpError(502, detail || `Kiwi returned ${response.status} while reading class materials`);
  }

  private assertScope(ctx: AppRequestContext): void {
    if (KiwiMaterialsService.hasMaterialsScope(ctx.scopes)) return;
    throw new HttpError(
      403,
      'Class materials are not enabled for this class yet. Reload the page, and if it persists ask an admin to grant '
      + `the "${MATERIALS_SCOPE}" scope.`,
    );
  }
}
