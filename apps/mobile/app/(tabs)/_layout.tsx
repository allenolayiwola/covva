import { Tabs } from 'expo-router';
import { colors } from '@im/tokens';
export default function TabLayout() {
  return <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: colors.brand, tabBarInactiveTintColor: colors.subtle, tabBarStyle: { backgroundColor: colors.white, borderTopColor: colors.line }, tabBarLabelStyle: { fontSize: 12 } }}>
    <Tabs.Screen name="index" options={{ title: 'Explore' }} />
    <Tabs.Screen name="my-cover" options={{ title: 'My Cover' }} />
    <Tabs.Screen name="requests" options={{ title: 'Requests' }} />
    <Tabs.Screen name="account" options={{ title: 'Account' }} />
  </Tabs>;
}
