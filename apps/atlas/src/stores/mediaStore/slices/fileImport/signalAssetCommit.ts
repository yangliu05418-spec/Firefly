import type { MediaState, SignalAssetItem } from '../../types';
import { mergeSignalArtifacts } from '../../helpers/signalItems';

type MediaSliceSet = (
  partial: Partial<MediaState> | ((state: MediaState) => Partial<MediaState>)
) => void;

export function commitSignalAsset(set: MediaSliceSet, signalAsset: SignalAssetItem): void {
  set((state) => ({
    signalAssets: [
      ...state.signalAssets.filter((item) => item.id !== signalAsset.id),
      signalAsset,
    ],
    signalArtifacts: mergeSignalArtifacts(state.signalArtifacts, signalAsset.artifacts),
  }));
}
