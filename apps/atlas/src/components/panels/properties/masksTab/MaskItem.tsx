import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';

import { useTimelineStore } from '../../../../stores/timeline';
import type { ClipMask } from "../../../../types/masks";
import { IconButton } from './IconButton';
import { MASK_OUTLINE_COLORS } from './maskTabConstants';
import { getColorInputValue } from './maskPathMapping';

interface MaskItemProps {
  clipId: string;
  count: number;
  index: number;
  isActive: boolean;
  mask: ClipMask;
  onSelect: () => void;
}

export function MaskItem({ clipId, mask, index, count, isActive, onSelect }: MaskItemProps) {
  const { updateMask, removeMask, reorderMasks, setActiveMask, setMaskEditMode } = useTimelineStore.getState();
  const itemRef = useRef<HTMLDivElement>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(mask.name);
  const [colorMenuOpen, setColorMenuOpen] = useState(false);
  const outlineColor = getColorInputValue(mask.outlineColor);

  useEffect(() => {
    if (!colorMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (itemRef.current?.contains(event.target as Node)) return;
      setColorMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setColorMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [colorMenuOpen]);

  useEffect(() => {
    setColorMenuOpen(false);
  }, [mask.id]);

  const commitName = () => {
    const nextName = editName.trim();
    if (nextName) updateMask(clipId, mask.id, { name: nextName });
    setIsEditing(false);
  };

  const selectForEditing = () => {
    onSelect();
    setActiveMask(clipId, mask.id);
    setMaskEditMode('editing');
  };

  const openColorMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    setActiveMask(clipId, mask.id);
    setColorMenuOpen(true);
  };

  const setOutlineColor = (color: string) => {
    updateMask(clipId, mask.id, { outlineColor: color });
  };

  return (
    <div
      ref={itemRef}
      className={`mask-item ${isActive ? 'active' : ''} ${mask.expanded ? 'expanded' : ''} ${mask.enabled === false ? 'disabled' : ''} ${colorMenuOpen ? 'color-menu-open' : ''}`}
    >
      <div className="mask-item-header" onClick={onSelect} onContextMenu={openColorMenu}>
        <IconButton
          icon="chevron"
          title={mask.expanded ? 'Collapse mask' : 'Expand mask'}
          className={mask.expanded ? 'expanded' : ''}
          onClick={(event) => {
            event.stopPropagation();
            updateMask(clipId, mask.id, { expanded: !mask.expanded });
          }}
        />

        <button
          type="button"
          className="mask-outline-swatch"
          title="Mask outline color"
          aria-haspopup="menu"
          aria-expanded={colorMenuOpen}
          style={{ backgroundColor: outlineColor }}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
            setActiveMask(clipId, mask.id);
            setColorMenuOpen(open => !open);
          }}
          onContextMenu={openColorMenu}
        />

        {isEditing ? (
          <input
            type="text"
            className="mask-name-input"
            value={editName}
            onChange={(event) => setEditName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitName();
              if (event.key === 'Escape') setIsEditing(false);
            }}
            autoFocus
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <button
            type="button"
            className="mask-name"
            onDoubleClick={() => {
              setEditName(mask.name);
              setIsEditing(true);
            }}
            onClick={(event) => {
              event.stopPropagation();
              selectForEditing();
            }}
          >
            <span>{mask.name}</span>
            <small>{mask.vertices.length} pts</small>
          </button>
        )}

        <div className="mask-item-actions">
          <IconButton
            icon="power"
            title={mask.enabled === false ? 'Enable mask render' : 'Disable mask render'}
            active={mask.enabled !== false}
            onClick={(event) => {
              event.stopPropagation();
              updateMask(clipId, mask.id, { enabled: mask.enabled === false });
            }}
          />
          <IconButton
            icon={mask.visible ? 'eye' : 'eyeOff'}
            title={mask.visible ? 'Hide mask outline' : 'Show mask outline'}
            active={mask.visible}
            onClick={(event) => {
              event.stopPropagation();
              updateMask(clipId, mask.id, { visible: !mask.visible });
            }}
          />
          <IconButton
            icon="edit"
            title="Edit mask path"
            active={isActive}
            onClick={(event) => {
              event.stopPropagation();
              selectForEditing();
            }}
          />
          <IconButton
            icon="up"
            title="Move mask up"
            disabled={index === 0}
            onClick={(event) => {
              event.stopPropagation();
              reorderMasks(clipId, index, Math.max(0, index - 1));
            }}
          />
          <IconButton
            icon="down"
            title="Move mask down"
            disabled={index >= count - 1}
            onClick={(event) => {
              event.stopPropagation();
              reorderMasks(clipId, index, Math.min(count - 1, index + 1));
            }}
          />
          <IconButton
            icon="trash"
            title="Delete mask"
            className="danger"
            onClick={(event) => {
              event.stopPropagation();
              removeMask(clipId, mask.id);
            }}
          />
        </div>
      </div>
      {colorMenuOpen && (
        <div
          className="mask-outline-color-menu"
          role="menu"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {MASK_OUTLINE_COLORS.map(color => (
            <button
              type="button"
              key={color}
              className={`mask-outline-color-option ${color.toLowerCase() === outlineColor.toLowerCase() ? 'active' : ''}`}
              style={{ backgroundColor: color }}
              title={`Outline ${color}`}
              aria-label={`Set outline color ${color}`}
              role="menuitem"
              onClick={() => {
                setOutlineColor(color);
                setColorMenuOpen(false);
              }}
            />
          ))}
          <input
            className="mask-outline-color-input"
            type="color"
            title="Custom outline color"
            aria-label="Custom outline color"
            value={outlineColor}
            onChange={(event) => setOutlineColor(event.target.value)}
          />
        </div>
      )}
    </div>
  );
}
