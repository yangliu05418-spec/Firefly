import { createRoot } from 'react-dom/client';
import { FireflyAtlasApp } from './firefly/FireflyAtlasApp';
import { I18nProvider } from './firefly/i18n';
import './firefly/styles.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Atlas root element is missing.');
}

createRoot(root).render(
  <I18nProvider>
    <FireflyAtlasApp />
  </I18nProvider>,
);
