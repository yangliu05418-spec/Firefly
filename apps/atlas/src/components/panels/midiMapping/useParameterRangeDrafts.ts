// Draft state for parameter MIDI binding min/max ranges, plus
// invert/damping toggles, used by the parameter mapping card controls.

import { useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { updateParameterMIDIBinding } from '../../../services/midi/midiBindingMutations';
import type { MIDIParameterBinding } from '../../../types/midi';

export interface MIDIParameterRangeDraft {
  min: string;
  max: string;
}

function formatParameterRangeInput(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }

  if (Number.isInteger(value)) {
    return String(value);
  }

  return Number(value.toFixed(6)).toString();
}

function resolveParameterRange(binding: MIDIParameterBinding): { min: number; max: number } {
  if (
    typeof binding.min === 'number' &&
    typeof binding.max === 'number' &&
    Number.isFinite(binding.min) &&
    Number.isFinite(binding.max) &&
    binding.max > binding.min
  ) {
    return { min: binding.min, max: binding.max };
  }

  const center = typeof binding.currentValue === 'number' && Number.isFinite(binding.currentValue)
    ? binding.currentValue
    : 0;
  const range = Math.max(Math.abs(center), 1) * 4;
  return {
    min: center - range / 2,
    max: center + range / 2,
  };
}

export interface ParameterRangeDraftControls {
  getParameterRangeDraft: (binding: MIDIParameterBinding) => MIDIParameterRangeDraft;
  updateParameterRangeDraft: (
    binding: MIDIParameterBinding,
    field: keyof MIDIParameterRangeDraft,
    value: string
  ) => void;
  commitParameterRangeDraft: (binding: MIDIParameterBinding) => void;
  handleParameterRangeKeyDown: (
    event: ReactKeyboardEvent<HTMLInputElement>,
    binding: MIDIParameterBinding
  ) => void;
  toggleParameterInvert: (binding: MIDIParameterBinding) => void;
  toggleParameterDamping: (binding: MIDIParameterBinding) => void;
}

export function useParameterRangeDrafts(): ParameterRangeDraftControls {
  const [parameterRangeDrafts, setParameterRangeDrafts] = useState<Record<string, MIDIParameterRangeDraft>>({});

  const getParameterRangeDraft = (binding: MIDIParameterBinding): MIDIParameterRangeDraft => {
    const draftRange = parameterRangeDrafts[binding.id];
    if (draftRange) {
      return draftRange;
    }

    const range = resolveParameterRange(binding);
    return {
      min: formatParameterRangeInput(range.min),
      max: formatParameterRangeInput(range.max),
    };
  };

  const updateParameterRangeDraft = (
    binding: MIDIParameterBinding,
    field: keyof MIDIParameterRangeDraft,
    value: string
  ) => {
    const range = resolveParameterRange(binding);
    setParameterRangeDrafts((currentDrafts) => ({
      ...currentDrafts,
      [binding.id]: {
        min: currentDrafts[binding.id]?.min ?? formatParameterRangeInput(range.min),
        max: currentDrafts[binding.id]?.max ?? formatParameterRangeInput(range.max),
        [field]: value,
      },
    }));
  };

  const resetParameterRangeDraft = (bindingId: string) => {
    setParameterRangeDrafts((currentDrafts) => {
      if (!currentDrafts[bindingId]) {
        return currentDrafts;
      }

      const nextDrafts = { ...currentDrafts };
      delete nextDrafts[bindingId];
      return nextDrafts;
    });
  };

  const commitParameterRangeDraft = (binding: MIDIParameterBinding) => {
    const draftRange = parameterRangeDrafts[binding.id];
    if (!draftRange) {
      return;
    }

    const min = Number(draftRange.min);
    const max = Number(draftRange.max);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      updateParameterMIDIBinding(binding.id, { min, max });
    }

    resetParameterRangeDraft(binding.id);
  };

  const handleParameterRangeKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
    binding: MIDIParameterBinding
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitParameterRangeDraft(binding);
      event.currentTarget.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      resetParameterRangeDraft(binding.id);
      event.currentTarget.blur();
    }
  };

  const toggleParameterInvert = (binding: MIDIParameterBinding) => {
    updateParameterMIDIBinding(binding.id, { invert: !binding.invert });
  };

  const toggleParameterDamping = (binding: MIDIParameterBinding) => {
    updateParameterMIDIBinding(binding.id, { damping: !binding.damping });
  };

  return {
    getParameterRangeDraft,
    updateParameterRangeDraft,
    commitParameterRangeDraft,
    handleParameterRangeKeyDown,
    toggleParameterInvert,
    toggleParameterDamping,
  };
}
