const kiwiApiUrl = process.env.KIWI_API_URL || 'http://localhost:3000';
const appUrl = process.env.FLASHCARD_APP_URL || 'http://localhost:8002';
const registrationSecret = process.env.FLASHCARD_REGISTRATION_SECRET;

if (!registrationSecret) {
  throw new Error('FLASHCARD_REGISTRATION_SECRET is required');
}

const payload = {
  slug: 'flashcards',
  registrationSecret,
  name: 'Flashcards',
  description: 'Spaced-repetition flashcards for class materials',
  baseUrl: appUrl,
  category: 'plugin',
  version: '0.1.0',
  appType: 'full',
  capabilities: ['mcp', 'frontend-actions', 'ai'],
  uis: [
    {
      uiSlug: 'student',
      uiName: 'Flashcards',
      uiUrl: `${appUrl}/student`,
      placement: 'class-tab',
      allowedRoles: ['student', 'ta', 'instructor'],
      tabOrder: 0,
    },
    {
      // Kiwi's admin sidebar discovers apps through an `admin-panel` UI. Once
      // opened with a selected class, the host still mints a class-scoped token
      // and supplies classId to this same URL.
      uiSlug: 'admin',
      uiName: 'Flashcard Manager',
      uiUrl: `${appUrl}/admin`,
      placement: 'admin-panel',
      allowedRoles: ['instructor', 'admin'],
      tabOrder: 0,
    },
    {
      // Compatibility surface for Kiwi routes that enumerate class-local
      // panels directly instead of entering through the global admin sidebar.
      uiSlug: 'class-admin',
      uiName: 'Flashcard Manager',
      uiUrl: `${appUrl}/admin`,
      placement: 'class-admin-panel',
      allowedRoles: ['instructor', 'admin'],
      tabOrder: 0,
    },
  ],
  prompts: [
    {
      promptId: 'generate-cards',
      name: 'Generate Flashcards',
      description: 'Creates concise flashcards from educational source text. Returns JSON only.',
      systemPrompt: 'You create concise study flashcards from educational material. Follow the requested quantity: when given an exact number, return exactly that many cards; when asked to choose automatically, return between 1 and 10 cards based on the number of distinct, useful concepts. Avoid redundant or trivial cards. Return JSON only as an object with a flashcards array. Each card must have question and answer fields. Keep answers accurate and brief.',
      maxTokens: 1600,
      temperature: 0.4,
    },
    {
      promptId: 'generate-mcq',
      name: 'Generate Multiple Choice Question',
      description: 'Creates one multiple-choice question from a flashcard. Returns JSON only.',
      systemPrompt: 'You create one multiple-choice question from a flashcard. Return JSON only with question, choices, correctIndex, and explanation. Distractors should be plausible but clearly wrong.',
      maxTokens: 900,
      temperature: 0.4,
    },
    {
      promptId: 'suggest-card-links',
      name: 'Suggest Card Connections',
      description: 'Suggests meaningful, explained connections between accepted flashcards. Returns JSON only.',
      systemPrompt: 'Identify only strong connections between supplied flashcards. Return JSON only as an object with a links array. Each link must contain sourceCardId, targetCardId, and explanation. The explanation must be one concise sentence that explicitly names both concepts and explains their specific connection using only the supplied card content. Never say concepts are merely related. Use only supplied card IDs. Exclude weak, speculative, duplicate, and self-referential links. Return at most 12 links.',
      maxTokens: 1800,
      temperature: 0.2,
    },
    {
      promptId: 'explain-card-link',
      name: 'Explain Card Connection',
      description: 'Explains one connection between two accepted flashcards. Returns JSON only.',
      systemPrompt: 'Return JSON only with one explanation field. Write one concise sentence that explicitly names both supplied concepts and explains their specific connection using only the two cards. Never say they are merely related and never introduce outside facts.',
      maxTokens: 300,
      temperature: 0.35,
    },
  ],
};

async function main() {
  const response = await fetch(`${kiwiApiUrl}/api/kiwi-apps/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Registration failed: ${response.status} ${body}`);
  }
  console.log(JSON.stringify(await response.json(), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
