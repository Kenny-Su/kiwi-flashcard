import type { Request } from 'express';
import type { AppRequestContext } from './app-token.types';

export function getAppContext(request: Request & { appContext?: AppRequestContext }): AppRequestContext {
  if (!request.appContext) {
    throw new Error('Missing app context');
  }
  return request.appContext;
}
