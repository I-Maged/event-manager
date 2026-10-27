import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

function Harness() {
  return <button type="button">Ready</button>;
}

describe('component harness', () => {
  it('renders with Testing Library and jest-dom matchers', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Ready' })).toBeInTheDocument();
  });
});
