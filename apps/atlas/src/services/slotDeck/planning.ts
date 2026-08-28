import type { SlotDeckEntry } from './types';

export function resolveAssignedCompositionId(
  slotAssignments: Record<string, number>,
  slotIndex: number
): string | null {
  for (const [compId, assignedSlotIndex] of Object.entries(slotAssignments)) {
    if (assignedSlotIndex === slotIndex) {
      return compId;
    }
  }
  return null;
}

function getEvictionTimestamp(entry: SlotDeckEntry): number {
  return Math.max(entry.lastActivatedAt ?? 0, entry.lastPreparedAt ?? 0);
}

export function getEvictionCandidates(entries: Iterable<SlotDeckEntry>): SlotDeckEntry[] {
  return Array.from(entries).filter(
    (entry) => entry.pinnedLayerIndex === null && !entry.pendingDispose && entry.status !== 'disposed'
  );
}

export function findEvictionCandidate(
  entries: Iterable<SlotDeckEntry>,
  preferredPreserveSlotIndex?: number | null
): SlotDeckEntry | null {
  const candidates = getEvictionCandidates(entries);
  if (candidates.length === 0) {
    return null;
  }

  const pool =
    preferredPreserveSlotIndex === undefined || preferredPreserveSlotIndex === null
      ? candidates
      : candidates.filter((entry) => entry.slotIndex !== preferredPreserveSlotIndex);

  if (pool.length === 0) {
    return null;
  }

  pool.sort((left, right) => {
    const timestampDiff = getEvictionTimestamp(left) - getEvictionTimestamp(right);
    if (timestampDiff !== 0) {
      return timestampDiff;
    }
    return left.slotIndex - right.slotIndex;
  });

  return pool[0] ?? null;
}
