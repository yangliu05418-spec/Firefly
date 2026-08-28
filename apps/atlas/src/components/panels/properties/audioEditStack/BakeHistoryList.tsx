import type { AudioDerivedAssetRef } from '../../../../types/audio';

interface BakeHistoryListProps {
  bakeHistory: AudioDerivedAssetRef[];
}

export function BakeHistoryList({ bakeHistory }: BakeHistoryListProps) {
  if (bakeHistory.length === 0) return null;

  return (
    <div className="audio-edit-bake-history">
      <h4>Bakes</h4>
      {bakeHistory.slice().reverse().map((entry) => (
        <div key={entry.id} className="audio-edit-bake-row">
          <span>{new Date(entry.createdAt).toLocaleString()}</span>
          <strong>{entry.operationIds.length} ops</strong>
        </div>
      ))}
    </div>
  );
}
