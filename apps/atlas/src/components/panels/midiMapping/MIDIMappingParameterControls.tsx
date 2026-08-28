// Min/max/invert/damp control row rendered on parameter MIDI mapping cards.

import type { SyntheticEvent } from 'react';
import type { MIDIParameterBinding } from '../../../types/midi';
import type { ParameterRangeDraftControls } from './useParameterRangeDrafts';

const stopEventPropagation = (event: SyntheticEvent) => {
  event.stopPropagation();
};

interface MIDIMappingParameterControlsProps {
  binding: MIDIParameterBinding;
  controls: ParameterRangeDraftControls;
}

export function MIDIMappingParameterControls({ binding, controls }: MIDIMappingParameterControlsProps) {
  const rangeDraft = controls.getParameterRangeDraft(binding);

  return (
    <div
      className="midi-mapping-parameter-controls"
      onClick={stopEventPropagation}
      onKeyDown={stopEventPropagation}
    >
      <label className="midi-mapping-field midi-mapping-range-field">
        <span>Min</span>
        <input
          type="number"
          value={rangeDraft.min}
          onChange={(event) => controls.updateParameterRangeDraft(binding, 'min', event.target.value)}
          onBlur={() => controls.commitParameterRangeDraft(binding)}
          onKeyDown={(event) => controls.handleParameterRangeKeyDown(event, binding)}
        />
      </label>
      <label className="midi-mapping-field midi-mapping-range-field">
        <span>Max</span>
        <input
          type="number"
          value={rangeDraft.max}
          onChange={(event) => controls.updateParameterRangeDraft(binding, 'max', event.target.value)}
          onBlur={() => controls.commitParameterRangeDraft(binding)}
          onKeyDown={(event) => controls.handleParameterRangeKeyDown(event, binding)}
        />
      </label>
      <button
        className={`settings-button midi-mapping-invert-button${binding.invert ? ' is-active' : ''}`}
        onClick={() => controls.toggleParameterInvert(binding)}
        title="Invert MIDI value"
        type="button"
      >
        Invert
      </button>
      <label
        className="midi-mapping-checkbox"
        title="Smooth MIDI parameter changes"
      >
        <input
          type="checkbox"
          checked={!!binding.damping}
          onChange={() => controls.toggleParameterDamping(binding)}
        />
        <span>Damp</span>
      </label>
    </div>
  );
}
