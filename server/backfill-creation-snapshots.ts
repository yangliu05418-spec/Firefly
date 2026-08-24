import { users } from "./store.js";
import { buildLegacyImageSnapshot, buildLegacyVideoSnapshot } from "./legacy-creation-snapshot.js";

const dependencies = {
  readUploadState: (uploadId: string) => users.readUploadState(uploadId),
  readUserAsset: (assetId: string) => users.readUserAsset(assetId),
  readSnapshotReference: (id: string) => users.readCreationSnapshotReference(id),
};

let created = 0;
for (;;) {
  const videos = users.listVideoTasksWithoutCreationSnapshots(100);
  const images = users.listImageTasksWithoutCreationSnapshots(100);
  if (!videos.length && !images.length) break;
  for (const task of videos) if (users.createCreationSnapshotIfMissing(buildLegacyVideoSnapshot(task, dependencies)).status === "created") created += 1;
  for (const task of images) if (users.createCreationSnapshotIfMissing(buildLegacyImageSnapshot(task, dependencies)).status === "created") created += 1;
}
process.stdout.write(`${JSON.stringify({ type: "creation_snapshot_backfill_completed", at: new Date().toISOString(), created })}\n`);
users.close();
