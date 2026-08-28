import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n';
import type { AtlasAsset } from '../model';
import { MediaPanel } from './MediaPanel';

const failedAsset: AtlasAsset = {
  id: 'asset-1', name: 'take.mp4', kind: 'video', mimeType: 'video/mp4', size: 10,
  duration: 10, status: 'failed', source: 'local', error: 'network',
};

describe('MediaPanel read-only boundary', () => {
  it('disables every mutating entry while preserving harmless selection', async () => {
    const callbacks = { onSelect: vi.fn(), onFiles: vi.fn(), onAddTimeline: vi.fn(), onRetry: vi.fn(), onRelink: vi.fn(), onImported: vi.fn() };
    const { container } = render(
      <I18nProvider locale="zh-CN">
        <MediaPanel readOnly projectId="project-1" assets={[failedAsset]} selectedAssetId={null} {...callbacks} />
      </I18nProvider>,
    );
    const user = userEvent.setup();
    expect((screen.getByRole('button', { name: /本地素材/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /资产库/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /重试归档/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /加入时间线/ }) as HTMLButtonElement).disabled).toBe(true);
    expect((container.querySelector('input[type="file"]') as HTMLInputElement | null)?.disabled).toBe(true);
    expect(container.querySelector('article[draggable="false"]')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: /预览.*take.mp4/ }));
    expect(callbacks.onSelect).toHaveBeenCalledWith('asset-1');
    expect(callbacks.onFiles).not.toHaveBeenCalled();
    expect(callbacks.onAddTimeline).not.toHaveBeenCalled();
    expect(callbacks.onRetry).not.toHaveBeenCalled();
    expect(callbacks.onRelink).not.toHaveBeenCalled();
    expect(callbacks.onImported).not.toHaveBeenCalled();
  });
});
