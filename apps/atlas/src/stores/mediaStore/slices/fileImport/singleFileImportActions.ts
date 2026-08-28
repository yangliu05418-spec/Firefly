import type { MediaSliceCreator } from '../../types';
import { generateId, processImport } from '../../helpers/importPipeline';
import type { FileImportActions, ImportFileOptions } from '../fileImportSlice';
import { commitSignalAsset } from './signalAssetCommit';
import { resolveImportEntry, runSignalImport } from './importPlanning';
import {
  createPlaceholder,
  finalizeImportedMediaFile,
  startMediaFileAudioProxyGeneration,
  startVideoProxyGenerationIfNeeded,
} from './placeholderLifecycle';
import { fileImportLog as log } from './log';

export const createSingleFileImportActions: MediaSliceCreator<Pick<FileImportActions, 'importFile'>> = (
  set,
  get,
) => ({
  importFile: async (file: File, parentId?: string | null, options?: ImportFileOptions) => {
    const existing = get().files.find((f) =>
      f.name === file.name && f.fileSize === file.size && !f.isImporting
    );
    if (existing) {
      log.info(`Skipping duplicate: ${file.name} (${file.size} bytes) - already exists as ${existing.id}`);
      if (options?.stemInfo) {
        const updatedExisting = { ...existing, stemInfo: options.stemInfo };
        set((state) => ({
          files: state.files.map((candidate) => candidate.id === existing.id ? updatedExisting : candidate),
        }));
        startMediaFileAudioProxyGeneration(set, get, existing.id);
        startVideoProxyGenerationIfNeeded(get, existing.id);
        return updatedExisting;
      }
      startMediaFileAudioProxyGeneration(set, get, existing.id);
      startVideoProxyGenerationIfNeeded(get, existing.id);
      return existing;
    }

    const id = generateId();
    const resolved = await resolveImportEntry(file, { id });

    if (resolved.route === 'signal') {
      const existingSignal = get().signalAssets.find((item) =>
        item.name === file.name && item.fileSize === file.size
      );
      if (existingSignal) {
        log.info(`Skipping duplicate SignalAsset: ${file.name} (${file.size} bytes) - already exists as ${existingSignal.id}`);
        return existingSignal;
      }

      log.info(`Starting Signal import: ${file.name} provider: ${resolved.plan.provider.id} size: ${file.size}`);
      const signalAsset = await runSignalImport(resolved, parentId);
      commitSignalAsset(set, signalAsset);
      log.info('Signal import complete:', signalAsset.name);
      return signalAsset;
    }

    const type = resolved.type;
    log.info(`Starting: ${file.name} type: ${type} size: ${file.size}`);

    const placeholder = createPlaceholder(file, id, type, parentId);
    set((state) => ({
      files: [...state.files, placeholder],
    }));

    try {
      const result = await processImport({
        file,
        id,
        parentId,
        forceCopyToProject: options?.forceCopyToProject === true,
        projectFileName: options?.projectFileName,
        typeOverride: type,
      });
      const mediaFile = options?.stemInfo
        ? { ...result.mediaFile, stemInfo: options.stemInfo }
        : result.mediaFile;
      finalizeImportedMediaFile(set, get, id, mediaFile);
      log.info('Complete:', mediaFile.name);
      return mediaFile;
    } catch (err) {
      log.error(`Import failed: ${file.name}`, err);
      set((state) => ({
        files: state.files.filter((f) => f.id !== id),
      }));
      throw err;
    }
  },
});
