import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type SyntheticEvent,
} from 'react';
import { useMIDI } from '../../hooks/useMIDI';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import {
  collectMIDIMappingSummary,
  getSlotGridLabel,
  type MIDIMappingSummaryEntry,
  type MIDISlotTarget,
} from '../../services/midi/midiMappingSummary';
import {
  setMarkerMIDIBinding,
  setParameterMIDIBinding,
  setSlotMIDIBinding,
  setTransportMIDIBinding,
  startLearningParameterMIDIBinding,
} from '../../services/midi/midiBindingMutations';
import {
  triggerMIDITransportAction,
  triggerMarkerMIDIAction,
  triggerSlotMIDIAction,
} from '../../services/midi/midiCommands';
import {
  describeMIDILearnTarget,
  type MarkerMIDIAction,
  type MIDITransportAction,
} from '../../types/midi';
import {
  MIDIMappingCardEditor,
  type MIDIMappingDraft,
} from './midiMapping/MIDIMappingCardEditor';
import { MIDIMappingParameterControls } from './midiMapping/MIDIMappingParameterControls';
import { useParameterRangeDrafts } from './midiMapping/useParameterRangeDrafts';
import './MIDIMappingPanel.css';

function MIDIMappingEmptyState({ isEnabled }: { isEnabled: boolean }) {
  return (
    <div className="midi-mapping-empty">
      <p>No MIDI mappings assigned yet.</p>
      <p>
        Add transport bindings in Settings / MIDI, marker bindings from the timeline marker menu, slot bindings from the Slot Grid menu, or parameter bindings from property labels.
      </p>
      {!isEnabled && (
        <p className="midi-mapping-empty-muted">
          MIDI is currently disabled. Enable it in Settings before learning new notes.
        </p>
      )}
    </div>
  );
}

export function MIDIMappingPanel() {
  const {
    transportBindings,
    isEnabled,
    connectionStatus,
    devices,
    learnTarget,
    startLearningTransportBinding,
    startLearningMarkerBinding,
    startLearningSlotBinding,
    cancelLearning,
    slotBindings,
    parameterBindings,
    activeMappingIds,
  } = useMIDI();
  const markers = useTimelineStore((state) => state.markers);
  const compositions = useMediaStore((state) => state.compositions);
  const slotAssignments = useMediaStore((state) => state.slotAssignments);
  const [draft, setDraft] = useState<MIDIMappingDraft | null>(null);
  const parameterRangeControls = useParameterRangeDrafts();
  const [previewingMappingId, setPreviewingMappingId] = useState<string | null>(null);
  const previewResetTimeoutRef = useRef<number | null>(null);

  const slotTargets = useMemo<MIDISlotTarget[]>(() => {
    const targets = new Map<number, MIDISlotTarget>();

    for (const [slotKey] of Object.entries(slotBindings)) {
      const slotIndex = Number(slotKey);
      if (Number.isInteger(slotIndex) && slotIndex >= 0) {
        targets.set(slotIndex, {
          slotIndex,
          label: getSlotGridLabel(slotIndex),
        });
      }
    }

    for (const [compositionId, slotIndex] of Object.entries(slotAssignments)) {
      if (!Number.isInteger(slotIndex) || slotIndex < 0) {
        continue;
      }

      const composition = compositions.find((candidate) => candidate.id === compositionId);
      targets.set(slotIndex, {
        slotIndex,
        label: getSlotGridLabel(slotIndex),
        compositionName: composition?.name,
      });
    }

    return Array.from(targets.values());
  }, [compositions, slotAssignments, slotBindings]);

  const mappings = useMemo(
    () => collectMIDIMappingSummary(transportBindings, markers, slotBindings, slotTargets, parameterBindings),
    [markers, parameterBindings, slotBindings, slotTargets, transportBindings]
  );
  const learnDescription = describeMIDILearnTarget(learnTarget);
  const pendingSlotLearnTarget = learnTarget?.kind === 'slot' ? learnTarget : null;
  const shouldShowPendingSlotCard = !!pendingSlotLearnTarget && !mappings.some((mapping) => (
    mapping.scope === 'slot' && mapping.slotIndex === pendingSlotLearnTarget.slotIndex
  ));

  useEffect(() => () => {
    if (previewResetTimeoutRef.current !== null) {
      window.clearTimeout(previewResetTimeoutRef.current);
    }
  }, []);

  const stopEventPropagation = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  const flashPreviewState = (mappingId: string) => {
    if (previewResetTimeoutRef.current !== null) {
      window.clearTimeout(previewResetTimeoutRef.current);
    }

    setPreviewingMappingId(mappingId);
    previewResetTimeoutRef.current = window.setTimeout(() => {
      setPreviewingMappingId((current) => (current === mappingId ? null : current));
      previewResetTimeoutRef.current = null;
    }, 900);
  };

  const resolvePreviewMarkerTime = (mapping: MIDIMappingSummaryEntry): number | undefined => {
    if (mapping.scope !== 'marker') {
      return undefined;
    }

    if (draft?.mappingId === mapping.id) {
      const draftMarkerId = draft.markerId ?? mapping.markerId;
      return markers.find((marker) => marker.id === draftMarkerId)?.time;
    }

    return mapping.markerTime;
  };

  const previewMapping = (mapping: MIDIMappingSummaryEntry) => {
    if (mapping.scope === 'parameter') {
      return;
    }

    flashPreviewState(mapping.id);

    if (mapping.scope === 'transport') {
      void triggerMIDITransportAction(mapping.action as MIDITransportAction);
      return;
    }

    if (mapping.scope === 'slot' && mapping.slotIndex !== undefined) {
      void triggerSlotMIDIAction(mapping.slotIndex);
      return;
    }

    const previewMarkerTime = resolvePreviewMarkerTime(mapping);
    if (previewMarkerTime === undefined) {
      return;
    }

    void triggerMarkerMIDIAction(mapping.action as MarkerMIDIAction, previewMarkerTime);
  };

  const handleMappingCardKeyDown = (
    event: ReactKeyboardEvent<HTMLDivElement>,
    mapping: MIDIMappingSummaryEntry
  ) => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    previewMapping(mapping);
  };

  const openEditor = (mapping: MIDIMappingSummaryEntry) => {
    if (mapping.scope === 'parameter' || !('note' in mapping.binding)) {
      return;
    }

    setDraft({
      mappingId: mapping.id,
      channel: String(mapping.binding.channel),
      note: String(mapping.binding.note),
      markerId: mapping.markerId,
    });
  };

  const closeEditor = () => {
    setDraft(null);
  };

  const clearMapping = (mapping: MIDIMappingSummaryEntry) => {
    if (mapping.scope === 'transport') {
      setTransportMIDIBinding(mapping.action as MIDITransportAction, null);
    } else if (mapping.scope === 'slot' && mapping.slotIndex !== undefined) {
      setSlotMIDIBinding(mapping.slotIndex, null);
    } else if (mapping.scope === 'parameter' && mapping.parameterTarget) {
      setParameterMIDIBinding(mapping.parameterTarget, null);
    } else if (mapping.markerId) {
      setMarkerMIDIBinding(mapping.markerId, mapping.action as MarkerMIDIAction, null);
    }

    const sourceMarkerId =
      learnTarget?.kind === 'marker'
        ? learnTarget.sourceMarkerId ?? learnTarget.markerId
        : null;
    const isLearningCurrentMapping =
      (learnTarget?.kind === 'transport'
        && mapping.scope === 'transport'
        && learnTarget.action === mapping.action)
      || (
        learnTarget?.kind === 'slot'
        && mapping.scope === 'slot'
        && learnTarget.slotIndex === mapping.slotIndex
      )
      || (
        learnTarget?.kind === 'marker'
        && mapping.scope === 'marker'
        && learnTarget.action === mapping.action
        && sourceMarkerId === mapping.markerId
      )
      || (
        learnTarget?.kind === 'parameter'
        && mapping.scope === 'parameter'
        && mapping.parameterTarget
        && learnTarget.clipId === mapping.parameterTarget.clipId
        && learnTarget.property === mapping.parameterTarget.property
      );

    if (isLearningCurrentMapping) {
      cancelLearning();
    }

    if (draft?.mappingId === mapping.id) {
      closeEditor();
    }
  };

  const startLearningForMapping = (mapping: MIDIMappingSummaryEntry) => {
    if (mapping.scope === 'parameter') {
      if (mapping.parameterTarget) {
        startLearningParameterMIDIBinding(mapping.parameterTarget);
      }
      return;
    }

    if (mapping.scope === 'transport') {
      startLearningTransportBinding(mapping.action as MIDITransportAction);
      return;
    }

    if (mapping.scope === 'slot') {
      if (mapping.slotIndex !== undefined) {
        const target = slotTargets.find((candidate) => candidate.slotIndex === mapping.slotIndex);
        startLearningSlotBinding(
          mapping.slotIndex,
          target?.label ?? getSlotGridLabel(mapping.slotIndex),
          undefined,
          target?.compositionName
        );
      }
      return;
    }

    const targetMarkerId =
      draft?.mappingId === mapping.id
        ? draft.markerId ?? mapping.markerId
        : mapping.markerId;

    if (!targetMarkerId || !mapping.markerId) {
      return;
    }

    const marker = markers.find((candidate) => candidate.id === targetMarkerId);
    startLearningMarkerBinding(
      targetMarkerId,
      marker?.label.trim() || 'Marker',
      mapping.action as MarkerMIDIAction,
      mapping.markerId
    );
  };

  return (
    <div className="midi-mapping-panel">
      <div className="midi-mapping-header">
        <div>
          <h2>MIDI Mapping</h2>
          <p>All assigned MIDI notes and their linked editor commands. Click a mapping card to preview its trigger.</p>
        </div>
        <div className="midi-mapping-status">
          <span className={`midi-mapping-status-dot ${isEnabled && connectionStatus === 'connected' ? 'is-live' : ''}`} />
          <span>
            {isEnabled ? 'MIDI On' : 'MIDI Off'}
            {devices.length > 0 ? `, ${devices.length} device${devices.length > 1 ? 's' : ''}` : ''}
          </span>
        </div>
      </div>

      {learnDescription && (
        <div className="midi-mapping-learn-banner">
          <span>{learnDescription}</span>
          <button className="settings-button" onClick={cancelLearning}>
            Cancel Learn
          </button>
        </div>
      )}

      {mappings.length === 0 && !shouldShowPendingSlotCard ? (
        <MIDIMappingEmptyState isEnabled={isEnabled} />
      ) : (
        <div className="midi-mapping-list">
          {pendingSlotLearnTarget && shouldShowPendingSlotCard && (
            <div className="midi-mapping-card is-learning">
              <div className="midi-mapping-card-top">
                <span className="midi-mapping-binding">Listening...</span>
                <span className="midi-mapping-scope midi-mapping-scope-slot">Slot</span>
              </div>
              <div className="midi-mapping-card-main">
                <strong>Trigger Slot</strong>
                <span>
                  {pendingSlotLearnTarget.slotLabel}
                  {pendingSlotLearnTarget.compositionName ? ` - ${pendingSlotLearnTarget.compositionName}` : ''}
                </span>
              </div>
              <div className="midi-mapping-card-footer">
                <span>Trigger this slot on its layer</span>
                <div className="midi-mapping-card-actions">
                  <button className="settings-button" onClick={cancelLearning}>
                    Cancel Learn
                  </button>
                </div>
              </div>
            </div>
          )}
          {mappings.map((mapping) => {
            const isEditing = draft?.mappingId === mapping.id;
            const isParameterMapping = mapping.scope === 'parameter';
            const isActiveMapping = activeMappingIds[mapping.id] !== undefined;
            const isPreviewable = mapping.scope === 'transport' || mapping.scope === 'slot' || mapping.markerTime !== undefined;
            const sourceMarkerId =
              learnTarget?.kind === 'marker'
                ? learnTarget.sourceMarkerId ?? learnTarget.markerId
                : null;
            const isLearningCurrentMapping =
              (learnTarget?.kind === 'transport'
                && mapping.scope === 'transport'
                && learnTarget.action === mapping.action)
              || (
                learnTarget?.kind === 'slot'
                && mapping.scope === 'slot'
                && learnTarget.slotIndex === mapping.slotIndex
              )
              || (
                learnTarget?.kind === 'marker'
                && mapping.scope === 'marker'
                && learnTarget.action === mapping.action
                && sourceMarkerId === mapping.markerId
              )
              || (
                learnTarget?.kind === 'parameter'
                && mapping.scope === 'parameter'
                && mapping.parameterTarget
                && learnTarget.clipId === mapping.parameterTarget.clipId
                && learnTarget.property === mapping.parameterTarget.property
              );

            return (
              <div
                key={mapping.id}
                className={`midi-mapping-card${isPreviewable && !isEditing ? ' is-clickable' : ''}${previewingMappingId === mapping.id ? ' is-previewing' : ''}${isActiveMapping ? ' is-active' : ''}`}
                role={isPreviewable && !isEditing ? 'button' : undefined}
                tabIndex={isPreviewable && !isEditing ? 0 : undefined}
                onClick={isPreviewable && !isEditing ? () => previewMapping(mapping) : undefined}
                onKeyDown={isPreviewable && !isEditing ? (event) => handleMappingCardKeyDown(event, mapping) : undefined}
                aria-label={isPreviewable && !isEditing ? `Preview ${mapping.actionLabel}` : undefined}
              >
                <div className="midi-mapping-card-top">
                  <span className="midi-mapping-binding">{mapping.bindingLabel}</span>
                  <span className={`midi-mapping-scope midi-mapping-scope-${mapping.scope}`}>
                    {mapping.scope === 'transport'
                      ? 'Transport'
                      : mapping.scope === 'slot'
                        ? 'Slot'
                        : mapping.scope === 'parameter'
                          ? 'Parameter'
                          : 'Marker'}
                  </span>
                </div>
                <div className="midi-mapping-card-main">
                  <strong>{mapping.actionLabel}</strong>
                  <span>{mapping.targetLabel}</span>
                </div>
                <div className="midi-mapping-card-footer">
                  <span>{mapping.behaviorLabel}</span>
                  {!isEditing && (
                    <div
                      className="midi-mapping-card-actions"
                      onClick={stopEventPropagation}
                      onKeyDown={stopEventPropagation}
                    >
                      {!isParameterMapping && (
                        <button className="settings-button" onClick={() => openEditor(mapping)}>
                          Edit
                        </button>
                      )}
                      <button className="settings-button" onClick={() => startLearningForMapping(mapping)}>
                        {isLearningCurrentMapping ? 'Listening...' : 'Learn'}
                      </button>
                      <button className="settings-button" onClick={() => clearMapping(mapping)}>
                        Clear
                      </button>
                    </div>
                  )}
                </div>

                {isParameterMapping && mapping.parameterBinding && (
                  <MIDIMappingParameterControls
                    binding={mapping.parameterBinding}
                    controls={parameterRangeControls}
                  />
                )}

                {isEditing && draft && (
                  <MIDIMappingCardEditor
                    mapping={mapping}
                    markers={markers}
                    draft={draft}
                    setDraft={setDraft}
                    isLearningCurrentMapping={!!isLearningCurrentMapping}
                    onPreview={() => previewMapping(mapping)}
                    onLearn={() => startLearningForMapping(mapping)}
                    onClear={() => clearMapping(mapping)}
                    onClose={closeEditor}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
