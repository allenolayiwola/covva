import { useState } from 'react';
import { Linking, Switch, View } from 'react-native';
import { ROLE_STATEMENTS } from '@im/core';
import { colors } from '@im/tokens';
import { ActionButton, Card, Copy, Screen } from '../src/components/ui';
import { useAuth } from '../src/providers/auth';
import { api } from '../src/lib/api';
import { env } from '../src/lib/env';

export default function Consent() {
  const { me, reload, signOut } = useAuth();
  const [accepted, setAccepted] = useState(false);
  async function accept() {
    if (!accepted || !me) throw new Error('Please read and accept the terms and privacy notice.');
    await api('/me/consents', { method: 'POST', body: JSON.stringify({ consents: (['terms', 'privacy'] as const).map(type => ({ type, granted: true, ...(me.versions[type] ? { version: me.versions[type] } : {}), context: 'mobile' })) }) });
    await api('/me', { method: 'PATCH', body: JSON.stringify({ onboarded: true }) });
    reload();
  }
  return <Screen title="Before You Continue"><Copy>{ROLE_STATEMENTS.platform}</Copy><Card>
    <Copy>Read our terms and privacy notice before using your account.</Copy>
    <ActionButton title="Read Terms" secondary action={() => Linking.openURL(`${env.siteUrl.replace(/\/$/, '')}/legal/terms`)} />
    <ActionButton title="Read Privacy Notice" secondary action={() => Linking.openURL(`${env.siteUrl.replace(/\/$/, '')}/legal/privacy`)} />
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Switch accessibilityLabel="I accept the terms and privacy notice" value={accepted} onValueChange={setAccepted} trackColor={{ true: colors.brand }} /><View style={{ flex: 1 }}><Copy>I accept the terms and privacy notice.</Copy></View></View>
    <ActionButton title="Agree And Continue" action={accept} />
  </Card><ActionButton title="Sign Out" secondary action={signOut} /></Screen>;
}
