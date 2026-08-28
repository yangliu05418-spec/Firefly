import { lazy, Suspense } from 'react';
import { useFireflyEmbedding } from '../../../../firefly/FireflyEmbeddingContext';
import { FireflyMediaGenerationTray } from '../FireflyMediaGenerationTray';

const LegacyMediaAIGenerativeTray = import.meta.env.VITE_APP_VARIANT === 'firefly'
  ? null
  : lazy(() => import('../MediaAIGenerativeTray').then((module) => ({ default: module.MediaAIGenerativeTray })));

export interface MediaGenerationTrayMountProps {
  suppressed: boolean;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}

export function MediaGenerationTrayMount({
  suppressed,
  expanded,
  onExpandedChange,
}: MediaGenerationTrayMountProps) {
  const firefly = useFireflyEmbedding();
  if (suppressed) return null;

  if (firefly) return <FireflyMediaGenerationTray expanded={expanded} onExpandedChange={onExpandedChange} />;

  return (
    LegacyMediaAIGenerativeTray
      ? <Suspense fallback={null}><LegacyMediaAIGenerativeTray expanded={expanded} onExpandedChange={onExpandedChange} /></Suspense>
      : null
  );
}
