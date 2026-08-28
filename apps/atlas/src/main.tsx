import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/base.css';
import RootApp from './RootApp.tsx';
import { resolveEntryExperience } from './routing/entryExperience';
import { installChunkLoadRecovery } from './runtime/chunkLoadRecovery';

installChunkLoadRecovery();

const initialExperience = resolveEntryExperience(window.location);

if (initialExperience === 'editor' || initialExperience === 'landing') {
  void import('./editorBoot');
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Atlas root element is missing.');
}

// StrictMode remains disabled because the original WebGPU runtime owns external
// texture lifetimes and is not safe under React's development double mount.
createRoot(root).render(<RootApp initialExperience={initialExperience} />);
