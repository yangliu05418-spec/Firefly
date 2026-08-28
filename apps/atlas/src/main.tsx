import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import './firefly/styles.css';
import { FireflyAtlasApp } from './firefly/FireflyAtlasApp';
import { I18nProvider } from './firefly/i18n';
import { installChunkLoadRecovery } from './runtime/chunkLoadRecovery';

installChunkLoadRecovery();

const root = document.getElementById('root');

if (!root) {
  throw new Error('Atlas root element is missing.');
}

// StrictMode remains disabled because the original WebGPU runtime owns external
// texture lifetimes and is not safe under React's development double mount.
createRoot(root).render(
  <I18nProvider>
    <FireflyAtlasApp />
  </I18nProvider>,
);
