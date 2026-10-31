import Constants from 'expo-constants';
import type { Row } from '@im/db';
import { humanize, ROLE_STATEMENTS } from '@im/core';
import { Text } from 'react-native';
import { colors } from '@im/tokens';
import { ActionButton, Card, Copy, Screen } from '../../src/components/ui';
import { ReadState } from '../../src/components/read-state';
import { useApiRead } from '../../src/lib/use-api-read';
import { useAuth } from '../../src/providers/auth';

type Profile = Pick<Row<'profiles'>, 'full_name' | 'preferred_name' | 'email' | 'phone' | 'account_type' | 'business_name' | 'country_code' | 'preferred_currency' | 'timezone'>;
const settings = [
  ['Notification preferences', 'Notification preferences will be available in a future release.'],
  ['Privacy request', 'Data access and deletion requests are not yet available in this app. No request has been submitted.'],
  ['Help and complaints', 'Help and complaint submission will be available in a future release.'],
  ['Legal', 'Terms and privacy information will be available here in a future release.'],
];
export default function Account() {
  const { signOut } = useAuth();
  const result = useApiRead<{ profile: Profile | null }>('/me');
  const profile = result.data?.profile;
  return <Screen title="Account">
    <ReadState {...result} label="Loading your profile" />
    {result.data && <Card>
      {profile ? <>
        <Copy>Name: {profile.full_name || 'Not provided'}</Copy>
        {profile.preferred_name && <Copy>Preferred name: {profile.preferred_name}</Copy>}
        <Copy>Email: {profile.email || 'Not provided'}</Copy>
        <Copy>Phone: {profile.phone || 'Not provided'}</Copy>
        <Copy>Account type: {humanize(profile.account_type)}</Copy>
        {profile.business_name && <Copy>Business: {profile.business_name}</Copy>}
        <Copy>Country: {profile.country_code}</Copy>
        <Copy>Currency: {profile.preferred_currency}</Copy>
        <Copy>Time zone: {profile.timezone || 'Not provided'}</Copy>
        <Copy>Your profile is read-only in this app.</Copy>
      </> : <Copy>Your profile is not available.</Copy>}
    </Card>}
    {settings.map(([title, description]) => <Card key={title}>
      <Text accessibilityRole="header" style={{ fontSize: 20, fontWeight: '600', color: colors.ink }}>{title}</Text>
      <Copy>{description}</Copy>
    </Card>)}
    <Copy>{ROLE_STATEMENTS.platform}</Copy>
    <Copy>App version: {Constants.expoConfig?.version ?? 'Unavailable'}</Copy>
    <ActionButton title="Sign Out" action={signOut} />
  </Screen>;
}
