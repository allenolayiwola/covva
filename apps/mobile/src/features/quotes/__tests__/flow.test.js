/* global jest, beforeEach, it, expect */
import { act, createElement } from 'react';
import { StyleSheet, Text } from 'react-native';
import { RiskForm } from '../risk-form';
import { ListDetail } from '../components';
import { CategoriesScreen } from '../categories-screen';
import { QuotesScreen } from '../quotes-screen';
import { api, ApiError } from '../../../lib/api';
import { router } from 'expo-router';
import { compareQuotes } from '@im/core';

const { createRoot } = require(require.resolve('test-renderer', { paths: [require.resolve('jest-expo/package.json')] }));
const mockLayout = { width: 375, isWide: false };
let mockParams = {};
jest.mock('../../../lib/layout/use-layout', () => ({ useLayout: () => mockLayout }));
jest.mock('../../../lib/api', () => ({
  api: jest.fn(),
  ApiError: class extends Error { constructor(message, code, status, details) { super(message); Object.assign(this, { code, status, details }); } },
}));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn(), push: jest.fn(), setParams: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock('../../../components/ui', () => {
  const React = require('react');
  const { View, Text, TextInput, Pressable } = require('react-native');
  return {
    Screen: ({ children }) => React.createElement(View, {}, children),
    Card: ({ children }) => React.createElement(View, {}, children),
    Copy: ({ children }) => React.createElement(Text, {}, children),
    Notice: ({ message }) => React.createElement(Text, {}, message),
    Button: ({ title, onPress, disabled }) => React.createElement(Pressable, { accessibilityLabel: title, onPress, disabled }),
    Field: ({ label, ...props }) => React.createElement(TextInput, { ...props, accessibilityLabel: label }),
    ActionButton: () => null,
  };
});
const category = { id: 'motor', slug: 'motor', name: 'Motor', availability: 'integrated', risk_schema: [
  { key: 'registration_number', label: 'Registration', type: 'text', required: true },
  { key: 'use', label: 'Use', type: 'select', required: true, options: [{ value: 'private', label: 'Private' }] },
  { key: 'vehicle_value', label: 'Value', type: 'currency', required: true, min: 1000 },
  { key: 'vehicle_make', label: 'Make', type: 'text', required: true },
] };
function labelled(root, label) { return root.container.queryAll(n => n.props.accessibilityLabel === label)[0]; }
async function tap(root, label) {
  await act(async () => labelled(root, label).props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }));
}
async function fill(root, label, value) { await act(async () => labelled(root, label).props.onChangeText(value)); }
function text(root, value) { return root.container.queryAll(n => n.props.children === value); }
beforeEach(() => { jest.clearAllMocks(); mockParams = {}; mockLayout.width = 375; });
it('prefills a motor quote and submits the validated payload to REST', async () => {
  api.mockImplementation(path => Promise.resolve(path === '/lookups/vehicle' ? { found: true, data: { make: 'Toyota' } } : { request: { id: 'request-1' } }));
  const root = createRoot();
  await act(async () => root.render(createElement(RiskForm, { category })));
  await fill(root, 'Registration *', 'gr123423');
  await tap(root, 'Private');
  await fill(root, 'Value *', '50000');
  await tap(root, 'Find Vehicle Details');
  expect(JSON.parse(api.mock.calls[0][1].body)).toEqual({ registration: 'GR 1234-23' });
  expect(labelled(root, 'Make *').props.value).toBe('Toyota');
  await tap(root, 'Request Quote');
  expect(JSON.parse(api.mock.calls[1][1].body)).toEqual({ categorySlug: 'motor', submit: true, risk: { registration_number: 'GR 1234-23', use: 'private', vehicle_value: 50000, vehicle_make: 'Toyota' } });
  expect(router.navigate).toHaveBeenCalledWith({ pathname: '/(tabs)/requests', params: { requestId: 'request-1' } });
  await act(async () => root.unmount());
});
it('lookup failure opens manual fields and a business rule is shown verbatim', async () => {
  api.mockRejectedValue(new Error('Offline'));
  const root = createRoot();
  await act(async () => root.render(createElement(RiskForm, { category })));
  await fill(root, 'Registration *', 'gr123423');
  await tap(root, 'Find Vehicle Details');
  expect(labelled(root, 'Hide Details')).toBeDefined();
  await fill(root, 'Make *', 'Toyota');
  await tap(root, 'Private');
  await fill(root, 'Value *', '50000');
  api.mockRejectedValue(new ApiError('This risk already has an open request.', 'business_rule', 422));
  await tap(root, 'Request Quote');
  expect(text(root, 'This risk already has an open request.').length).toBeGreaterThan(0);
  expect(router.navigate).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
it('planned categories remain visible and never render a request form', async () => {
  const planned = { ...category, availability: 'planned' };
  api.mockImplementation(path => Promise.resolve(path === '/catalog/categories' ? [planned] : { category: planned, productsCount: 0, insurersCount: 0, demoMode: false }));
  const root = createRoot();
  await act(async () => root.render(createElement(CategoriesScreen)));
  await tap(root, 'Explore Motor');
  expect(text(root, 'Planned').length).toBeGreaterThan(0);
  expect(labelled(root, 'Request Quote')).toBeUndefined();
  await act(async () => root.unmount());
});
it('keeps the detail mounted and uses two columns only from 840px', async () => {
  const root = createRoot();
  const render = () => root.render(createElement(ListDetail, { selected: true, onBack: jest.fn(), list: createElement(Text, {}, 'list'), detail: createElement(RiskForm, { category }) }));
  mockLayout.width = 839;
  await act(async () => render());
  expect(root.container.queryAll(n => StyleSheet.flatten(n.props.style)?.flexDirection === 'row')).toHaveLength(0);
  await fill(root, 'Registration *', 'GR 4321-23');
  mockLayout.width = 840;
  await act(async () => render());
  expect(root.container.queryAll(n => StyleSheet.flatten(n.props.style)?.flexDirection === 'row').length).toBeGreaterThan(0);
  mockLayout.width = 375;
  await act(async () => render());
  expect(labelled(root, 'Registration *').props.value).toBe('GR 4321-23');
  await act(async () => root.unmount());
});
it('renders comparison disclosure and navigates Apply only to a placeholder', async () => {
  mockParams = { requestId: 'request-1' };
  const quote = { id: 'q1', status: 'ready_to_accept', statusLabel: 'Ready to accept', premium: 100, excess: null, sum_insured: null, expired: false, valid_until: '2099-01-01T00:00:00Z', insurer: { name: 'Insurer One' }, coverage: [], exclusions: [], optional_benefits: [], waiting_period_days: 0 };
  const comparison = compareQuotes([{ ...quote, insurerId: 'i1', insurerName: 'Insurer One', sumInsured: null, waitingPeriodDays: 0, optionalBenefits: [] }]);
  api.mockResolvedValue({ request: { id: 'request-1', reference: 'R1' }, broker: { name: 'Broker One', nic_licence_number: 'NIC/1' }, quotes: [quote], comparison, summary: '1 quote from 1 participating insurer compared.', comparedAt: '2026-10-31T12:00:00Z', demoMode: true });
  const root = createRoot();
  await act(async () => root.render(createElement(QuotesScreen)));
  await tap(root, 'View Quote');
  expect(text(root, 'Technology provided by Covva. Insurance broking services provided by Broker One, NIC licence NIC/1. This policy is underwritten and issued by Insurer One.').length).toBeGreaterThan(0);
  await tap(root, 'Apply');
  expect(router.push).toHaveBeenCalledWith({ pathname: '/(tabs)/requests', params: { requestId: 'request-1', applyQuoteId: 'q1' } });
  expect(api).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});
