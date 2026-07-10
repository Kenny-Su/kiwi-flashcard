import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { AppTokenVerifier } from './app-token.guard';

let verifyResult: any;
let verifyError: Error | undefined;
let verifyCalls: any[][] = [];
const jwt = {
  createRemoteJWKSet: (() => 'jwks') as any,
  jwtVerify: (async (...args: any[]) => {
    verifyCalls.push(args);
    if (verifyError) throw verifyError;
    return verifyResult;
  }) as any,
};

describe('AppTokenVerifier', () => {
  const verifier = new AppTokenVerifier({ KIWI_JWKS_URL: 'http://kiwi.test/.well-known/jwks.json' }, jwt);

  beforeEach(() => {
    verifyCalls = [];
    verifyError = undefined;
  });

  it('accepts valid flashcards app tokens', async () => {
    verifyResult = { payload: { type: 'app_token', appSlug: 'flashcards', sub: 'user-1', classId: 'class-1', scopes: ['llm:prompt:*'] } };
    const context = await verifier.authenticate({
      headers: { authorization: 'Bearer token' }, query: { classId: 'class-1' }, body: {},
    } as any);

    assert.equal(context.userId, 'user-1');
    assert.equal(context.classId, 'class-1');
    assert.equal(context.appSlug, 'flashcards');
  });

  it('uses local HS256 secret when KIWI_JWT_SECRET is configured', async () => {
    const localVerifier = new AppTokenVerifier({ KIWI_JWT_SECRET: 'dev-secret' }, jwt);
    verifyResult = { payload: { type: 'app_token', appSlug: 'flashcards', sub: 'user-1', classId: 'class-1', scopes: [] } };

    const context = await localVerifier.authenticate({
      headers: { authorization: 'Bearer token' }, query: {}, body: {},
    } as any);

    assert.equal(context.userId, 'user-1');
    assert.deepEqual(verifyCalls[0][2], { algorithms: ['HS256'] });
  });

  it('rejects tokens for another app', async () => {
    verifyResult = { payload: { type: 'app_token', appSlug: 'other', sub: 'user-1', classId: 'class-1', scopes: [] } };
    await assert.rejects(
      () => verifier.authenticate({ headers: { authorization: 'Bearer token' }, query: {}, body: {} } as any),
      (error: any) => error.status === 403,
    );
  });

  it('rejects class mismatch', async () => {
    verifyResult = { payload: { type: 'app_token', appSlug: 'flashcards', sub: 'user-1', classId: 'class-1', scopes: [] } };
    await assert.rejects(
      () => verifier.authenticate({ headers: { authorization: 'Bearer token' }, query: { classId: 'class-2' }, body: {} } as any),
      (error: any) => error.status === 403,
    );
  });

  it('rejects missing bearer token', async () => {
    await assert.rejects(
      () => verifier.authenticate({ headers: {}, query: {}, body: {} } as any),
      (error: any) => error.status === 401,
    );
  });
});
