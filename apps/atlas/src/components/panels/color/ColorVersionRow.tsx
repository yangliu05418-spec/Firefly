import type { ColorEditorVersion } from './colorEditorTypes';

interface ColorVersionRowProps {
  versions: ColorEditorVersion[];
  activeVersionId: string;
  onSelectVersion: (versionId: string) => void;
  onDeleteVersion: (versionId: string) => void;
  onDuplicateVersion: () => void;
}

export function ColorVersionRow({
  versions,
  activeVersionId,
  onSelectVersion,
  onDeleteVersion,
  onDuplicateVersion,
}: ColorVersionRowProps) {
  return (
    <div className="color-version-row">
      {versions.map(version => (
        <div
          key={version.id}
          className={`color-version-pill ${version.id === activeVersionId ? 'active' : ''}`}
        >
          <button
            className="color-version-select"
            type="button"
            onClick={() => onSelectVersion(version.id)}
          >
            {version.name}
          </button>
          {versions.length > 1 && (
            <button
              className="color-version-delete"
              type="button"
              onClick={() => onDeleteVersion(version.id)}
              title={`Delete version ${version.name}`}
              aria-label={`Delete version ${version.name}`}
            >
              x
            </button>
          )}
        </div>
      ))}
      <button type="button" onClick={onDuplicateVersion}>New Version</button>
    </div>
  );
}
