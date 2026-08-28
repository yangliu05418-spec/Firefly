import {
  SCOPE_PANEL_TYPES,
  WIP_PANEL_TYPES,
  type PanelType,
  type SavedDockLayout,
} from '../../../types/dock';
import type { ToolbarMenuController } from './menuTypes';
import {
  getViewPanelConfig,
  VIEW_AI_PANEL_TYPES,
  VIEW_CORE_PANEL_TYPES,
  VIEW_WIP_ONLY_PANEL_TYPES,
} from './viewPanelConfig';
import { localizePanelTitle } from '../../../firefly/i18n/panelLabels';

interface ViewMenuProps extends ToolbarMenuController {
  fireflyEmbedded?: boolean;
  activeSavedLayout: SavedDockLayout | null;
  activeSavedLayoutId: string | null;
  activeSavedLayoutProtected: boolean;
  canEditFactoryDockLayouts: boolean;
  defaultSavedLayoutId: string | null;
  isPanelTypeVisible: (type: PanelType) => boolean;
  sortedSavedLayouts: SavedDockLayout[];
  onLoadDefaultLayout: () => void;
  onLoadSavedLayout: (layoutId: string) => void;
  onSaveCurrentLayout: () => void;
  onSaveCurrentNamedLayout: () => void;
  onSaveNamedLayout: () => void;
  onSetDefaultSavedLayout: (layoutId: string) => void;
  onToggleFavoriteSavedLayout: (layoutId: string) => void;
  onToggleViewPanelType: (type: PanelType) => void;
}

function getLayoutHint(
  savedLayout: SavedDockLayout,
  activeSavedLayoutId: string | null,
  defaultSavedLayoutId: string | null,
  canEditFactoryDockLayouts: boolean,
  fireflyEmbedded: boolean,
): string {
  const isActiveLayout = savedLayout.id === activeSavedLayoutId;
  const isDefaultLayout = savedLayout.id === defaultSavedLayoutId;
  const isBuiltInLayout = savedLayout.factory === true;

  return [
    isActiveLayout ? (fireflyEmbedded ? '当前' : 'Current') : null,
    isDefaultLayout ? (fireflyEmbedded ? '默认' : 'Default') : null,
    isBuiltInLayout && !canEditFactoryDockLayouts ? (fireflyEmbedded ? '内置' : 'Built-in') : null,
  ].filter(Boolean).join(' / ');
}

interface PanelOptionProps {
  type: PanelType;
  checked?: boolean;
  disabled?: boolean;
  wip?: boolean;
  onToggle?: (type: PanelType) => void;
}

function PanelOption({
  checked = false,
  disabled = false,
  onToggle,
  type,
  wip = false,
}: PanelOptionProps) {
  const config = getViewPanelConfig(type);
  return (
    <button
      className={`menu-option ${wip ? 'menu-option-wip' : ''} ${checked ? 'checked' : ''}`}
      onClick={disabled ? undefined : () => onToggle?.(type)}
      disabled={disabled}
    >
      <span>{checked ? '\u2713 ' : '   '}{localizePanelTitle(type, config.title)}</span>
      {wip && <span className="menu-wip-badge">{'\u{1f41b}'}</span>}
    </button>
  );
}

export function ViewMenu({
  fireflyEmbedded = false,
  activeSavedLayout,
  activeSavedLayoutId,
  activeSavedLayoutProtected,
  canEditFactoryDockLayouts,
  defaultSavedLayoutId,
  isPanelTypeVisible,
  onLoadDefaultLayout,
  onLoadSavedLayout,
  onMenuClick,
  onMenuHover,
  onSaveCurrentLayout,
  onSaveCurrentNamedLayout,
  onSaveNamedLayout,
  onSetDefaultSavedLayout,
  onToggleFavoriteSavedLayout,
  onToggleViewPanelType,
  openMenu,
  sortedSavedLayouts,
}: ViewMenuProps) {
  return (
    <div className="menu-item">
      <button
        className={`menu-trigger ${openMenu === 'view' ? 'active' : ''}`}
        onClick={() => onMenuClick('view')}
        onMouseEnter={() => onMenuHover('view')}
      >
        {fireflyEmbedded ? '视图' : 'View'}
      </button>
      {openMenu === 'view' && (
        <div className="menu-dropdown menu-dropdown-wide">
          <div className="menu-item-with-submenu">
            <button className="menu-option">
              <span>{fireflyEmbedded ? '面板' : 'Panels'}</span>
            </button>
            <div className="menu-nested-submenu menu-nested-submenu-panels">
              <span className="menu-sublabel">{fireflyEmbedded ? '核心' : 'Core'}</span>
              {VIEW_CORE_PANEL_TYPES.map((type) => (
                <PanelOption
                  key={type}
                  type={type}
                  checked={isPanelTypeVisible(type)}
                  onToggle={onToggleViewPanelType}
                />
              ))}

              <div className="menu-separator" />
              <span className="menu-sublabel">AI</span>
              {VIEW_AI_PANEL_TYPES.map((type) => {
                const isWip = WIP_PANEL_TYPES.includes(type);
                return (
                  <PanelOption
                    key={type}
                    type={type}
                    checked={isPanelTypeVisible(type)}
                    disabled={isWip}
                    wip={isWip}
                    onToggle={onToggleViewPanelType}
                  />
                );
              })}

              <div className="menu-separator" />
              <span className="menu-sublabel">{fireflyEmbedded ? '示波器' : 'Scopes'}</span>
              {SCOPE_PANEL_TYPES.map((type) => (
                <PanelOption
                  key={type}
                  type={type}
                  checked={isPanelTypeVisible(type)}
                  onToggle={onToggleViewPanelType}
                />
              ))}

              {VIEW_WIP_ONLY_PANEL_TYPES.length > 0 && (
                <>
                  <div className="menu-separator" />
                  <span className="menu-sublabel">Work in Progress</span>
                  {VIEW_WIP_ONLY_PANEL_TYPES.map((type) => (
                    <PanelOption key={type} type={type} disabled wip />
                  ))}
                </>
              )}
            </div>
          </div>
          <div className="menu-separator" />
          <div className="menu-item-with-submenu">
            <button className="menu-option">
              <span>{fireflyEmbedded ? '布局' : 'Layouts'}</span>
            </button>
            <div className="menu-nested-submenu menu-nested-submenu-layouts">
              <button className="menu-option" onClick={onSaveNamedLayout}>
                <span>{fireflyEmbedded ? '将当前布局另存为…' : 'Save Current Layout...'}</span>
              </button>
              <button
                className="menu-option"
                onClick={onSaveCurrentNamedLayout}
                disabled={!activeSavedLayout || activeSavedLayoutProtected}
                title={
                  activeSavedLayoutProtected
                    ? (fireflyEmbedded ? '内置布局不可覆盖' : 'Built-in layouts can only be edited on the dev server')
                    : activeSavedLayout
                      ? (fireflyEmbedded ? `覆盖 ${activeSavedLayout.name}` : `Overwrite ${activeSavedLayout.name}`)
                      : (fireflyEmbedded ? '请先载入或保存一个命名布局' : 'Load or save a named layout first')
                }
              >
                <span>{fireflyEmbedded ? '保存到当前布局' : 'Save to Current Layout'}</span>
                {activeSavedLayout && <span className="menu-hint">{activeSavedLayout.name}</span>}
              </button>
              <button className="menu-option" onClick={onSaveCurrentLayout}>
                <span>{fireflyEmbedded ? '设为默认布局' : 'Set Current as Default'}</span>
              </button>
              <button className="menu-option" onClick={onLoadDefaultLayout}>
                <span>{fireflyEmbedded ? '载入默认布局' : 'Load Default Layout'}</span>
              </button>
              <div className="menu-separator" />
              <span className="menu-sublabel">{fireflyEmbedded ? '已保存布局' : 'Saved Layouts'}</span>
              {sortedSavedLayouts.length === 0 ? (
                <span className="menu-empty">{fireflyEmbedded ? '暂无已保存布局' : 'No saved layouts'}</span>
              ) : (
                sortedSavedLayouts.map((savedLayout) => {
                  const isDefaultLayout = savedLayout.id === defaultSavedLayoutId;
                  const isActiveLayout = savedLayout.id === activeSavedLayoutId;
                  const isFavoriteLayout = savedLayout.favorite === true;
                  const layoutHint = getLayoutHint(
                    savedLayout,
                    activeSavedLayoutId,
                    defaultSavedLayoutId,
                    canEditFactoryDockLayouts,
                    fireflyEmbedded,
                  );
                  return (
                    <div key={savedLayout.id} className="menu-layout-row">
                      <button
                        className={`menu-layout-favorite-btn ${isFavoriteLayout ? 'active' : ''}`}
                        onClick={() => onToggleFavoriteSavedLayout(savedLayout.id)}
                        title={isFavoriteLayout
                          ? (fireflyEmbedded ? '从顶部快捷切换中移除' : 'Remove from header switcher')
                          : (fireflyEmbedded ? '显示在顶部快捷切换中' : 'Show in header switcher')}
                        type="button"
                        aria-label={`${isFavoriteLayout ? (fireflyEmbedded ? '取消收藏' : 'Unfavorite') : (fireflyEmbedded ? '收藏' : 'Favorite')} ${savedLayout.name}`}
                      >
                        {isFavoriteLayout ? '\u2605' : '\u2606'}
                      </button>
                      <button
                        className={`menu-option menu-layout-load ${isDefaultLayout ? 'checked' : ''} ${isActiveLayout ? 'current' : ''}`}
                        onClick={() => onLoadSavedLayout(savedLayout.id)}
                        title={savedLayout.name}
                      >
                        <span className="menu-layout-name">{savedLayout.name}</span>
                        {layoutHint && <span className="menu-hint">{layoutHint}</span>}
                      </button>
                      <button
                        className={`menu-layout-default-btn ${isDefaultLayout ? 'active' : ''}`}
                        onClick={() => onSetDefaultSavedLayout(savedLayout.id)}
                        title={isDefaultLayout
                          ? (fireflyEmbedded ? '默认布局' : 'Default layout')
                          : (fireflyEmbedded ? '设为默认' : 'Set as default')}
                        type="button"
                      >
                        {isDefaultLayout ? (fireflyEmbedded ? '默认' : 'Default') : (fireflyEmbedded ? '设为默认' : 'Set')}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
