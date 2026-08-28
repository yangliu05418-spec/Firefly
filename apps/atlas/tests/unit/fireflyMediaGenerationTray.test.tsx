import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FireflyMediaGenerationTray } from '../../src/components/panels/media/FireflyMediaGenerationTray';
import { FireflyEmbeddingProvider } from '../../src/firefly/FireflyEmbeddingContext';
import { FIREFLY_ATLAS_MEDIA_REFRESH_EVENT } from '../../src/firefly/FireflyGeneratedMediaBridge';

const embedding = {
  user: { id: 'user-1', name: '九久', email: 'jiujiu@dokuai.tv' },
  projectId: 'project-1',
  capabilities: { agent: true, generate: true },
  onBackToProjects: vi.fn(),
};

describe('Firefly Atlas generation tray', () => {
  it('exposes only Generate and keeps the same iframe mounted while collapsed', () => {
    const onExpandedChange = vi.fn();
    const { rerender } = render(
      <FireflyEmbeddingProvider value={embedding}>
        <FireflyMediaGenerationTray expanded={false} onExpandedChange={onExpandedChange} />
      </FireflyEmbeddingProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    expect(onExpandedChange).toHaveBeenCalledWith(true);
    expect(screen.queryByText('Chat')).not.toBeInTheDocument();
    expect(screen.queryByText('Downloads')).not.toBeInTheDocument();
    const frame = screen.getByTitle('Firefly 生成素材');
    expect(frame).toHaveAttribute('src', '/studio/generate-embed/?projectId=project-1');

    rerender(
      <FireflyEmbeddingProvider value={embedding}>
        <FireflyMediaGenerationTray expanded onExpandedChange={onExpandedChange} />
      </FireflyEmbeddingProvider>,
    );
    expect(screen.getByTitle('Firefly 生成素材')).toBe(frame);
  });

  it('accepts output messages only from the mounted same-origin iframe', () => {
    const onExpandedChange = vi.fn();
    const refresh = vi.fn();
    window.addEventListener(FIREFLY_ATLAS_MEDIA_REFRESH_EVENT, refresh);
    render(
      <FireflyEmbeddingProvider value={embedding}>
        <FireflyMediaGenerationTray expanded onExpandedChange={onExpandedChange} />
      </FireflyEmbeddingProvider>,
    );
    const frame = screen.getByTitle<HTMLIFrameElement>('Firefly 生成素材');
    const message = { channel: 'firefly.atlas.generate.v1', type: 'OUTPUT_READY', projectId: 'project-1' };

    window.dispatchEvent(new MessageEvent('message', { origin: 'https://attacker.invalid', source: frame.contentWindow, data: message }));
    window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: window, data: message }));
    window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: { ...message, projectId: 'other-project' } }));
    expect(refresh).not.toHaveBeenCalled();

    window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: message }));
    expect(refresh).toHaveBeenCalledOnce();
    window.removeEventListener(FIREFLY_ATLAS_MEDIA_REFRESH_EVENT, refresh);
  });
});
