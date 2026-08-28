import type { ClipMask } from "../../../../types/masks";
import { MaskItem } from './MaskItem';

interface MaskListProps {
  activeMaskId: string | null;
  clipId: string;
  maskList: ClipMask[];
  onSelectMask: (maskId: string) => void;
}

export function MaskList({ activeMaskId, clipId, maskList, onSelectMask }: MaskListProps) {
  if (maskList.length === 0) {
    return <div className="mask-empty">No masks</div>;
  }

  return (
    <div className="mask-list">
      {maskList.map((mask, index) => (
        <MaskItem
          key={mask.id}
          clipId={clipId}
          mask={mask}
          index={index}
          count={maskList.length}
          isActive={activeMaskId === mask.id}
          onSelect={() => onSelectMask(mask.id)}
        />
      ))}
    </div>
  );
}
