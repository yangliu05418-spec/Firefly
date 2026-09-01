import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BloubAvatar } from '../BloubAvatar';

describe('BloubAvatar', () => {
  it('renders the reused SVG engine and exposes a stable accessible label', () => {
    vi.spyOn(window, 'matchMedia').mockReturnValue({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList);

    const { container, rerender } = render(<BloubAvatar state="idle" />);
    expect(screen.getByRole('img', { name: 'Atlas Agent 状态' })).toBeInTheDocument();
    expect(container.querySelector('mask path')).toHaveAttribute('d');

    rerender(<BloubAvatar state="thinking" />);
    expect(container.querySelectorAll('svg')).toHaveLength(1);
  });
});
