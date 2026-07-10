export interface AppTokenPayload {
  sub: string;
  type: 'app_token';
  appSlug: string;
  classId: string;
  scopes: string[];
  iat?: number;
  exp?: number;
}

export interface AppRequestContext {
  userId: string;
  classId: string;
  appSlug: string;
  scopes: string[];
  token: string;
}
