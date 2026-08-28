import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { useI18n } from '../i18n';

export function Modal({ title, children, onClose, actions, closeDisabled = false }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  closeDisabled?: boolean;
}) {
  const { t } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  const titleId = useId();
  onCloseRef.current = onClose;
  closeDisabledRef.current = closeDisabled;

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('button, input, select, textarea, [tabindex="0"]')?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !closeDisabledRef.current) onCloseRef.current();
      if (event.key !== 'Tab' || !panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')].filter((element) => !element.hasAttribute('disabled'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      openerRef.current?.focus();
    };
  }, []);

  return (
    <div className="atlas-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !closeDisabled && onClose()}>
      <div className="atlas-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef}>
        <header>
          <h2 id={titleId}>{title}</h2>
          <button className="atlas-icon-button" type="button" disabled={closeDisabled} onClick={onClose} aria-label={t('app.close')}><Icon name="close" /></button>
        </header>
        <div className="atlas-modal__body">{children}</div>
        {actions && <footer>{actions}</footer>}
      </div>
    </div>
  );
}
