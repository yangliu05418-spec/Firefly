import type { TimelineTestMigrationEntry } from './types';

export const timelineTestMigrationLedger = [
  {
    path: 'tests/unit/timelineRenderModel.test.ts',
    classification: 'keep',
    ownerLane: 'timeline-host',
    replacementGate: 'P2_GEOMETRY_SNAPSHOT_ADOPTED',
    note: 'Ported kernel projection and geometry contract coverage is now target P2 coverage.',
  },
  {
    path: 'tests/unit/timelineClipCanvasWorkerModel.test.ts',
    classification: 'keep',
    ownerLane: 'paint-canvas',
    replacementGate: 'P3_PAINT_PACKET_ADOPTED',
    note: 'Worker message, paint-packet, payload, transfer, and eligibility assertions are target paint-canvas coverage.',
  },
  {
    path: 'tests/unit/TimelineClipCanvasWorkerRuntime.test.tsx',
    classification: 'keep',
    ownerLane: 'paint-canvas',
    replacementGate: 'P3_CANVAS_CLIP_DELETED',
    note: 'Worker runtime, prepared resource, fallback, and transfer assertions are target paint-canvas coverage after CanvasClip deletion.',
  },
  {
    path: 'tests/stores/timeline/trackSlice.test.ts',
    classification: 'keep',
    ownerLane: 'runtime-store-importer',
    replacementGate: 'P4_STORE_SLICE_GOD_FILES_SPLIT',
    note: 'Store behavior remains target coverage outside the kernel.',
  },
  {
    path: 'tests/unit/mediaObjectUrlManager.test.ts',
    classification: 'keep',
    ownerLane: 'runtime-store-importer',
    replacementGate: 'P4_RUNTIME_RESOURCE_TESTS_KEPT_OUT_OF_KERNEL',
    note: 'Runtime resource behavior stays service/store coverage and must not move into the kernel.',
  },
  {
    path: 'tests/unit/timelineRuntimeCoordinatorContracts.test.ts',
    classification: 'keep',
    ownerLane: 'runtime-store-importer',
    replacementGate: 'P4_RUNTIME_RESOURCE_TESTS_KEPT_OUT_OF_KERNEL',
    note: 'RuntimeProviderDemand bridge and coordinator leases stay service coverage while the kernel exports only plain demand data.',
  },
] as const satisfies readonly TimelineTestMigrationEntry[];
