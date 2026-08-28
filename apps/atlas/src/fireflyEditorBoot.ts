import { ensureMetronomeScheduler } from './services/audio/metronomeScheduler';
import { installRuntimeDiagnostics } from './services/runtimeDiagnostics';

/**
 * Firefly embeds the original Atlas editor runtime but owns authentication,
 * project storage and Agent orchestration. Keep the editor's media services and
 * diagnostics while deliberately excluding the legacy Native Helper and
 * commercial/console Agent bootstrap from this hosted boundary.
 */
installRuntimeDiagnostics();
ensureMetronomeScheduler();
