import { Tabs } from 'expo-router';
import { colors } from '@im/tokens';
import { useLayout } from '../../src/lib/layout/use-layout';
export default function TabLayout() {
  const { hasRail, isWide } = useLayout();
  return <Tabs screenOptions={{ headerShown: false, tabBarPosition: hasRail ? 'left' : 'bottom', tabBarLabelPosition: hasRail ? 'beside-icon' : isWide ? 'below-icon' : undefined, tabBarActiveTintColor: colors.brand, tabBarInactiveTintColor: colors.subtle, tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.line, ...(hasRail ? { width: 180 } : isWide ? { minHeight: 80 } : {}) }, tabBarLabelStyle: { fontSize: isWide ? 16 : 12 } }}>
    <Tabs.Screen name="index" options={{ title: 'Explore' }} />
    <Tabs.Screen name="my-cover" options={{ title: 'My Cover' }} />
    <Tabs.Screen name="requests" options={{ title: 'Requests' }} />
    <Tabs.Screen name="account" options={{ title: 'Account' }} />
  </Tabs>;
}
