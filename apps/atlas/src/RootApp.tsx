import { lazy, Suspense, type CSSProperties } from 'react';
import { LegalDialog } from './components/common/LegalDialog';
import type { FireflyEmbeddedToolbarContext } from './components/common/Toolbar';
import type { EntryExperience } from './routing/entryExperience';

const EditorApp = lazy(() => import('./App'));
const AdminPage = lazy(() =>
  import('./admin/AdminPage').then((module) => ({ default: module.AdminPage }))
);
const CreditClaimPage = lazy(() =>
  import('./creditClaims/CreditClaimPage').then((module) => ({ default: module.CreditClaimPage }))
);

export interface RootAppProps {
  initialExperience: EntryExperience;
  fireflyEmbedded?: FireflyEmbeddedToolbarContext;
}

const loadingShellStyle: CSSProperties = {
  alignItems: 'center',
  background: 'linear-gradient(135deg, #101215 0%, #1c222a 100%)',
  color: '#f5f7fa',
  display: 'flex',
  fontFamily: '"Segoe UI", sans-serif',
  fontSize: '16px',
  height: '100%',
  justifyContent: 'center',
  width: '100%',
};

export function RootApp({ initialExperience, fireflyEmbedded }: RootAppProps) {
  // Firefly owns authentication, project routing, and commercial concerns. An
  // embedded editor must therefore always enter the proven editor runtime
  // directly, regardless of any legacy MasterSelects route encoded in the URL.
  if (fireflyEmbedded) {
    return (
      <Suspense fallback={<div style={loadingShellStyle}>正在打开 Atlas…</div>}>
        <EditorApp fireflyEmbedded={fireflyEmbedded} />
      </Suspense>
    );
  }

  if (initialExperience === 'admin') {
    return (
      <Suspense fallback={<div style={loadingShellStyle}>Opening secure operations...</div>}>
        <AdminPage />
      </Suspense>
    );
  }

  if (initialExperience === 'imprint' || initialExperience === 'privacy') {
    const legalPath = window.location.pathname.replace(/\/$/, '');
    return (
      <LegalDialog
        initialLang={legalPath === '/imprint' || legalPath === '/privacy' ? 'en' : 'de'}
        initialPage={initialExperience}
        onClose={() => window.location.assign('/')}
      />
    );
  }

  if (initialExperience === 'creditClaim') {
    return (
      <Suspense fallback={<div style={loadingShellStyle}>Opening credit claim...</div>}>
        <CreditClaimPage />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<div style={loadingShellStyle}>Opening MasterSelects...</div>}>
      <EditorApp />
    </Suspense>
  );
}

export default RootApp;
