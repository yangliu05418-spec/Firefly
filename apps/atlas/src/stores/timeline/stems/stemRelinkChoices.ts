import type { AudioStemKind, TimelineClip } from '../../../types';
import type { MediaFile, MediaFolder } from '../../mediaStore';
import type { ClipStemSeparationJobStemChoice } from '../types';

const STEM_MEDIA_ROOT_FOLDER_NAME = 'Stems';
const STEM_KIND_ORDER: AudioStemKind[] = ['vocals', 'dialogue', 'drums', 'bass', 'instrumental', 'music', 'sfx', 'other', 'mix'];
const STEM_LABEL_TO_KIND = new Map<string, AudioStemKind>([
  ['mix', 'mix'],
  ['vocals', 'vocals'],
  ['voice', 'vocals'],
  ['dialogue', 'dialogue'],
  ['dialog', 'dialogue'],
  ['drums', 'drums'],
  ['bass', 'bass'],
  ['other', 'other'],
  ['instrumental', 'instrumental'],
  ['music', 'music'],
  ['sfx', 'sfx'],
  ['sound effects', 'sfx'],
]);

function stemKindSortIndex(kind: AudioStemKind): number {
  const index = STEM_KIND_ORDER.indexOf(kind);
  return index === -1 ? STEM_KIND_ORDER.length : index;
}

function getClipMediaFileId(clip: TimelineClip): string | undefined {
  return clip.source?.mediaFileId ?? clip.mediaFileId;
}

function sanitizeStemPathPart(value: string, fallback: string): string {
  const sanitized = Array.from(value)
    .map((char) => (char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char) ? '_' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized.slice(0, 120) : fallback;
}

function stripFileExtension(value: string): string {
  const lastDot = value.lastIndexOf('.');
  return lastDot > 0 ? value.slice(0, lastDot) : value;
}

function stemFolderNameCandidates(clip: TimelineClip, mediaFile: MediaFile | undefined): Set<string> {
  const candidates = new Set<string>();
  const add = (value: string | undefined) => {
    if (!value) return;
    candidates.add(sanitizeStemPathPart(stripFileExtension(value), 'Source Clip').toLowerCase());
  };
  add(mediaFile?.name);
  add(mediaFile?.file?.name);
  add(clip.name);
  add(clip.file?.name);
  return candidates;
}

function getFolderPathParts(folderId: string | null | undefined, foldersById: Map<string, MediaFolder>): string[] {
  const parts: string[] = [];
  let currentId = folderId ?? null;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const folder = foldersById.get(currentId);
    if (!folder) break;
    parts.unshift(folder.name);
    currentId = folder.parentId;
  }
  return parts;
}

function inferLegacyStemChoice(
  stemFile: MediaFile,
  sourceClip: TimelineClip,
  sourceMediaFile: MediaFile | undefined,
  foldersById: Map<string, MediaFolder>,
): ClipStemSeparationJobStemChoice | null {
  if (stemFile.type !== 'audio') return null;
  const pathParts = getFolderPathParts(stemFile.parentId, foldersById);
  const sourceFolderName = pathParts.at(-1);
  const rootFolderName = pathParts.at(-2);
  const projectPath = stemFile.projectPath ?? stemFile.filePath ?? '';
  if (rootFolderName !== STEM_MEDIA_ROOT_FOLDER_NAME && !projectPath.replace(/\\/g, '/').startsWith(`${STEM_MEDIA_ROOT_FOLDER_NAME}/`)) {
    return null;
  }

  const folderCandidates = stemFolderNameCandidates(sourceClip, sourceMediaFile);
  const normalizedSourceFolder = sourceFolderName?.toLowerCase();
  if (!normalizedSourceFolder || !folderCandidates.has(normalizedSourceFolder)) {
    return null;
  }

  const stemBaseName = stripFileExtension(stemFile.name);
  const folderPrefix = `${sourceFolderName} - `;
  if (!stemBaseName.toLowerCase().startsWith(folderPrefix.toLowerCase())) {
    return null;
  }

  const label = stemBaseName.slice(folderPrefix.length).trim();
  const kind = STEM_LABEL_TO_KIND.get(label.toLowerCase());
  if (!kind) return null;

  return {
    id: `${stemFile.id}:${kind}`,
    kind,
    label,
    mediaFileId: stemFile.id,
  };
}

export function collectRelinkedStemChoicesForClip(
  sourceClip: TimelineClip,
  mediaFiles: readonly MediaFile[],
  folders: readonly MediaFolder[],
): { sourceMediaFileId: string; choices: ClipStemSeparationJobStemChoice[] } | null {
  const currentMediaFileId = getClipMediaFileId(sourceClip);
  if (!currentMediaFileId) return null;

  const mediaFilesById = new Map(mediaFiles.map(file => [file.id, file]));
  const foldersById = new Map(folders.map(folder => [folder.id, folder]));
  const currentMediaFile = mediaFilesById.get(currentMediaFileId);
  const sourceMediaFileId = currentMediaFile?.stemInfo?.sourceMediaFileId ?? currentMediaFileId;
  const sourceMediaFile = mediaFilesById.get(sourceMediaFileId);
  const choicesByMediaFileId = new Map<string, ClipStemSeparationJobStemChoice>();

  for (const file of mediaFiles) {
    const directInfo = file.stemInfo?.sourceMediaFileId === sourceMediaFileId
      ? file.stemInfo
      : undefined;
    const choice = directInfo
      ? {
          id: `${file.id}:${directInfo.kind}`,
          kind: directInfo.kind,
          label: directInfo.label,
          mediaFileId: file.id,
        }
      : inferLegacyStemChoice(file, sourceClip, sourceMediaFile, foldersById);
    if (!choice) continue;
    choicesByMediaFileId.set(choice.mediaFileId, choice);
  }

  const choices = Array.from(choicesByMediaFileId.values())
    .toSorted((a, b) => stemKindSortIndex(a.kind) - stemKindSortIndex(b.kind) || a.label.localeCompare(b.label));
  return choices.length > 0 ? { sourceMediaFileId, choices } : null;
}
