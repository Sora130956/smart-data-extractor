import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import '@/i18n';
import App from './App';
import { LANGUAGE_STORAGE_KEY } from '@/i18n';
import { THEME_STORAGE_KEY } from '@/store/uiStore';

function renderApp() {
  return render(<App />);
}

describe('F1 shell', () => {
  it('renders the guidance empty state instead of an empty table (§8.8)', () => {
    renderApp();
    expect(screen.getByText('No extractions yet')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('switches language and persists the choice (§8.7)', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: '中文' }));

    expect(screen.getByText('还没有提取结果')).toBeInTheDocument();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('zh');

    await user.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByText('No extractions yet')).toBeInTheDocument();
  });

  it('toggles the theme onto the document root and persists it', async () => {
    const user = userEvent.setup();
    renderApp();

    await user.click(screen.getByRole('button', { name: /theme/i }));

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('disables export while there are no results', () => {
    renderApp();
    expect(screen.getByRole('button', { name: /Export All JSON/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Export Excel/ })).toBeDisabled();
  });
});
