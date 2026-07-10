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
  ],
  prompts: [
    {
      promptId: 'generate-cards',
      name: 'Generate Flashcards',
      description: 'Creates concise flashcards from educational source text. Returns JSON only.',
      systemPrompt: 'You create concise study flashcards from educational material. Return JSON only. The JSON must be an array or an object with a flashcards array. Each card must have question, answer, and concepts fields. Keep answers accurate and brief.',
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
