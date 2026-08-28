import type {
  ElevenLabsApiLanguage,
  ElevenLabsApiModel,
  ElevenLabsApiVoice,
  ElevenLabsLanguage,
  ElevenLabsModel,
  ElevenLabsModelRates,
  ElevenLabsVerifiedLanguage,
  ElevenLabsVoice,
  ElevenLabsVoiceSettings,
} from './apiContracts';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function normalizeStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const entries = Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
  return Object.fromEntries(entries);
}

function normalizeVoiceSettings(value: unknown): ElevenLabsVoiceSettings | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const settings: ElevenLabsVoiceSettings = {
    speed: asNumber(value.speed),
    stability: asNumber(value.stability),
    similarityBoost: asNumber(value.similarity_boost),
    style: asNumber(value.style),
    useSpeakerBoost: asBoolean(value.use_speaker_boost),
  };

  return Object.values(settings).some((item) => item !== undefined) ? settings : undefined;
}

function normalizeLanguage(value: unknown): ElevenLabsLanguage | null {
  if (!isRecord(value)) {
    return null;
  }

  const language = value as ElevenLabsApiLanguage;
  const languageId = asString(language.language_id);
  const name = asString(language.name);

  if (!languageId || !name) {
    return null;
  }

  return { languageId, name };
}

function normalizeModelRates(value: unknown): ElevenLabsModelRates | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const rates: ElevenLabsModelRates = {
    characterCostMultiplier: asNumber(value.character_cost_multiplier),
    costDiscountMultiplier: asNumber(value.cost_discount_multiplier),
  };

  return Object.values(rates).some((item) => item !== undefined) ? rates : undefined;
}

export function normalizeModel(value: unknown): ElevenLabsModel | null {
  if (!isRecord(value)) {
    return null;
  }

  const model = value as ElevenLabsApiModel;
  const modelId = asString(model.model_id);
  const name = asString(model.name);
  const canDoTextToSpeech = model.can_do_text_to_speech === true;

  if (!modelId || !name || !canDoTextToSpeech) {
    return null;
  }

  return {
    modelId,
    name,
    description: asString(model.description),
    canDoTextToSpeech,
    canDoVoiceConversion: asBoolean(model.can_do_voice_conversion),
    canUseStyle: model.can_use_style === true,
    canUseSpeakerBoost: model.can_use_speaker_boost === true,
    maxCharactersRequestFreeUser: asNumber(model.max_characters_request_free_user),
    maxCharactersRequestSubscribedUser: asNumber(model.max_characters_request_subscribed_user),
    maximumTextLengthPerRequest: asNumber(model.maximum_text_length_per_request),
    languages: Array.isArray(model.languages)
      ? model.languages.map(normalizeLanguage).filter((language): language is ElevenLabsLanguage => language !== null)
      : [],
    modelRates: normalizeModelRates(model.model_rates),
    concurrencyGroup: asString(model.concurrency_group),
  };
}

function normalizeVerifiedLanguage(value: unknown): ElevenLabsVerifiedLanguage | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    language: asString(value.language),
    modelId: asString(value.model_id),
    accent: asString(value.accent),
    locale: asString(value.locale),
    previewUrl: asString(value.preview_url),
  };
}

export function normalizeVoice(value: unknown): ElevenLabsVoice | null {
  if (!isRecord(value)) {
    return null;
  }

  const voice = value as ElevenLabsApiVoice;
  const voiceId = asString(voice.voice_id);
  const name = asString(voice.name);

  if (!voiceId || !name) {
    return null;
  }

  return {
    voiceId,
    name,
    category: asString(voice.category),
    description: asString(voice.description),
    previewUrl: asString(voice.preview_url),
    labels: normalizeStringRecord(voice.labels),
    settings: normalizeVoiceSettings(voice.settings),
    highQualityBaseModelIds: normalizeStringArray(voice.high_quality_base_model_ids),
    verifiedLanguages: Array.isArray(voice.verified_languages)
      ? voice.verified_languages
        .map(normalizeVerifiedLanguage)
        .filter((language): language is ElevenLabsVerifiedLanguage => language !== null)
      : [],
    availableForTiers: normalizeStringArray(voice.available_for_tiers),
    isOwner: asBoolean(voice.is_owner),
    isLegacy: asBoolean(voice.is_legacy),
    isMixed: asBoolean(voice.is_mixed),
    createdAtUnix: asNumber(voice.created_at_unix),
  };
}
