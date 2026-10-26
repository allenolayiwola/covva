"use client";

import * as React from "react";
import { track } from "./analytics";
import { EXPERIMENTS, resolveVariant, type ExperimentKey, type VariantOf } from "./experiments";

const exposed = new Set<string>();
const noop = () => () => {};

/**
 * Returns the visitor's variant for `key`. Control during server rendering and hydration, then the
 * resolved variant after mount (see experiments.ts). Reports one exposure event per page view.
 */
export function useExperiment<K extends ExperimentKey>(key: K): VariantOf<K> {
  const control = EXPERIMENTS[key].variants[0] as VariantOf<K>;
  // resolveVariant is idempotent per page: once an assignment is stored it returns the same value every call.
  const variant = React.useSyncExternalStore(noop, () => resolveVariant(key), () => control);
  React.useEffect(() => {
    const tag = `${key}:${location.pathname}`;
    if (exposed.has(tag)) return;
    exposed.add(tag);
    track("experiment_exposure", { experiment: key, variant });
  }, [key, variant]);
  return variant;
}

/**
 * Renders the variant's content. `variants` must include every variant of the experiment (TypeScript
 * enforces it), so a missing branch is a compile error rather than a blank section.
 */
export function Experiment<K extends ExperimentKey>({ name, variants }: { name: K; variants: Record<VariantOf<K>, React.ReactNode> }) {
  const variant = useExperiment(name);
  return <span data-experiment={name} data-variant={variant}>{variants[variant]}</span>;
}
