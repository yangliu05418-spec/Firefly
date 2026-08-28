import { useMediaStore } from '../../../../stores/mediaStore';
import type { CallerContext } from '../../policy';
import { handleImportLocalFiles } from '../media';
import { normalizeIds, normalizePaths } from './args';
import type { ImportLocalFilesData, PreparedFixtureMedia } from './model';

export async function prepareImportedMedia(
  args: Record<string, unknown>,
  callerContext: CallerContext
): Promise<PreparedFixtureMedia> {
  const mediaStore = useMediaStore.getState();
  const paths = normalizePaths(args.paths);
  const mediaFileIds = normalizeIds(args.mediaFileIds);
  let imported: PreparedFixtureMedia['imported'] = [];
  let importErrors: PreparedFixtureMedia['errors'];

  if (paths.length > 0) {
    const result = await handleImportLocalFiles({ paths, addToTimeline: false }, mediaStore, callerContext);
    if (!result.success) {
      return {
        roles: {} as PreparedFixtureMedia['roles'],
        imported,
        errors: (result.data as ImportLocalFilesData | undefined)?.errors ?? [{ path: paths.join(', '), error: result.error ?? 'Import failed' }],
      };
    }
    const data = result.data as ImportLocalFilesData | undefined;
    imported = data?.imported ?? [];
    importErrors = data?.errors;
  }

  const roleIds = paths.length > 0
    ? imported.map((entry) => entry.id)
    : mediaFileIds;

  if (roleIds.length < 3) {
    throw new Error(`Stress test fixture needs at least 3 video files, got ${roleIds.length}`);
  }

  const freshMedia = useMediaStore.getState();
  const mediaById = new Map(freshMedia.files.map((file) => [file.id, file]));
  const primary = mediaById.get(roleIds[0]);
  const blend = mediaById.get(roleIds[1]);
  const detail = mediaById.get(roleIds[2]);
  if (!primary || !blend || !detail) {
    throw new Error('Imported stress test fixture media could not be resolved from media store');
  }

  return {
    roles: {
      'primary-motion': primary,
      'blend-mask': blend,
      'detail-nested': detail,
    },
    imported,
    errors: importErrors,
  };
}
