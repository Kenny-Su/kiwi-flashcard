import { useMemo } from 'react';
import { createApiClient } from './api';
import { useKiwiBridge } from './kiwiBridge';
import FlashcardManager from './components/FlashcardManager';
import { Icon, Notice, Spinner } from './components/ui';

export default function App() {
  const { context, appToken, scopes, error, contextualChat, getToken } = useKiwiBridge();
  // Keyed on whether we have a token and on the scope list, not on the token
  // value: the client reads the token through getToken on every call, so an
  // hourly refresh must not rebuild it and remount the app mid-session.
  const hasToken = appToken !== null;
  const scopeKey = scopes.join(' ');
  const api = useMemo(() => {
    if (!context?.classId || !hasToken) return null;
    return createApiClient(getToken, context.classId, contextualChat, scopeKey ? scopeKey.split(' ') : []);
  }, [hasToken, context?.classId, contextualChat, getToken, scopeKey]);

  if (!context) {
    return <Loading message="Waiting for Kiwi class context..." detail={error} />;
  }

  if (!appToken || !api) {
    return <Loading message="Requesting scoped app token..." detail={error} />;
  }

  return <FlashcardManager api={api} className={context.className} />;
}

function Loading({ message, detail }: { message: string; detail?: string | null }) {
  return (
    <main className="bridge-state">
      <div>
        <div className="bridge-state__mark"><Icon name="cards" size={27} /></div>
        <Spinner label={message} />
        <h1>Preparing your study space</h1>
        <p>{message}</p>
        {detail && <Notice>{detail}</Notice>}
      </div>
    </main>
  );
}
