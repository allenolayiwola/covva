import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Linking } from 'react-native';
import { AuthProvider, useAuth } from '../src/providers/auth';
import { ActionButton, Button, Loading, Notice, Screen } from '../src/components/ui';
import { ApiError } from '../src/lib/api';

function Routes() {
  const auth = useAuth();
  if (auth.loading) return <Loading />;
  if (auth.error) {
    const details = auth.error instanceof ApiError ? auth.error.details as { reason?: string; portalUrl?: string } | undefined : undefined;
    const portal = details?.reason === 'insurer_web_only' && details.portalUrl?.startsWith('https://') ? details.portalUrl : null;
    return <Screen title="Your Account"><Notice message={auth.error.message} />{portal ? <ActionButton title="Open Insurer Portal" action={() => Linking.openURL(portal)} /> : <Button title="Try Again" onPress={auth.reload} />}<ActionButton title="Sign Out" action={auth.signOut} secondary /></Screen>;
  }
  return <Stack screenOptions={{ headerShown: false }}>
    <Stack.Protected guard={!auth.session}><Stack.Screen name="sign-in" /></Stack.Protected>
    <Stack.Protected guard={!!auth.session && !!auth.me?.needsConsent}><Stack.Screen name="consent" /></Stack.Protected>
    <Stack.Protected guard={!!auth.session && !!auth.me && !auth.me.needsConsent}><Stack.Screen name="(tabs)" /></Stack.Protected>
  </Stack>;
}
export default function RootLayout() { return <SafeAreaProvider><AuthProvider><StatusBar style="dark" /><Routes /></AuthProvider></SafeAreaProvider>; }
