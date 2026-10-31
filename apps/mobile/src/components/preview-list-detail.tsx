import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { colors, radii } from '@im/tokens';
import { Card, Copy, Screen } from './ui';
import { useLayout } from '../lib/layout/use-layout';

const previewNotice = 'This is a preview screen. No policy or request data is shown.';

/** Scaffold-only entries, not policy/request records. Selection is independent of size. */
export function PreviewListDetail({ title, description }: { title: string; description: string }) {
  const { isWide } = useLayout();
  const [selected, setSelected] = useState<'overview' | 'availability'>('overview');
  const [contentWidth, setContentWidth] = useState(0);
  const split = isWide && contentWidth >= 552;
  return <Screen title={title} grid>
    <View onLayout={event => setContentWidth(event.nativeEvent.layout.width)} style={{ gap: 24, flexDirection: split ? 'row' : 'column' }}>
      <View style={{ display: isWide ? 'flex' : 'none', gap: 12, ...(split ? { width: '35%' } : {}) }}>
        {(['overview', 'availability'] as const).map(id => <Pressable key={id}
          accessibilityRole="button" accessibilityState={{ selected: selected === id }}
          onPress={() => setSelected(id)}
          style={{ padding: 20, minHeight: 54, borderRadius: radii.lg, borderWidth: 1, borderColor: selected === id ? colors.brand : colors.line, backgroundColor: colors.white }}>
          <Text style={{ color: colors.ink, fontSize: 16 }}>{id === 'overview' ? title : 'Preview Availability'}</Text>
        </Pressable>)}
      </View>
      <View style={{ flex: split ? 1 : undefined, minWidth: 0 }}>
        <Card>
          <View style={{ display: !isWide || selected === 'overview' ? 'flex' : 'none' }}><Copy>{description}</Copy></View>
          <View style={{ display: !isWide || selected === 'availability' ? 'flex' : 'none' }}><Copy>{previewNotice}</Copy></View>
        </Card>
      </View>
    </View>
  </Screen>;
}
