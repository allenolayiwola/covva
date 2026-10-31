import type { ReactNode } from 'react';
import { ActivityIndicator, Linking, Text, View } from 'react-native';
import { colors, radii, tones } from '@im/tokens';
import { ActionButton, Button, Notice } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { useLayout } from '../../lib/layout/use-layout';
import { isListDetail } from '../../lib/layout';

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: keyof typeof tones }) {
  return <Text style={{ alignSelf: 'flex-start', padding: 8, borderRadius: radii.pill, backgroundColor: tones[tone].bg, color: tones[tone].fg }}>{label}</Text>;
}
export function ResourceState({ loading, error, reload }: { loading: boolean; error?: Error; reload: () => void }) {
  const details = error instanceof ApiError ? error.details as { reason?: string; portalUrl?: string } | undefined : undefined;
  const portal = details?.reason === 'insurer_web_only' && details.portalUrl?.startsWith('https://') ? details.portalUrl : null;
  return <>{loading ? <ActivityIndicator accessibilityLabel="Loading" color={colors.brand} /> : null}<Notice message={error?.message ?? null} />{error ? portal ? <ActionButton title="Open Insurer Portal" action={() => Linking.openURL(portal)} /> : <Button title="Try Again" onPress={reload} /> : null}</>;
}

/** Keep detail mounted across resizing so a risk form never loses edits. */
export function ListDetail({ list, detail, selected, onBack }: { list: ReactNode; detail: ReactNode; selected: boolean; onBack: () => void }) {
  const { width } = useLayout();
  const split = isListDetail(width);
  return <View style={{ flexDirection: split ? 'row' : 'column', gap: 20 }}>
    <View style={{ display: split || !selected ? 'flex' : 'none', gap: 16, ...(split ? { width: '36%' } : {}) }}>{list}</View>
    <View style={{ display: split || selected ? 'flex' : 'none', flex: split ? 1 : undefined, minWidth: 0, gap: 16 }}>
      {!split && selected ? <Button title="Back to List" secondary onPress={onBack} /> : null}{detail}
    </View>
  </View>;
}
