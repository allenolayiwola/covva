import { ROLE_STATEMENTS } from '@im/core';
import { ActionButton, Card, Copy, Screen } from '../../src/components/ui';
import { useAuth } from '../../src/providers/auth';
export default function Account() {
  const { session, signOut } = useAuth();
  return <Screen title="Account"><Card><Copy>{session?.user.email ?? session?.user.phone ?? 'Your Account'}</Copy><Copy>Account settings will be available in a future release.</Copy></Card><Copy>{ROLE_STATEMENTS.platform}</Copy><ActionButton title="Sign Out" action={signOut} /></Screen>;
}
