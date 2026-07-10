import { useMemo } from 'react';
import { createApiClient } from './api';
import { useKiwiBridge } from './kiwiBridge';
import FlashcardManager from './components/FlashcardManager';
import { Icon, Notice, Spinner } from './components/ui';

export default function App() {
  const { context, appToken, error } = useKiwiBridge();
  const api = useMemo(() => {
    if (!context?.classId || !appToken) return null;
    return createApiClient(appToken, context.classId);
  }, [appToken, context?.classId]);

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
