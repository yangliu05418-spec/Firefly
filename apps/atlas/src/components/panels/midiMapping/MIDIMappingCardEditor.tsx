// Channel/note/marker draft editor rendered inside an expanded MIDI
// mapping card, including draft clamping and binding save logic.

import type { Dispatch, SetStateAction, SyntheticEvent } from 'react';
import {
  moveMarkerMIDIBinding,
  setMarkerMIDIBinding,
  setSlotMIDIBinding,
  setTransportMIDIBinding,
} from '../../../services/midi/midiBindingMutations';
import {
  getMarkerTargetLabel,
  type MIDIMappingSummaryEntry,
} from '../../../services/midi/midiMappingSummary';
import {
  getMIDINoteName,
  type MarkerMIDIAction,
  type MIDITransportAction,
} from '../../../types/midi';
import type { TimelineMarker } from '../../../stores/timeline/types';

export interface MIDIMappingDraft {
  mappingId: string;
  channel: string;
  note: string;
  markerId?: string;
}

function clampInteger(value: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

const stopEventPropagation = (event: SyntheticEvent) => {
  event.stopPropagation();
};

interface MIDIMappingCardEditorProps {
  mapping: MIDIMappingSummaryEntry;
  markers: TimelineMarker[];
  draft: MIDIMappingDraft;
  setDraft: Dispatch<SetStateAction<MIDIMappingDraft | null>>;
  isLearningCurrentMapping: boolean;
  onPreview: () => void;
  onLearn: () => void;
  onClear: () => void;
  onClose: () => void;
}

export function MIDIMappingCardEditor({
  mapping,
  markers,
  draft,
  setDraft,
  isLearningCurrentMapping,
  onPreview,
  onLearn,
  onClear,
  onClose,
}: MIDIMappingCardEditorProps) {
  const isParameterMapping = mapping.scope === 'parameter';
  const channelValue = draft.channel;
  const noteValue = !isParameterMapping
    ? draft.note
    : 'note' in mapping.binding
      ? String(mapping.binding.note)
      : '';
  const selectedMarkerId = draft.markerId ?? mapping.markerId;
  const notePreview = 'note' in mapping.binding
    ? getMIDINoteName(clampInteger(noteValue, mapping.binding.note, 0, 127))
    : '';

  const saveDraft = () => {
    if (draft.mappingId !== mapping.id) {
      return;
    }

    if (mapping.scope === 'parameter' || !('note' in mapping.binding)) {
      onClose();
      return;
    }

    const nextBinding = {
      channel: clampInteger(draft.channel, mapping.binding.channel, 1, 16),
      note: clampInteger(draft.note, mapping.binding.note, 0, 127),
    };

    if (mapping.scope === 'transport') {
      setTransportMIDIBinding(mapping.action as MIDITransportAction, nextBinding);
      onClose();
      return;
    }

    if (mapping.scope === 'slot') {
      if (mapping.slotIndex !== undefined) {
        setSlotMIDIBinding(mapping.slotIndex, nextBinding);
      }
      onClose();
      return;
    }

    const nextMarkerId = draft.markerId ?? mapping.markerId;
    if (!nextMarkerId || !mapping.markerId) {
      return;
    }

    if (nextMarkerId !== mapping.markerId) {
      moveMarkerMIDIBinding({
        fromMarkerId: mapping.markerId,
        toMarkerId: nextMarkerId,
        action: mapping.action as MarkerMIDIAction,
        binding: nextBinding,
      });
    } else {
      setMarkerMIDIBinding(nextMarkerId, mapping.action as MarkerMIDIAction, nextBinding);
    }

    onClose();
  };

  return (
    <div
      className="midi-mapping-editor"
      onClick={stopEventPropagation}
      onKeyDown={stopEventPropagation}
    >
      <div className="midi-mapping-editor-grid">
        <label className="midi-mapping-field">
          <span>Channel</span>
          <input
            type="number"
            min={1}
            max={16}
            value={channelValue}
            onChange={(event) => {
              const value = event.target.value;
              setDraft((currentDraft) => currentDraft && currentDraft.mappingId === mapping.id
                ? { ...currentDraft, channel: value }
                : currentDraft
              );
            }}
          />
        </label>

        <label className="midi-mapping-field">
          <span>Note</span>
          <input
            type="number"
            min={0}
            max={127}
            value={noteValue}
            onChange={(event) => {
              const value = event.target.value;
              setDraft((currentDraft) => currentDraft && currentDraft.mappingId === mapping.id
                ? { ...currentDraft, note: value }
                : currentDraft
              );
            }}
          />
          <small>{notePreview}</small>
        </label>

        {mapping.scope === 'marker' && (
          <label className="midi-mapping-field midi-mapping-field-wide">
            <span>Marker</span>
            <select
              value={selectedMarkerId ?? ''}
              onChange={(event) => {
                const value = event.target.value;
                setDraft((currentDraft) => currentDraft && currentDraft.mappingId === mapping.id
                  ? { ...currentDraft, markerId: value }
                  : currentDraft
                );
              }}
            >
              {markers.map((marker) => (
                <option key={marker.id} value={marker.id}>
                  {getMarkerTargetLabel(marker)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="midi-mapping-editor-actions">
        <button className="settings-button" onClick={saveDraft}>
          Save
        </button>
        <button className="settings-button" onClick={onPreview}>
          Trigger
        </button>
        <button className="settings-button" onClick={onLearn}>
          {isLearningCurrentMapping ? 'Listening...' : 'Learn'}
        </button>
        <button className="settings-button" onClick={onClear}>
          Clear
        </button>
        <button className="settings-button" onClick={onClose}>
          Cancel
        </button>
      </div>

      <p className="midi-mapping-editor-hint">
        Notes stay unique across transport and marker mappings. Saving or learning here replaces any existing assignment using the same channel and note.
      </p>
    </div>
  );
}
