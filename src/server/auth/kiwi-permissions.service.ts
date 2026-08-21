import type { AppRequestContext } from './app-token.types';
import { HttpError } from '../http-error';

export class KiwiPermissionsService {
  constructor(
    private readonly baseUrl = process.env.KIWI_API_URL || 'http://localhost:3000',
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async requireClassManager(ctx: AppRequestContext): Promise<void> {
    const url = new URL('/api/permissions/class-role', this.baseUrl);
    url.searchParams.set('userId', ctx.userId);
    url.searchParams.set('classId', ctx.classId);
    let response: Response;
    try {
      response = await this.fetcher(url);
    } catch (error) {
      throw new HttpError(502, `Could not verify class permissions with Kiwi: ${error instanceof Error ? error.message : 'request failed'}`);
    }
    if (!response.ok) throw new HttpError(502, `Kiwi returned ${response.status} while verifying class permissions`);
    const result = await response.json() as { role?: string | null };
    if (result.role !== 'professor' && result.role !== 'admin') {
      throw new HttpError(403, 'Only class instructors and administrators can manage class decks');
    }
  }
}
