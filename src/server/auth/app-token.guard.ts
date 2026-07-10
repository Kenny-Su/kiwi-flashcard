import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Request } from 'express';
import { HttpError } from '../http-error';
import type { AppRequestContext, AppTokenPayload } from './app-token.types';

type AppTokenConfig = Partial<Pick<NodeJS.ProcessEnv, 'KIWI_JWT_SECRET' | 'KIWI_JWKS_URL' | 'KIWI_API_URL'>>;
type AppTokenRequest = Pick<Request, 'headers' | 'query' | 'body'>;
interface JwtProvider {
  createRemoteJWKSet: typeof createRemoteJWKSet;
  jwtVerify: typeof jwtVerify;
}

const defaultJwtProvider: JwtProvider = { createRemoteJWKSet, jwtVerify };

export class AppTokenVerifier {
  private jwks?: ReturnType<typeof createRemoteJWKSet>;

  constructor(
    private readonly config: AppTokenConfig = process.env,
    private readonly jwt: JwtProvider = defaultJwtProvider,
  ) {}

  async authenticate(request: AppTokenRequest): Promise<AppRequestContext> {
    const token = this.extractBearer(request);
    if (!token) throw new HttpError(401, 'Missing bearer token');

    let payload: AppTokenPayload;
    try {
      payload = await this.verify(token);
    } catch {
      throw new HttpError(401, 'Invalid or expired app token');
    }

    if (payload.type !== 'app_token') throw new HttpError(401, 'Expected Kiwi app token');
    if (payload.appSlug !== 'flashcards') throw new HttpError(403, 'Token is not scoped to flashcards');
    if (!payload.sub || !payload.classId) throw new HttpError(401, 'App token missing user or class context');

    const requestedClassId = this.getRequestedClassId(request);
    if (requestedClassId && requestedClassId !== payload.classId) {
      throw new HttpError(403, 'Requested class does not match app token class');
    }

    return {
      userId: payload.sub,
      classId: payload.classId,
      appSlug: payload.appSlug,
      scopes: payload.scopes || [],
      token,
    };
  }

  private extractBearer(request: AppTokenRequest): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }

  private async verify(token: string): Promise<AppTokenPayload> {
    const jwtSecret = this.config.KIWI_JWT_SECRET;
    if (jwtSecret) {
      const { payload } = await this.jwt.jwtVerify(token, new TextEncoder().encode(jwtSecret), { algorithms: ['HS256'] });
      return payload as unknown as AppTokenPayload;
    }

    const jwksUrl = this.config.KIWI_JWKS_URL || `${this.config.KIWI_API_URL || 'http://localhost:3000'}/.well-known/jwks.json`;
    this.jwks ??= this.jwt.createRemoteJWKSet(new URL(jwksUrl));
    const { payload } = await this.jwt.jwtVerify(token, this.jwks, { algorithms: ['RS256'] });
    return payload as unknown as AppTokenPayload;
  }

  private getRequestedClassId(request: AppTokenRequest): string | undefined {
    const queryClassId = typeof request.query.classId === 'string' ? request.query.classId : undefined;
    const bodyClassId = typeof request.body?.classId === 'string' ? request.body.classId : undefined;
    return queryClassId || bodyClassId;
  }
}
