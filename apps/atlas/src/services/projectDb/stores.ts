// Store names
export const STORES = {
  MEDIA_FILES: 'mediaFiles',
  PROJECTS: 'projects',
  PROXY_FRAMES: 'proxyFrames', // Legacy proxy-frame store kept for cleanup/migration
  FS_HANDLES: 'fsHandles', // Store for FileSystemHandles (directories, files)
  ANALYSIS_CACHE: 'analysisCache', // Cache for clip analysis data
  THUMBNAILS: 'thumbnails', // Deduplicated thumbnails by file hash
  SOURCE_THUMBNAILS: 'sourceThumbnails', // 1-per-second source thumbnail cache
  ARTIFACTS: 'artifacts', // Content-addressed artifact manifest index
  ARTIFACT_BLOBS: 'artifactBlobs', // Content-addressed artifact bytes
} as const;
