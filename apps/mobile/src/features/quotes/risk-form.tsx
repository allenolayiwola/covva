import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { GHANA_REGIONS, normaliseRegistration, prefillFromLookup, quickQuoteFields, type RiskField, type VehicleData } from '@im/core';
import { Button, Card, Copy, Field, Notice } from '../../components/ui';
import { api, ApiError } from '../../lib/api';
import { ResourceState } from './components';
import { fieldErrors, validateRisk, type Category, type FormValues } from './model';

function RiskControl({ field, value, onChange, error, disabled }: { field: RiskField; value: string | string[]; onChange: (value: string | string[]) => void; error?: string; disabled: boolean }) {
  const options = field.type === 'region' ? GHANA_REGIONS.map(value => ({ value, label: value }))
    : field.type === 'boolean' ? [{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }] : field.options;
  const choice = ['region', 'boolean', 'select', 'multiselect'].includes(field.type);
  return <View style={{ gap: 8 }}>
    {choice ? <><Copy>{field.label}{field.required ? ' *' : ''}</Copy>{options?.map(option => {
      const selected = Array.isArray(value) ? value.includes(option.value) : value === option.value;
      return <Button key={option.value} title={`${selected ? '✓ ' : ''}${option.label}`} secondary={!selected} disabled={disabled}
        onPress={() => onChange(field.type === 'multiselect'
          ? selected ? (Array.isArray(value) ? value : []).filter(v => v !== option.value) : [...(Array.isArray(value) ? value : []), option.value]
          : !field.required && selected ? '' : option.value)} />;
    })}</> : <Field label={`${field.label}${field.required ? ' *' : ''}`} value={String(value)} editable={!disabled}
      onChangeText={onChange} placeholder={field.type === 'date' ? 'YYYY-MM-DD' : field.placeholder}
      keyboardType={field.type === 'number' || field.type === 'currency' ? 'decimal-pad' : 'default'} />}
    {field.help ? <Copy>{field.help}</Copy> : null}<Notice message={error ?? null} />
  </View>;
}

export function RiskForm({ category }: { category: Category }) {
  const [values, setValues] = useState<FormValues>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<Error>();
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupMessage, setLookupMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const lookupController = useRef<AbortController | null>(null);
  useEffect(() => () => lookupController.current?.abort(), []);
  const { quick, rest } = quickQuoteFields(category.risk_schema);

  async function lookup() {
    const registration = normaliseRegistration(String(values.registration_number ?? ''));
    if (!registration || lookupBusy) return;
    const controller = new AbortController();
    lookupController.current = controller;
    const timeout = setTimeout(() => controller.abort(), 6000);
    setLookupBusy(true); setLookupMessage(null);
    setValues(current => ({ ...current, registration_number: registration }));
    try {
      const result = await api<{ found: boolean; data: VehicleData | null }>('/lookups/vehicle', {
        method: 'POST', body: JSON.stringify({ registration }), signal: controller.signal,
      });
      if (result.found && result.data) {
        const data = result.data;
        setValues(current => normaliseRegistration(String(current.registration_number ?? '')) === registration ? prefillFromLookup(current, data) : current);
        setLookupMessage('Vehicle details found. Check the details before requesting a quote.');
      } else {
        setExpanded(true); setLookupMessage('No vehicle details found. Please enter your details below.');
      }
    } catch (e) {
      setExpanded(true);
      setLookupMessage(`${e instanceof Error ? e.message : 'Vehicle lookup is unavailable.'} You can enter your details manually.`);
    } finally { clearTimeout(timeout); setLookupBusy(false); }
  }
  async function submit() {
    if (submitting.current || category.availability === 'planned') return;
    const validated = validateRisk(category.risk_schema, values);
    setErrors(validated.errors); setError(undefined);
    if (!validated.risk || Object.keys(validated.errors).length) { setExpanded(true); return; }
    submitting.current = true; setBusy(true);
    lookupController.current?.abort();
    try {
      const result = await api<{ request: { id: string } }>('/requests', {
        method: 'POST', body: JSON.stringify({ categorySlug: category.slug, risk: validated.risk, submit: true }),
      });
      router.navigate({ pathname: '/(tabs)/requests', params: { requestId: result.request.id } });
    } catch (e) {
      setError(e instanceof Error ? e : new Error('Please try again.'));
      if (e instanceof ApiError && e.code === 'invalid_input') { setErrors(fieldErrors(e.details)); setExpanded(true); }
    } finally { submitting.current = false; setBusy(false); }
  }
  const renderField = (field: RiskField) => <RiskControl key={field.key} field={field} value={values[field.key] ?? ''} disabled={busy} error={errors[field.key]}
    onChange={value => { setValues(current => ({ ...current, [field.key]: value })); setErrors(current => ({ ...current, [field.key]: '' })); }} />;
  return <Card>
    <Copy>{quick.length ? 'Start with your registration, vehicle use and value.' : 'Tell us what you need covered.'} Fields marked * are required.</Copy>
    {quick.map(renderField)}
    {quick.length ? <><Button title={lookupBusy ? 'Looking up vehicle…' : 'Find Vehicle Details'} secondary disabled={lookupBusy || busy || !String(values.registration_number ?? '').trim()} onPress={() => { void lookup(); }} />
      <Notice message={lookupMessage} /><Button title={expanded ? 'Hide Details' : 'Check Details'} secondary onPress={() => setExpanded(v => !v)} /></> : null}
    <View style={{ display: !quick.length || expanded ? 'flex' : 'none', gap: 20 }}>{rest.map(renderField)}</View>
    <ResourceState loading={false} error={error} reload={() => { void submit(); }} />
    <Button title={busy ? 'Requesting Quote…' : 'Request Quote'} disabled={busy || category.availability === 'planned'} onPress={() => { void submit(); }} />
  </Card>;
}
