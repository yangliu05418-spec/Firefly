import { getShortcutRegistry } from '../../../services/shortcutRegistry';
import type { ToolbarShortcutLabels } from './menuTypes';

export function getToolbarShortcutLabels(): ToolbarShortcutLabels {
  const registry = getShortcutRegistry();
  return {
    new: registry.getLabel('project.new'),
    open: registry.getLabel('project.open'),
    save: registry.getLabel('project.save'),
    saveAs: registry.getLabel('project.saveAs'),
    copy: registry.getLabel('edit.copy'),
    paste: registry.getLabel('edit.paste'),
  };
}
