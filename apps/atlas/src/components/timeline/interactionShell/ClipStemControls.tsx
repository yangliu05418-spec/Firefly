import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatStemJobPhase, isActiveStemJobPhase } from '../../../stores/timeline/helpers/stemSeparationJobPhases';
import type { ClipStemSeparationJobStemChoice } from '../../../stores/timeline/types';
import { ClipStemSwitcher } from '../components/ClipStemSwitcher';
import { EMPTY_STEM_CHOICES } from '../constants/clipStemConstants';
import type { ClipInteractionShellCommandContext, ClipInteractionShellCommands } from './types';

interface ClipStemControlsProps {
  context: ClipInteractionShellCommandContext;
  commands?: ClipInteractionShellCommands;
}

function getClipSourceMediaFileId(clip: { mediaFileId?: string; source?: { mediaFileId?: string } | null }): string | null {
  return clip.source?.mediaFileId ?? clip.mediaFileId ?? null;
}

function getStemChoices(context: ClipInteractionShellCommandContext): readonly ClipStemSeparationJobStemChoice[] {
  const stemModule = context.activeModules.stem;
  const job = stemModule?.job;
  if (job?.phase === 'complete' && job.stems?.length) {
    return job.stems;
  }

  const stemState = stemModule?.stemState;
  if (!stemState?.stems.length) {
    return EMPTY_STEM_CHOICES;
  }

  return stemState.stems
    .filter((stem) => Boolean(stem.mediaFileId))
    .map((stem) => ({
      id: stem.id,
      kind: stem.kind,
      label: stem.label,
      mediaFileId: stem.mediaFileId as string,
    }));
}

export function ClipStemControls({ context, commands }: ClipStemControlsProps) {
  const stemModule = context.activeModules.stem;
  const stemJob = stemModule?.job ?? null;
  const activeStemSeparationJob = stemJob && isActiveStemJobPhase(stemJob.phase) ? stemJob : null;
  const [stemMenuOpen, setStemMenuOpen] = useState(false);
  const stemMenuCloseTimerRef = useRef<number | null>(null);
  const completedStemChoices = useMemo(() => getStemChoices(context), [context]);
  const hasCompletedStemChoices = completedStemChoices.length > 0;
  const stemSourceClip = stemModule?.sourceClip ?? null;
  const stemSourceMediaFileId = stemModule?.sourceMediaFileId ??
    stemJob?.sourceMediaFileId ??
    getClipSourceMediaFileId(stemSourceClip ?? context.clip);
  const activeStemMediaFileId = getClipSourceMediaFileId(stemSourceClip ?? context.clip) ?? undefined;
  const hasStemSourceChoice = Boolean(stemSourceMediaFileId);

  const clearStemMenuCloseTimer = useCallback(() => {
    if (stemMenuCloseTimerRef.current === null) return;
    window.clearTimeout(stemMenuCloseTimerRef.current);
    stemMenuCloseTimerRef.current = null;
  }, []);

  const prewarmCompletedStemSources = useCallback(() => {
    if (!hasCompletedStemChoices) return;
    const mediaFileIds = completedStemChoices.map((stem) => stem.mediaFileId);
    if (stemSourceMediaFileId) {
      mediaFileIds.unshift(stemSourceMediaFileId);
    }
    commands?.onModuleCommand?.(
      'stem',
      { type: 'stem:prewarm-source-media-files', mediaFileIds },
      context,
    );
  }, [
    commands,
    completedStemChoices,
    context,
    hasCompletedStemChoices,
    stemSourceMediaFileId,
  ]);

  useEffect(() => clearStemMenuCloseTimer, [clearStemMenuCloseTimer]);

  const handleStemControlMouseDown = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const handleStemBadgeClick = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    clearStemMenuCloseTimer();
    if (!hasCompletedStemChoices) return;
    setStemMenuOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        prewarmCompletedStemSources();
      }
      return nextOpen;
    });
  }, [clearStemMenuCloseTimer, hasCompletedStemChoices, prewarmCompletedStemSources]);

  const handleStemChoiceClick = useCallback((stemMediaFileId: string) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    commands?.onModuleCommand?.(
      'stem',
      { type: 'stem:set-clip-source', stemMediaFileId },
      context,
      event,
    );
  }, [commands, context]);

  const handleStemSwitcherMouseEnter = useCallback(() => {
    clearStemMenuCloseTimer();
    prewarmCompletedStemSources();
  }, [clearStemMenuCloseTimer, prewarmCompletedStemSources]);

  const handleStemSwitcherMouseLeave = useCallback(() => {
    if (!stemMenuOpen) return;
    clearStemMenuCloseTimer();
    stemMenuCloseTimerRef.current = window.setTimeout(() => {
      setStemMenuOpen(false);
      stemMenuCloseTimerRef.current = null;
    }, 320);
  }, [clearStemMenuCloseTimer, stemMenuOpen]);

  if (activeStemSeparationJob) {
    const progressPercent = Math.round(Math.max(0, Math.min(1, activeStemSeparationJob.progress)) * 100);
    const statusLabel = activeStemSeparationJob.message ?? formatStemJobPhase(activeStemSeparationJob.phase);

    return (
      <div
        className="shell-stem-module clip-stem-generating"
        title={`${statusLabel}: ${progressPercent}%`}
        data-clip-interaction-slot="stem"
      >
        <span className="progress-fill-badge stem-fill-badge">
          <span className="progress-fill stem-fill-progress" style={{ height: `${progressPercent}%` }} />
          <span className="progress-fill-label">{activeStemSeparationJob.phase === 'downloading-model' ? 'M' : 'S'}</span>
        </span>
        <span className="stem-percent">{progressPercent}%</span>
        <span className="stem-status-text">{statusLabel}</span>
      </div>
    );
  }

  if (!hasCompletedStemChoices) {
    return (
      <div
        className="shell-stem-module"
        aria-hidden="true"
        data-clip-interaction-slot="stem"
        hidden
      />
    );
  }

  return (
    <div className="shell-stem-module" data-clip-interaction-slot="stem">
      <ClipStemSwitcher
        stemMenuOpen={stemMenuOpen}
        completedStemChoices={completedStemChoices}
        hasStemSourceChoice={hasStemSourceChoice}
        stemSourceMediaFileId={stemSourceMediaFileId}
        activeStemMediaFileId={activeStemMediaFileId}
        onMouseEnter={handleStemSwitcherMouseEnter}
        onMouseLeave={handleStemSwitcherMouseLeave}
        onControlMouseDown={handleStemControlMouseDown}
        onBadgeClick={handleStemBadgeClick}
        onChoiceClick={handleStemChoiceClick}
      />
    </div>
  );
}
