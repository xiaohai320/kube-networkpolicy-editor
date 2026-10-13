// @vitest-environment happy-dom

import { cleanup, renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useTheme } from '@/hooks/useTheme';

beforeEach(() => {
  localStorage.clear();
});

afterEach(cleanup);

describe('useTheme', () => {
  it('defaults to the light palette', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('ignores a preference saved under the old storage key', () => {
    localStorage.setItem('netpol-theme', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
  });

  it('honours a preference saved under the current key', () => {
    localStorage.setItem('netpol-theme.v2', 'dark');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('toggles between the two and persists to the current key', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe('dark');
    expect(localStorage.getItem('netpol-theme.v2')).toBe('dark');
  });
});
