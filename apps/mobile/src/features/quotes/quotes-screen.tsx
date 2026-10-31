import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { buildDisclosure, DEMO_DISCLAIMER, formatGHS, LABELS, QUOTE_STATUS } from '@im/core';
import { Button, Card, Copy, Screen } from '../../components/ui';
import { Badge, ListDetail, ResourceState } from './components';
import { canApply, comparisonCopy, type Quote, type QuotesResponse } from './model';
import { useApiResource } from './use-api-resource';

function timestamp(value: string | null) {
  if (!value) return 'Not specified';
  return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-GB') : 'Not available';
}
function QuoteHeading({ quote, demoMode }: { quote: Quote; demoMode: boolean }) {
  return <><Copy>{quote.insurer?.name ?? 'Insurer not specified'} · {quote.product?.name ?? 'Quote'}</Copy>
    <Copy>{formatGHS(Number(quote.premium))}</Copy>
    {demoMode || quote.demo ? <Copy>{DEMO_DISCLAIMER}</Copy> : null}
    <Badge label={quote.statusLabel} tone={QUOTE_STATUS[quote.status].tone} />
    <Copy>Valid until: {timestamp(quote.valid_until)}</Copy>
  </>;
}
function QuoteDetail({ quote, data, now }: { quote: Quote; data: QuotesResponse; now: number }) {
  const ranked = data.comparison.ranked.find(row => row.quote.id === quote.id);
  const disclosure = data.broker ? buildDisclosure({ broker: { name: data.broker.name, licence: data.broker.nic_licence_number }, insurer: quote.insurer }) : null;
  const apply = canApply(quote, now);
  return <Card>
    <QuoteHeading quote={quote} demoMode={data.demoMode} />
    {quote.paid_placement ? <Badge label="Paid placement · Separate from comparison ranking" /> : null}
    {quote.statusHint ? <Copy>{quote.statusHint}</Copy> : null}
    {!apply && (quote.expired || (quote.valid_until && Date.parse(quote.valid_until) <= now)) ? <Copy>This quote has expired. Refresh for the latest quotes.</Copy> : null}
    {ranked && !quote.paid_placement ? <>
      {ranked.labels.map(label => <Copy key={label}>{LABELS[label]}</Copy>)}
      <Copy>Ranking uses premium, excess, included cover, stated benefit and waiting period with the weights shown in the comparison.</Copy>
      {ranked.reasons.map(reason => <Copy key={reason}>{reason}</Copy>)}
    </> : null}
    <Copy>Excess: {quote.excess === null ? 'Not specified' : formatGHS(Number(quote.excess))}</Copy>
    <Copy>Sum insured: {quote.sum_insured === null ? 'Not specified' : formatGHS(Number(quote.sum_insured))}</Copy>
    <Copy>Waiting period: {quote.waiting_period_days} days</Copy>
    <Copy>Cover</Copy>{quote.coverage?.length ? quote.coverage.map(item => <Copy key={item.key}>{item.label}: {item.included ? 'Included' : 'Not included'}</Copy>) : <Copy>No cover details supplied.</Copy>}
    <Copy>Exclusions</Copy>{quote.key_exclusion ? <Copy>Key exclusion: {quote.key_exclusion}</Copy> : null}
    {quote.exclusions?.length ? quote.exclusions.map((item, i) => <Copy key={i}>{item}</Copy>) : <Copy>No exclusions supplied. Check the policy terms with your broker.</Copy>}
    {quote.optional_benefits?.map(benefit => <Copy key={benefit.key}>Optional: {benefit.label}{benefit.premium !== undefined ? ` · ${formatGHS(benefit.premium)}` : ''}</Copy>)}
    <Copy>{disclosure ?? data.disclosure ?? 'Your broker of record has not yet been assigned. Broker disclosure will be available before application.'}</Copy>
    <Copy>Not yet active. Cover starts when the insurer issues the policy.</Copy>
    {apply ? <Button title="Apply" onPress={() => {
      // Re-check at the tap, including after the app has been in the background.
      if (canApply(quote)) router.push({ pathname: '/(tabs)/requests', params: { requestId: data.request.id, applyQuoteId: quote.id } });
    }} /> : null}
  </Card>;
}
function RequestQuotes({ id }: { id: string }) {
  const resource = useApiResource<QuotesResponse>(`/requests/${encodeURIComponent(id)}/quotes`);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const data = resource.data;
  const selected = data?.quotes.find(quote => quote.id === selectedId);
  const rows = (quotes: Quote[]) => quotes.map(quote => <Card key={quote.id}>
    <QuoteHeading quote={quote} demoMode={data?.demoMode ?? false} />
    <Button title="View Quote" secondary={selectedId !== quote.id} onPress={() => setSelectedId(quote.id)} />
  </Card>);
  const organic = data?.quotes.filter(quote => !quote.paid_placement) ?? [];
  // Preserve the server's ranking; retain non-live quotes after ranked entries.
  const rank = new Map(data?.comparison.ranked.map((row, i) => [row.quote.id, i]));
  organic.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
  return <>
    <Button title="Back to Requests" secondary onPress={() => router.setParams({ requestId: '', applyQuoteId: '' })} />
    <ResourceState {...resource} />
    {data ? <>
      <Card><Copy>{data.request.reference}</Copy><Copy>{data.summary}</Copy><Copy>{comparisonCopy(data.comparison.insurersCompared)}</Copy>
        <Copy>{data.comparison.disclaimer}</Copy><Copy>Compared at: {timestamp(data.comparedAt)}</Copy>
        <Copy>Ranking weights: {Object.entries(data.comparison.criteria).map(([key, weight]) => `${key} ${Math.round(weight * 100)}%`).join(' · ')}</Copy>
        <Copy>{data.disclosure ?? (data.broker ? buildDisclosure({ broker: { name: data.broker.name, licence: data.broker.nic_licence_number } }) : 'Your broker of record has not yet been assigned. Broker disclosure will be available before application.')}</Copy>
        {data.demoMode ? <Copy>{data.demoDisclaimer ?? DEMO_DISCLAIMER}</Copy> : null}
      </Card>
      {!data.quotes.length ? <Copy>No quotes yet. Your request is saved; check back for insurer responses.</Copy> : null}
      <ListDetail selected={!!selected} onBack={() => setSelectedId(null)} list={<>
        {rows(organic)}
        {data.quotes.some(quote => quote.paid_placement) ? <><Copy>Paid placements · Separate from comparison ranking</Copy>{rows(data.quotes.filter(quote => quote.paid_placement))}</> : null}
      </>} detail={selected ? <QuoteDetail quote={selected} data={data} now={now} /> : <Copy>Select a quote to see cover, exclusions and disclosure.</Copy>} />
      <Button title="Refresh Quotes" secondary onPress={resource.reload} />
    </> : null}
  </>;
}
function RequestsList() {
  const resource = useApiResource<{ items: { id: string; reference: string; title: string | null; statusLabel: string; next_step: string | null }[] }>('/requests');
  return <><ResourceState {...resource} />{resource.data?.items.length === 0 ? <Copy>No requests yet. Explore a category to get a quote.</Copy> : null}
    {resource.data?.items.map(request => <Card key={request.id}><Copy>{request.title ?? request.reference}</Copy><Badge label={request.statusLabel} /><Copy>{request.next_step}</Copy>
      <Button title="View Quotes" onPress={() => router.push({ pathname: '/(tabs)/requests', params: { requestId: request.id } })} />
    </Card>)}{resource.data ? <Button title="Refresh Requests" secondary onPress={resource.reload} /> : null}</>;
}
export function QuotesScreen() {
  const params = useLocalSearchParams<{ requestId?: string; applyQuoteId?: string }>();
  const requestId = typeof params.requestId === 'string' ? params.requestId : '';
  const applying = typeof params.applyQuoteId === 'string' && !!params.applyQuoteId;
  return <Screen title={applying ? 'Application Preview' : requestId ? 'Compare Quotes' : 'Requests'} grid>
    {applying ? <Card><Copy>Applications will be available in a future release. No application has been submitted and no payment has been taken.</Copy>
      <Copy>Not yet active. Cover starts when the insurer issues the policy.</Copy>
      <Button title="Back to Quotes" onPress={() => router.setParams({ applyQuoteId: '' })} />
    </Card> : requestId ? <RequestQuotes key={requestId} id={requestId} /> : <RequestsList />}
  </Screen>;
}
