import { useCallback, useEffect, useRef, useState } from 'react';
import type { KiwiContext } from './types';

export interface ContextualChatResponse {
  output: string;
  promptId: string;
  promptName: string;
  contextIncluded: string[];
  contextOmitted: string[];
}

interface PendingRequest {
  resolve: (value: ContextualChatResponse) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface TokenWaiter {
  resolve: (token: string) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** How long to wait for the host to answer a kiwi:requestToken. */
const TOKEN_REQUEST_TIMEOUT_MS = 15_000;

interface BridgeState {
  context: KiwiContext | null;
  appToken: string | null;
  /** Scopes Kiwi granted this app for this class; drives feature availability. */
  scopes: string[];
  error: string | null;
}

export function useKiwiBridge() {
  const [state, setState] = useState<BridgeState>({ context: null, appToken: null, scopes: [], error: null });
  const kiwiOrigin = useRef('*');
  const pendingRequests = useRef(new Map<string, PendingRequest>());
  // Mirrors state.appToken, but readable synchronously from getToken without
  // making the callback depend on (and be recreated by) every token change.
  const tokenRef = useRef<string | null>(null);
  const tokenWaiters = useRef<TokenWaiter[]>([]);
  const tokenInflight = useRef<Promise<string> | null>(null);

  useEffect(() => {
    const parent = window.parent || window;
    const targetOrigin = '*';

    const onMessage = (event: MessageEvent) => {
      if (event.source !== parent) return;
      const { type, payload } = event.data || {};
      if (type === 'kiwi:context') {
        kiwiOrigin.current = event.origin;
        setState((prev) => ({ ...prev, context: payload }));
        parent.postMessage({ type: 'kiwi:requestToken' }, event.origin);
      }
      if (type === 'kiwi:appToken') {
        const accessToken: string | null = payload?.accessToken || null;
        tokenRef.current = accessToken;
        setState((prev) => ({
          ...prev,
          appToken: accessToken,
          scopes: Array.isArray(payload?.scopes) ? payload.scopes : [],
        }));

        const waiters = tokenWaiters.current;
        tokenWaiters.current = [];
        for (const waiter of waiters) {
          clearTimeout(waiter.timer);
          if (accessToken) waiter.resolve(accessToken);
          else waiter.reject(new Error('Kiwi returned no app token'));
        }
      }
      if (type === 'kiwi:apiResponse' && payload?.requestId) {
        const pending = pendingRequests.current.get(payload.requestId);
        if (!pending) return;
        pendingRequests.current.delete(payload.requestId);
        clearTimeout(pending.timer);
        if (payload.ok) pending.resolve(payload.data);
        else pending.reject(Object.assign(new Error(payload.error?.message || 'Kiwi context request failed'), {
          code: payload.error?.code,
          status: payload.status,
        }));
      }
    };

    window.addEventListener('message', onMessage);
    parent.postMessage({ type: 'kiwi:ready', payload: { preferredChatMode: 'sidepanel' } }, targetOrigin);

    const params = new URLSearchParams(window.location.search);
    const classId = params.get('classId');
    const userId = params.get('userId');
    if (classId && userId && window.parent === window) {
      setState((prev) => ({
        ...prev,
        context: { classId, userId, appSlug: 'flashcards' },
        error: 'Running outside Kiwi iframe. Paste an app token in development is not supported by default.',
      }));
    }

    return () => {
      window.removeEventListener('message', onMessage);
      for (const pending of pendingRequests.current.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Kiwi bridge closed before the request completed'));
      }
      pendingRequests.current.clear();
      for (const waiter of tokenWaiters.current) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('Kiwi bridge closed before the token arrived'));
      }
      tokenWaiters.current = [];
    };
  }, []);

  /**
   * The current app token. Pass the token you just saw rejected to force a
   * refresh: app tokens last an hour, so a study session outlives them, and
   * Kiwi's contract is that the app re-requests and heals rather than holding a
   * dead credential until the student reloads.
   */
  const getToken = useCallback((staleToken?: string): Promise<string> => {
    // Someone already replaced the token this caller was holding, so their 401
    // is old news — hand over the current one instead of minting another.
    const isStale = staleToken !== undefined && tokenRef.current === staleToken;
    if (!isStale && tokenRef.current) return Promise.resolve(tokenRef.current);
    if (tokenInflight.current) return tokenInflight.current;

    const parent = window.parent;
    if (parent === window || kiwiOrigin.current === '*') {
      return Promise.reject(new Error('An app token is only available inside Kiwi.'));
    }

    // The token we hold was rejected, so drop it: any caller arriving mid-flight
    // should wait for the new one rather than reuse a dead credential.
    if (isStale) tokenRef.current = null;

    const request = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        tokenWaiters.current = tokenWaiters.current.filter((waiter) => waiter.timer !== timer);
        reject(new Error('Kiwi did not return an app token in time'));
      }, TOKEN_REQUEST_TIMEOUT_MS);
      tokenWaiters.current.push({ resolve, reject, timer });
      parent.postMessage(
        { type: 'kiwi:requestToken', payload: { reason: isStale ? 'expired' : 'missing' } },
        kiwiOrigin.current,
      );
    });

    // Single-flight: a burst of 401s must produce one kiwi:requestToken, not one
    // per failed call.
    tokenInflight.current = request;
    void request
      .catch(() => undefined)
      .finally(() => {
        if (tokenInflight.current === request) tokenInflight.current = null;
      });

    return request;
  }, []);

  const contextualChat = useCallback((params: Record<string, unknown>) => {
    if (window.parent === window || kiwiOrigin.current === '*') {
      return Promise.reject(new Error('Personal learning context is only available inside Kiwi.'));
    }

    const requestId = crypto.randomUUID();
    return new Promise<ContextualChatResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.current.delete(requestId);
        reject(new Error('Kiwi context request timed out'));
      }, 125_000);
      pendingRequests.current.set(requestId, { resolve, reject, timer });
      window.parent.postMessage({
        type: 'kiwi:apiRequest',
        payload: { requestId, op: 'contextualChat', params },
      }, kiwiOrigin.current);
    });
  }, []);

  return { ...state, contextualChat, getToken };
}
