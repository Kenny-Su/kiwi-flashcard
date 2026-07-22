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

interface BridgeState {
  context: KiwiContext | null;
  appToken: string | null;
  error: string | null;
}

export function useKiwiBridge() {
  const [state, setState] = useState<BridgeState>({ context: null, appToken: null, error: null });
  const kiwiOrigin = useRef('*');
  const pendingRequests = useRef(new Map<string, PendingRequest>());

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
        setState((prev) => ({ ...prev, appToken: payload?.accessToken || null }));
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
    };
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

  return { ...state, contextualChat };
}
