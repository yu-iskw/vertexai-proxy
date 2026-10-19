export type ModelProvider = 'gemini' | 'claude';

export type ModelDefinition = {
  provider: ModelProvider;
  model: string;
};

export const DEFAULT_MODELS: ReadonlyMap<string, ModelDefinition> = new Map([
  ['gemini-2.5-pro', { provider: 'gemini', model: 'gemini-2.5-pro' }],
  ['gemini-2.5-flash', { provider: 'gemini', model: 'gemini-2.5-flash' }],
  ['gemini-2.0-flash', { provider: 'gemini', model: 'gemini-2.0-flash' }],
  ['claude-sonnet-4', { provider: 'claude', model: 'claude-sonnet-4@20250514' }],
  ['claude-3-5-haiku', { provider: 'claude', model: 'claude-3-5-haiku@20241022' }],
]);

const MODEL_ID_PATTERN = /^[a-zA-Z0-9_.@-]+$/;
const PROVIDERS: readonly ModelProvider[] = ['gemini', 'claude'];

function defaultModels(): Map<string, ModelDefinition> {
  return new Map([...DEFAULT_MODELS].map(([alias, definition]) => [alias, { ...definition }]));
}

function parseTarget(alias: string, target: string): ModelDefinition {
  const slash = target.indexOf('/');
  if (slash <= 0 || slash === target.length - 1) {
    throw new Error(`Invalid VERTEX_MODELS entry "${alias}=${target}". Use alias=provider/model.`);
  }
  const provider = target.slice(0, slash);
  const model = target.slice(slash + 1);
  if (!PROVIDERS.includes(provider as ModelProvider)) {
    throw new Error(`Invalid VERTEX_MODELS provider "${provider}". Use gemini or claude.`);
  }
  if (!MODEL_ID_PATTERN.test(model)) {
    throw new Error(`Invalid VERTEX_MODELS model id "${model}".`);
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

function addEntry(models: Map<string, ModelDefinition>, rawEntry: string): void {
  const entry = rawEntry.trim();
  if (entry === '') throw new Error('VERTEX_MODELS contains an empty entry.');

  const equals = entry.indexOf('=');
  const alias = (equals === -1 ? entry : entry.slice(0, equals)).trim();
  if (!MODEL_ID_PATTERN.test(alias)) {
    throw new Error(`Invalid VERTEX_MODELS alias "${alias}".`);
  }
  if (models.has(alias)) {
    throw new Error(`Duplicate VERTEX_MODELS alias "${alias}".`);
  }

  if (equals === -1) {
    addDefault(models, alias);
    return;
  }
  models.set(alias, parseTarget(alias, entry.slice(equals + 1).trim()));
}

export function resolveModels(raw: string | undefined): ReadonlyMap<string, ModelDefinition> {
  if (raw === undefined || raw.trim() === '') return defaultModels();

  const models = new Map<string, ModelDefinition>();
  for (const rawEntry of raw.split(',')) addEntry(models, rawEntry);
  return models;
}
