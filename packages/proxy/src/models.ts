export type ModelProvider = 'gemini' | 'claude';

export type ModelDefinition = {
  provider: ModelProvider;
  model: string;
};

const DEFAULT_MODELS: ReadonlyMap<string, ModelDefinition> = new Map([
  ['gemini-4-argon', { provider: 'gemini', model: 'gemini-4-argon' }],
  ['gemini-3.8-flash', { provider: 'gemini', model: 'gemini-3.8-flash' }],
  ['gemini-3.7-flash', { provider: 'gemini', model: 'gemini-3.7-flash' }],
  ['gemini-3.1-pro-preview', { provider: 'gemini', model: 'gemini-3.1-pro-preview' }],
  ['gemini-2.5-pro', { provider: 'gemini', model: 'gemini-2.5-pro' }],
  ['gemini-2.5-flash', { provider: 'gemini', model: 'gemini-2.5-flash' }],
  ['claude-opus-5-5', { provider: 'claude', model: 'claude-opus-5-5' }],
  ['claude-sonnet-5-5', { provider: 'claude', model: 'claude-sonnet-5-5' }],
  ['claude-haiku-5-5', { provider: 'claude', model: 'claude-haiku-5-5' }],
  ['claude-fable-5-1', { provider: 'claude', model: 'claude-fable-5-1' }],
  ['claude-opus-4-8', { provider: 'claude', model: 'claude-opus-4-8' }],
  ['claude-sonnet-4-6', { provider: 'claude', model: 'claude-sonnet-4-6' }],
]);

const MODEL_ID_PATTERN = /^[a-zA-Z0-9_.@-]+$/;
const PROVIDERS: readonly ModelProvider[] = ['gemini', 'claude'];

function defaultModels(): Map<string, ModelDefinition> {
  return new Map([...DEFAULT_MODELS].map(([alias, definition]) => [alias, { ...definition }]));
}

function parseTarget(alias: string, target: string, source: string): ModelDefinition {
  const slash = target.indexOf('/');
  if (slash <= 0 || slash === target.length - 1) {
    throw new Error(`Invalid ${source} entry "${alias}=${target}". Use alias=provider/model.`);
  }
  const provider = target.slice(0, slash);
  const model = target.slice(slash + 1);
  if (!PROVIDERS.includes(provider as ModelProvider)) {
    throw new Error(`Invalid ${source} provider "${provider}". Use gemini or claude.`);
  }
  if (!MODEL_ID_PATTERN.test(model)) {
    throw new Error(`Invalid ${source} model id "${model}".`);
  }
  return { provider: provider as ModelProvider, model };
}

function addDefault(models: Map<string, ModelDefinition>, alias: string): void {
  const definition = DEFAULT_MODELS.get(alias);
  if (definition === undefined) {
    throw new Error(
      `Unknown default model "${alias}". Available: ${[...DEFAULT_MODELS.keys()].join(', ')}.`,
    );
  }
  models.set(alias, { ...definition });
}

function addEntry(models: Map<string, ModelDefinition>, rawEntry: string, source: string): void {
  const entry = rawEntry.trim();
  if (entry === '') throw new Error(`${source} contains an empty entry.`);

  const equals = entry.indexOf('=');
  const alias = (equals === -1 ? entry : entry.slice(0, equals)).trim();
  if (!MODEL_ID_PATTERN.test(alias)) {
    throw new Error(`Invalid ${source} alias "${alias}".`);
  }
  if (models.has(alias)) {
    throw new Error(`Duplicate ${source} alias "${alias}".`);
  }

  if (equals === -1) {
    addDefault(models, alias);
    return;
  }
  models.set(alias, parseTarget(alias, entry.slice(equals + 1).trim(), source));
}

export function resolveModels(
  raw: string | undefined,
  source = 'VERTEX_MODELS',
): ReadonlyMap<string, ModelDefinition> {
  if (raw === undefined || raw.trim() === '') return defaultModels();

  const models = new Map<string, ModelDefinition>();
  for (const rawEntry of raw.split(',')) addEntry(models, rawEntry, source);
  return models;
}
