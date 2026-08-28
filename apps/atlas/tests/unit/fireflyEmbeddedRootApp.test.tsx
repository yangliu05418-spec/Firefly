import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const appRender = vi.hoisted(() => vi.fn());

vi.mock('../../src/FireflyEmbeddedEditor', () => ({
  default: (props: unknown) => {
    appRender(props);
    return <div>original-editor-runtime</div>;
  },
}));

vi.mock('../../src/components/common/LegalDialog', () => ({
  LegalDialog: () => <div>legacy-legal-page</div>,
}));

import { RootApp } from '../../src/RootApp';

describe('Firefly embedded RootApp boundary', () => {
  it('always mounts the original editor runtime and forwards the Firefly context', async () => {
    const fireflyEmbedded = {
      user: {
        name: '九久',
        email: 'jiujiu@dokuai.tv',
      },
      projectId: 'atlas-project-1',
      capabilities: { agent: true, generate: true },
      onBackToProjects: vi.fn(),
    };

    render(
      <RootApp
        initialExperience="admin"
        fireflyEmbedded={fireflyEmbedded}
      />,
    );

    expect(await screen.findByText('original-editor-runtime')).toBeInTheDocument();
    expect(screen.queryByText('legacy-legal-page')).not.toBeInTheDocument();
    expect(appRender).toHaveBeenCalledWith({ fireflyEmbedded });
  });
});
