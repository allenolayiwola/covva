import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { api } from './api';

/** Refresh on focus/retry; ignore responses for routes that are no longer visible. */
export function useApiRead<T>(path: string) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{ path: string; revision: number; data?: T; error?: string }>({ path, revision });
  useFocusEffect(useCallback(() => {
    let active = true;
    setState({ path, revision });
    void api<T>(path).then(data => {
      if (active) setState({ path, revision, data });
    }).catch((error: unknown) => {
      if (active) setState({ path, revision, error: error instanceof Error ? error.message : 'Please try again.' });
    });
    return () => { active = false; };
  }, [path, revision]));
  const current: typeof state = state.path === path && state.revision === revision ? state : { path, revision };
  return { ...current, loading: current.data === undefined && current.error === undefined, retry: () => setRevision(n => n + 1) };
}
