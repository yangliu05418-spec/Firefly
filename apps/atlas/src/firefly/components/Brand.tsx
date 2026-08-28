import { Icon } from './Icon';

export function AtlasBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`atlas-brand${compact ? ' atlas-brand--compact' : ''}`} aria-label="Firefly Atlas">
      <span className="atlas-brand__mark"><Icon name="atlas" /></span>
      <span className="atlas-brand__words"><strong>Atlas</strong><small>by Firefly</small></span>
    </span>
  );
}
