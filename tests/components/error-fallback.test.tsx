import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ErrorFallback } from '@/components/ErrorFallback';

const error = new Error('boom') as Error & { digest: string };
error.digest = 'abc123';

function renderFallback(props: Partial<Parameters<typeof ErrorFallback>[0]> = {}) {
  return render(
    <ErrorFallback
      error={error}
      retry={props.retry ?? vi.fn()}
      title={props.title}
      description={props.description}
    />,
  );
}

describe('ErrorFallback', () => {
  it('calls retry (not reset) when Try again is clicked', () => {
    const retry = vi.fn();
    renderFallback({ retry });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('renders the digest when present', () => {
    renderFallback();
    expect(screen.getByText('Reference:')).toBeInTheDocument();
    expect(screen.getByText('abc123')).toBeInTheDocument();
  });

  it('logs the render error once per error change', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderFallback();
    expect(spy).toHaveBeenCalledWith(
      '[render error]',
      expect.objectContaining({ message: 'boom', digest: 'abc123' }),
    );
    spy.mockRestore();
  });

  it('renders title and description', () => {
    renderFallback({ title: 'Custom title', description: 'Custom description' });
    expect(screen.getByText('Custom title')).toBeInTheDocument();
    expect(screen.getByText('Custom description')).toBeInTheDocument();
  });
});
