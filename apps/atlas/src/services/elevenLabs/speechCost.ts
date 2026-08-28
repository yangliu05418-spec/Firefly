import type { ElevenLabsModelRates, HostedElevenLabsSpeechCostEstimate } from './apiContracts';
import {
  ELEVENLABS_PROVIDER_USD_PER_CREDIT,
  MASTERSELECTS_HOSTED_USD_PER_CREDIT,
} from './config';

export function isFlashOrTurboElevenLabsModel(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  return normalized.includes('flash') || normalized.includes('turbo');
}

export function getElevenLabsModelCharacterCostMultiplier(
  modelId: string,
  modelRates?: ElevenLabsModelRates | null,
): number {
  const explicitMultiplier = modelRates?.characterCostMultiplier;
  if (typeof explicitMultiplier === 'number' && Number.isFinite(explicitMultiplier) && explicitMultiplier > 0) {
    return explicitMultiplier;
  }

  return isFlashOrTurboElevenLabsModel(modelId) ? 0.5 : 1;
}

export function calculateHostedElevenLabsCredits(providerCredits: number): number {
  if (!Number.isFinite(providerCredits) || providerCredits <= 0) {
    return 0;
  }

  return Math.max(
    1,
    Math.ceil((providerCredits * ELEVENLABS_PROVIDER_USD_PER_CREDIT) / MASTERSELECTS_HOSTED_USD_PER_CREDIT),
  );
}

export function estimateHostedElevenLabsSpeechCredits(
  text: string,
  modelId: string,
  modelRates?: ElevenLabsModelRates | null,
): HostedElevenLabsSpeechCostEstimate {
  const textCharacters = text.length;
  const modelMultiplier = getElevenLabsModelCharacterCostMultiplier(modelId, modelRates);
  const providerCredits = Math.ceil(textCharacters * modelMultiplier);
  const creditsRequired = calculateHostedElevenLabsCredits(providerCredits);

  return {
    creditsRequired,
    modelMultiplier,
    providerCredits,
    textCharacters,
    usdEstimate: providerCredits * ELEVENLABS_PROVIDER_USD_PER_CREDIT,
  };
}
