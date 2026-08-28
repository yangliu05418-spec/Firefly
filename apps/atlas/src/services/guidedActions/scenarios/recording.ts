import { compileGuidedScenario, type GuidedScenario, type GuidedScenarioCompileOptions } from './tutorialScenarioCompiler';
import type { GuidedAction, GuidedToolCall } from '../types';
import { compileGuidedToolCall } from '../compiler';

export interface GuidedActionInspection {
  checkKind?: string;
  family?: string;
  index: number;
  label?: string;
  targetKind?: string;
  tool?: string;
  type: GuidedAction['type'];
}

export interface GuidedScenarioInspection {
  actionCount: number;
  actions: GuidedActionInspection[];
  scenarioId: string;
  stepCount: number;
  title: string;
}

export function inspectGuidedScenario(
  scenario: GuidedScenario,
  options?: GuidedScenarioCompileOptions,
): GuidedScenarioInspection {
  const compiled = compileGuidedScenario(scenario, options);

  return {
    actionCount: compiled.actions.length,
    actions: compiled.actions.map(inspectAction),
    scenarioId: scenario.id,
    stepCount: scenario.steps.length,
    title: scenario.title,
  };
}

export function inspectGuidedToolCall(toolCall: GuidedToolCall): GuidedActionInspection[] {
  return compileGuidedToolCall(toolCall).actions.map(inspectAction);
}

export function serializeGuidedScenario(scenario: GuidedScenario): string {
  return JSON.stringify(scenario, null, 2);
}

function inspectAction(action: GuidedAction, index: number): GuidedActionInspection {
  return {
    checkKind: action.type === 'confirmState' || action.type === 'waitForUserAction'
      ? action.check.kind
      : undefined,
    family: action.family,
    index,
    label: action.label,
    targetKind: readTargetKind(action),
    tool: action.type === 'executeTool' ? action.tool : undefined,
    type: action.type,
  };
}

function readTargetKind(action: GuidedAction): string | undefined {
  if ('target' in action && action.target && typeof action.target === 'object') {
    return action.target.kind;
  }
  if (action.type === 'dragCursor') {
    return action.to.kind;
  }
  return undefined;
}
