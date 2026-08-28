import { describe, expect, it } from 'vitest';
import { createEmptyDocument, type AtlasAgentOperation, type AtlasAsset } from './model';
import { applyAgentOperations, ATLAS_AGENT_CATALOG_DIGEST, createEditorHistory, createTimelinePlayback, editorReducer, guardedEditorReducer, timelinePlaybackReducer, validateAgentOperations, validateAgentPlan } from './timeline';

const asset: AtlasAsset = {
  id: 'asset-1', name: 'take.mp4', kind: 'video', mimeType: 'video/mp4', size: 100,
  duration: 10, status: 'ready', source: 'firefly', mediaUrl: '/media',
};
const operation = (sequence: number, tool: string, args: Record<string, unknown>): AtlasAgentOperation => ({
  sequence, tool, args,
  risk: tool === 'delete_clip' ? 'destructive' : tool === 'request_export' ? 'external' : tool === 'insert_project_asset' ? 'medium' : 'low',
  requiresConfirmation: tool === 'delete_clip' || tool === 'request_export',
  operationKey: `run-1:${sequence}`, operationDigest: 'd'.repeat(64),
});

describe('timeline transactions', () => {
  it('keeps playback state outside the persisted document and cloud revision', () => {
    const history = createEditorHistory(createEmptyDocument('project-1', '片场', 6));
    const playing = timelinePlaybackReducer(createTimelinePlayback(), { type: 'play' });
    const advanced = timelinePlaybackReducer(playing, { type: 'advance', delta: 1.25, duration: 10 });
    expect(advanced).toEqual({ playhead: 1.25, playing: true });
    expect(history.present.playhead).toBe(0);
    expect(history.present.revision).toBe(6);
    expect(history.past).toHaveLength(0);
  });

  it('stops ephemeral playback at the document boundary', () => {
    const state = timelinePlaybackReducer({ playhead: 9.8, playing: true }, { type: 'advance', delta: 1, duration: 10 });
    expect(state).toEqual({ playhead: 10, playing: false });
  });

  it('adds, reorders, splits and undoes clips as user transactions', () => {
    let state = createEditorHistory(createEmptyDocument('project-1', '片场'));
    state = editorReducer(state, { type: 'add-assets', assets: [asset] });
    state = editorReducer(state, { type: 'add-clip', assetId: asset.id });
    const clipId = state.present.clips[0]!.id;
    state = editorReducer(state, { type: 'split-clip', clipId, time: 4 });
    expect(state.present.clips.map((clip) => clip.duration)).toEqual([4, 6]);
    state = editorReducer(state, { type: 'undo' });
    expect(state.present.clips).toHaveLength(1);
    expect(state.present.clips[0]!.duration).toBe(10);
  });

  it('moves clips across compatible unlocked tracks at the dropped time', () => {
    let state = createEditorHistory(createEmptyDocument('project-1', '片场'));
    state = editorReducer(state, { type: 'add-assets', assets: [asset] });
    state = editorReducer(state, { type: 'add-clip', assetId: asset.id });
    state = editorReducer(state, { type: 'add-track', kind: 'video' });
    const clip = state.present.clips[0]!;
    const target = state.present.tracks.filter((track) => track.kind === 'video')[1]!;
    state = editorReducer(state, { type: 'move-clip', clipId: clip.id, trackId: target.id, startTime: 3.25 });
    expect(state.present.clips[0]).toMatchObject({ trackId: target.id, startTime: 3.25 });
  });

  it('locks every clip mutation on a locked source or target track', () => {
    let state = createEditorHistory(createEmptyDocument('project-1', '片场'));
    state = editorReducer(state, { type: 'add-assets', assets: [asset] });
    state = editorReducer(state, { type: 'add-clip', assetId: asset.id });
    state = editorReducer(state, { type: 'add-track', kind: 'video' });
    const clip = state.present.clips[0]!;
    const sourceTrack = state.present.tracks.find((track) => track.id === clip.trackId)!;
    const targetTrack = state.present.tracks.filter((track) => track.kind === 'video')[1]!;
    state = editorReducer(state, { type: 'toggle-track-locked', trackId: sourceTrack.id });
    const locked = state.present;
    expect(editorReducer(state, { type: 'delete-clip', clipId: clip.id }).present).toBe(locked);
    expect(editorReducer(state, { type: 'update-volume', clipId: clip.id, volume: 0.2 }).present).toBe(locked);
    expect(editorReducer(state, { type: 'move-clip', clipId: clip.id, trackId: targetTrack.id, startTime: 2 }).present).toBe(locked);
  });

  it('applies a server-catalog Agent plan as one undo step', () => {
    let state = createEditorHistory(createEmptyDocument('project-1', '片场'));
    state = editorReducer(state, { type: 'add-assets', assets: [asset] });
    state = editorReducer(state, { type: 'add-clip', assetId: asset.id });
    const clipId = state.present.clips[0]!.id;
    const operations = [operation(1, 'split_clip', { clipId, atMs: 5_000 })];
    expect(validateAgentOperations(operations)).toBe(true);
    const applied = editorReducer(state, { type: 'apply-agent-plan', operations });
    expect(applied.present.clips).toHaveLength(2);
    expect(editorReducer(applied, { type: 'undo' }).present.clips).toHaveLength(1);
  });

  it('interprets split atMs as a clip-local offset for non-zero timeline starts', () => {
    let state = createEditorHistory(createEmptyDocument('project-1', '片场'));
    state = editorReducer(state, { type: 'add-assets', assets: [asset] });
    state = editorReducer(state, { type: 'add-clip', assetId: asset.id });
    const clip = state.present.clips[0]!;
    const shifted = { ...state.present, clips: [{ ...clip, startTime: 8 }] };
    const result = applyAgentOperations(shifted, [operation(1, 'split_clip', { clipId: clip.id, atMs: 2_500 })]);
    expect(result?.clips.map((item) => [item.startTime, item.duration])).toEqual([[8, 2.5], [10.5, 7.5]]);
  });

  it('fails closed for unknown or transition-removal tools not represented by the document model', () => {
    expect(validateAgentOperations([operation(1, 'write_store_directly', {})])).toBe(false);
    const document = createEmptyDocument('project-1', '片场');
    expect(applyAgentOperations(document, [operation(1, 'remove_transition', { transitionId: 'x' })])).toBeNull();
  });

  it('executes every server catalog tool without dropping arguments', () => {
    const audio: AtlasAsset = { ...asset, id: 'audio-1', name: 'voice.wav', kind: 'audio', mimeType: 'audio/wav', duration: 12 };
    let history = createEditorHistory(createEmptyDocument('project-1', '片场'));
    history = editorReducer(history, { type: 'add-assets', assets: [asset, { ...asset, id: 'asset-2' }, audio] });
    history = editorReducer(history, { type: 'add-clip', assetId: 'asset-1' });
    history = editorReducer(history, { type: 'add-clip', assetId: 'asset-2' });
    history = editorReducer(history, { type: 'add-clip', assetId: 'audio-1' });
    history = editorReducer(history, { type: 'add-track', kind: 'video' });
    const base = history.present;
    const [first, second, audioClip] = base.clips;
    const secondVideoTrack = base.tracks.filter((track) => track.kind === 'video')[1]!;

    const plan = [
      operation(1, 'split_clip', { clipId: first!.id, atMs: 4_000 }),
      operation(2, 'trim_clip', { clipId: second!.id, sourceInMs: 1_000, sourceOutMs: 7_000 }),
      operation(3, 'move_clip', { clipId: second!.id, trackId: secondVideoTrack.id, startMs: 2_000 }),
      operation(4, 'set_clip_volume', { clipId: audioClip!.id, volume: 4 }),
      operation(5, 'set_track_muted', { trackId: audioClip!.trackId, muted: true }),
      operation(6, 'set_transform', { clipId: first!.id, positionX: 24, positionY: -12, scaleX: 1.2, scaleY: 0.8, rotationDeg: 8, opacity: 0.6 }),
      operation(7, 'create_track', { trackId: 'agent-track', kind: 'video', index: 0 }),
      operation(8, 'insert_project_asset', { assetId: 'asset-2', trackId: 'agent-track', startMs: 3_500 }),
      operation(9, 'reorder_clips', { trackId: secondVideoTrack.id, clipIds: [second!.id] }),
      operation(10, 'delete_clip', { clipId: audioClip!.id }),
      operation(11, 'request_export', { preset: 'mp4_h264_aac_1080p30' }),
    ];
    const result = applyAgentOperations(base, plan);
    expect(result).not.toBeNull();
    expect(result!.revision).toBe(base.revision + 1);
    expect(result!.tracks[0]!.id).toBe('agent-track');
    expect(result!.clips.find((clip) => clip.assetId === 'asset-2' && clip.trackId === 'agent-track')?.startTime).toBe(3.5);
    expect(result!.clips.find((clip) => clip.id === second!.id)).toMatchObject({ trackId: secondVideoTrack.id, inPoint: 1, outPoint: 7 });
    expect(result!.clips.find((clip) => clip.id === first!.id)?.transform).toEqual({ x: 24, y: -12, scaleX: 1.2, scaleY: 0.8, rotation: 8, opacity: 0.6 });
    expect(result!.clips.some((clip) => clip.id === audioClip!.id)).toBe(false);
  });

  it('does not advance the cloud revision for an export-only plan', () => {
    const document = createEmptyDocument('project-1', '片场', 7);
    const result = applyAgentOperations(document, [operation(1, 'request_export', { preset: 'mp4_h264_aac_1080p30' })]);
    expect(result).toBe(document);
    expect(result?.revision).toBe(7);
  });

  it('round-trips add/remove transition identity and duration', () => {
    let history = createEditorHistory(createEmptyDocument('project-1', '片场'));
    history = editorReducer(history, { type: 'add-assets', assets: [asset, { ...asset, id: 'asset-2' }] });
    history = editorReducer(history, { type: 'add-clip', assetId: 'asset-1' });
    history = editorReducer(history, { type: 'add-clip', assetId: 'asset-2' });
    const [from, to] = history.present.clips;
    const added = applyAgentOperations(history.present, [operation(1, 'add_transition', {
      transitionId: 'transition-1', fromClipId: from!.id, toClipId: to!.id, type: 'wipe_left', durationMs: 1_250,
    })]);
    expect(added?.clips.find((clip) => clip.id === to!.id)).toMatchObject({ transitionId: 'transition-1', transitionFromClipId: from!.id, transitionIn: 'wipe-left', transitionDuration: 1.25 });
    const removed = applyAgentOperations(added!, [operation(1, 'remove_transition', { transitionId: 'transition-1' })]);
    expect(removed?.clips.find((clip) => clip.id === to!.id)).toMatchObject({ transitionIn: 'none' });
  });

  it('rejects transitions between non-adjacent clips and clamps duration to both clips', () => {
    let history = createEditorHistory(createEmptyDocument('project-1', '片场'));
    history = editorReducer(history, { type: 'add-assets', assets: [asset, { ...asset, id: 'asset-2' }] });
    history = editorReducer(history, { type: 'add-clip', assetId: 'asset-1' });
    history = editorReducer(history, { type: 'add-clip', assetId: 'asset-2' });
    const [from, to] = history.present.clips;
    const separated = { ...history.present, clips: [from!, { ...to!, startTime: to!.startTime + 2 }] };
    expect(applyAgentOperations(separated, [operation(1, 'add_transition', {
      transitionId: 'transition-gap', fromClipId: from!.id, toClipId: to!.id, type: 'crossfade', durationMs: 500,
    })])).toBeNull();
    const short = { ...history.present, clips: [{ ...from!, duration: 0.2, outPoint: 0.2 }, { ...to!, startTime: 0.2 }] };
    const applied = applyAgentOperations(short, [operation(1, 'add_transition', {
      transitionId: 'transition-short', fromClipId: from!.id, toClipId: to!.id, type: 'crossfade', durationMs: 2_000,
    })]);
    expect(applied?.clips.find((clip) => clip.id === to!.id)?.transitionDuration).toBe(0.2);
  });

  it('rejects every non-Agent reducer action while the atomic mutation lock is held', () => {
    const state = createEditorHistory(createEmptyDocument('project-1', '片场', 2));
    expect(guardedEditorReducer(state, { type: 'rename-document', title: '延迟输入' }, true)).toBe(state);
    expect(guardedEditorReducer(state, { type: 'sync-asset', assetId: 'late', patch: { status: 'ready' } }, true)).toBe(state);
    expect(guardedEditorReducer(state, { type: 'undo' }, true)).toBe(state);
    const committed = createEmptyDocument('project-1', 'Agent结果', 3);
    expect(guardedEditorReducer(state, { type: 'commit-agent-document', document: committed }, true).present).toBe(committed);
  });

  it('validates the pinned browser catalog, parameter ranges and derived policy', () => {
    const validOperation = operation(1, 'set_clip_volume', { clipId: 'clip-1', volume: 1.5 });
    const validPlan = {
      version: 1 as const, summary: '调整音量', catalogVersion: '1', catalogDigest: ATLAS_AGENT_CATALOG_DIGEST,
      baseRevision: 2, operations: [validOperation], planDigest: 'a'.repeat(64),
    };
    expect(validateAgentPlan(validPlan)).toBe(true);
    expect(validateAgentPlan({ ...validPlan, catalogVersion: '0' })).toBe(false);
    expect(validateAgentPlan({ ...validPlan, catalogDigest: 'b'.repeat(64) })).toBe(false);
    expect(validateAgentOperations([{ ...validOperation, args: { clipId: 'clip-1', volume: 5 } }])).toBe(false);
    expect(validateAgentOperations([{ ...validOperation, args: { clipId: 'clip-1', volume: 1, injected: true } }])).toBe(false);
    expect(validateAgentOperations([{ ...validOperation, risk: 'destructive', requiresConfirmation: true }])).toBe(false);
  });
});
