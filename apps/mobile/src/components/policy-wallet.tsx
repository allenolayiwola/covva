import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { DEMO_DISCLAIMER, formatDate, formatGHS, POLICY_STATUS } from '@im/core';
import { colors, radii, tones } from '@im/tokens';
import { ActionButton, Button, Card, Copy, Screen } from './ui';
import { ReadState } from './read-state';
import { useLayout } from '../lib/layout/use-layout';
import { useApiRead } from '../lib/use-api-read';
import { policyStatus, policyTitle, renewalDueDays, type Policy, type PolicyDetail, type PolicyDocuments } from '../lib/policies';
import { api } from '../lib/api';
import { openDocument } from '../lib/browser';

function PolicySummary({ policy }: { policy: Policy }) {
  const status = policyStatus(policy);
  const tone = tones[status.tone];
  const days = renewalDueDays(policy);
  return <>
    <Text style={styles.heading}>{policyTitle(policy)}</Text>
    <Text style={[styles.badge, { color: tone.fg, backgroundColor: tone.bg }]}>{status.label}</Text>
    <Copy>{policy.insurer?.name ?? policy.external_insurer_name ?? 'Insurer not listed'}</Copy>
    {policy.demo && <Copy>{DEMO_DISCLAIMER}</Copy>}
    <Copy>Policy number: {policy.policy_number ?? policy.internal_reference}</Copy>
    <Copy>Cover starts: {formatDate(policy.cover_start)}</Copy>
    <Copy>Cover ends: {formatDate(policy.cover_end)}</Copy>
    <Copy>Premium: {formatGHS(policy.premium)}{policy.billing_period ? ` / ${policy.billing_period}` : ''}</Copy>
    {days !== null && <Text style={[styles.badge, styles.renewal]}>Renewal due {days === 0 ? 'today' : `in ${days} day${days === 1 ? '' : 's'}`}</Text>}
    {(policy.statusHint || POLICY_STATUS[policy.status].customerHint) && <Copy>{policy.statusHint || POLICY_STATUS[policy.status].customerHint}</Copy>}
    {policy.external_source && <Copy>Added by you. Cover has not been confirmed by Covva.</Copy>}
  </>;
}
function Documents({ id }: { id: string }) {
  const result = useApiRead<PolicyDocuments>(`/policies/${encodeURIComponent(id)}/documents`);
  return <Card>
    <Text accessibilityRole="header" style={styles.heading}>Documents</Text>
    <ReadState {...result} label="Loading policy documents" />
    {result.data?.documents.length === 0 && <Copy>No documents are available yet.</Copy>}
    {result.data?.documents.map(document => <View key={document.id} style={{ gap: 8 }}>
      {document.url ? <ActionButton title={`Open ${document.fileName}`} secondary action={async () => {
        // Obtain a fresh URL on every tap: a wallet can remain open beyond the signed URL's lifetime.
        const fresh = await api<{ url: string }>(`/documents/${encodeURIComponent(document.id)}/url`);
        await openDocument(fresh.url);
      }} /> : <Copy>{document.fileName} — link unavailable</Copy>}
    </View>)}
  </Card>;
}
function Detail({ id }: { id: string }) {
  const result = useApiRead<PolicyDetail>(`/policies/${encodeURIComponent(id)}`);
  return <View style={styles.column}>
    <ReadState {...result} label="Loading policy detail" />
    {result.data && <><Card><PolicySummary policy={result.data.policy} /></Card>
      {result.data.disclosure && <Card><Copy>{result.data.disclosure}</Copy></Card>}
      <Documents id={id} />
    </>}
  </View>;
}
export function PolicyWallet({ selectedId }: { selectedId?: string }) {
  const { hasRail } = useLayout();
  const router = useRouter();
  return <Screen title="Policies" grid>
    {selectedId && <Button title="All Policies" secondary onPress={() => router.replace('/policies')} />}
    <View testID="policy-layout" style={[styles.column, hasRail && styles.split]}>
      {(hasRail || !selectedId) && <View style={[styles.column, hasRail && styles.list]}><PolicyList selectedId={selectedId} /></View>}
      {(hasRail || selectedId) && <View style={styles.detail}>
        {selectedId ? <Detail key={selectedId} id={selectedId} /> : <Card><Copy>Select a policy to see its details and documents.</Copy></Card>}
      </View>}
    </View>
  </Screen>;
}
function PolicyList({ selectedId }: { selectedId?: string }) {
  const result = useApiRead<Policy[]>('/policies');
  const router = useRouter();
  return <>
    <ReadState {...result} label="Loading policies" />
    {result.data?.length === 0 && <Card><Copy>No policies yet. Your policies will appear here when they are available.</Copy></Card>}
    {result.data && <Button title="Refresh Policies" secondary onPress={result.retry} />}
    {result.data?.map(policy => <Pressable key={policy.id} accessibilityRole="button"
      accessibilityLabel={`View ${policyTitle(policy)}, ${policyStatus(policy).label}`}
      accessibilityState={{ selected: policy.id === selectedId }}
      onPress={() => router.replace({ pathname: '/policies/[id]', params: { id: policy.id } })}
      style={({ pressed }) => [styles.policy, { borderColor: policy.id === selectedId ? colors.brand : colors.line, opacity: pressed ? 0.7 : 1 }]}>
      <PolicySummary policy={policy} />
    </Pressable>)}
  </>;
}
const styles = StyleSheet.create({
  column: { gap: 20 }, split: { flexDirection: 'row', alignItems: 'flex-start' },
  list: { flex: 1, minWidth: 0 }, detail: { flex: 1, minWidth: 0 },
  heading: { color: colors.ink, fontSize: 20, fontWeight: '600' },
  badge: { alignSelf: 'flex-start', padding: 8, borderRadius: radii.sm, fontSize: 14 },
  renewal: { color: colors.amber, backgroundColor: colors.amberBg },
  policy: { gap: 12, padding: 16, borderWidth: 1, borderRadius: radii.lg, backgroundColor: colors.white, minHeight: 44 },
});
