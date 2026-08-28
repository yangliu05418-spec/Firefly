import type { TransitionDefinition } from '../types';

export const shatterGlass: TransitionDefinition = {
  id: 'shatter-glass',
  name: 'Shatter Glass',
  category: 'pattern',
  defaultDuration: 1.25,
  minDuration: 0.1,
  maxDuration: 5,
  description: 'Break the outgoing clip into deterministic rectangular glass tiles over the incoming clip',
  params: {
    seed: {
      type: 'number',
      label: 'Seed',
      defaultValue: 0,
      min: 0,
      max: 1_000_000,
      step: 1,
    },
  },
  recipe: [{
    kind: 'multi-panel',
    target: 'outgoing',
    rows: 4,
    columns: 6,
    order: 'random',
    motion: 'shatter',
    seed: 0,
    stagger: 0.22,
    curve: 'ease-in',
  }],
};
