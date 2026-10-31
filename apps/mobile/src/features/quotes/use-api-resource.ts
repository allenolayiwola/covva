import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';

export function useApiResource<T>(path: string): { data?: T; error?: Error; loading: boolean; reload: () => void } {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ path: string; attempt: number; data?: T; error?: Error; loading: boolean }>({ path, attempt: 0, loading: true });
  useEffect(() => {
    const controller = new AbortController();
    void api<T>(path, { signal: controller.signal }).then(
      data => { if (!controller.signal.aborted) setState({ path, attempt, data, loading: false }); },
      error => { if (!controller.signal.aborted) setState({ path, attempt, error: error instanceof Error ? error : new Error('Please try again.'), loading: false }); },
    );
    return () => controller.abort();
  }, [path, attempt]);
  const reload = useCallback(() => setAttempt(n => n + 1), []);
  return { ...(state.path === path && state.attempt === attempt ? state : { loading: true }), reload };
}
