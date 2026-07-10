import { useEffect, useState } from 'react';
import type { KiwiContext } from './types';

interface BridgeState {
  context: KiwiContext | null;
  appToken: string | null;
  error: string | null;
}

export function useKiwiBridge() {
  const [state, setState] = useState<BridgeState>({ context: null, appToken: null, error: null });

  useEffect(() => {
    const parent = window.parent || window;
    const targetOrigin = '*';

    const onMessage = (event: MessageEvent) => {
      const { type, payload } = event.data || {};
      if (type === 'kiwi:context') {
        setState((prev) => ({ ...prev, context: payload }));
        parent.postMessage({ type: 'kiwi:requestToken' }, targetOrigin);
      }
      if (type === 'kiwi:appToken') {
        setState((prev) => ({ ...prev, appToken: payload?.accessToken || null }));
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

    return () => window.removeEventListener('message', onMessage);
  }, []);

  return state;
}
