/* global jest, beforeEach, it, expect */
import { act, createElement } from 'react';
import { StyleSheet } from 'react-native';
import Account from '../../../app/(tabs)/account';
import { PolicyWallet } from '../policy-wallet';
import { api } from '../../lib/api';
import { openDocument } from '../../lib/browser';
const { createRoot } = require(require.resolve('test-renderer', { paths: [require.resolve('jest-expo/package.json')] }));
const mockLayout = { width: 390, isWide: false, hasRail: false };
const mockSignOut = jest.fn();
const mockReplace = jest.fn();
jest.mock('../../lib/layout/use-layout', () => ({ useLayout: () => mockLayout }));
jest.mock('../../lib/api', () => ({ api: jest.fn() }));
jest.mock('../../lib/browser', () => ({ openDocument: jest.fn() }));
jest.mock('../../providers/auth', () => ({ useAuth: () => ({ signOut: mockSignOut }) }));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { version: '0.1.0' } } }));
jest.mock('expo-router', () => ({ useFocusEffect: callback => require('react').useEffect(callback, [callback]), useRouter: () => ({ replace: mockReplace }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
const policy = { id: 'policy-1', status: 'pending_issuance', external_source: false, nickname: 'My motor cover', policy_number: null, internal_reference: 'POL-1', cover_start: null, cover_end: null, premium: 250, billing_period: 'year', category: { name: 'Motor' }, insurer: { name: 'Test insurer' }, demo: true, coverActive: false };
const profile = { full_name: 'Ama Mensah', preferred_name: null, email: 'ama@example.test', phone: null, account_type: 'individual', business_name: null, country_code: 'GH', preferred_currency: 'GHS', timezone: null };
const text = root => JSON.stringify(root.container.toJSON());
async function render(Component, props) {
  const root = createRoot();
  await act(async () => { root.render(createElement(Component, props)); });
  return root;
}
async function press(root, label) {
  const button = root.container.queryAll(node => node.props.accessibilityRole === 'button' && JSON.stringify(node.toJSON()).includes(label))[0];
  await act(async () => { button.props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
}
beforeEach(() => {
  Object.assign(mockLayout, { width: 390, isWide: false, hasRail: false });
  mockSignOut.mockResolvedValue(undefined);
  api.mockReset();
  api.mockImplementation(async path => {
    if (path === '/me') return { profile };
    if (path === '/policies') return [policy];
    if (path.endsWith('/documents')) return { documents: [{ id: 'doc-1', fileName: 'Certificate.pdf', url: 'https://example.test/old' }] };
    if (path === '/documents/doc-1/url') return { url: 'https://example.test/fresh' };
    return { policy, disclosure: 'Technology provided by Covva. Insurance broking services provided by Test broker.' };
  });
});
it('renders the API profile, shell entries and version; delegates sign out', async () => {
  const root = await render(Account);
  for (const value of ['Ama Mensah', 'ama@example.test', 'Not provided', 'Notification preferences', 'Privacy request', 'Help and complaints', 'Legal', '0.1.0', 'read-only']) expect(text(root)).toContain(value);
  expect(api).toHaveBeenCalledWith('/me');
  await press(root, 'Sign Out');
  expect(mockSignOut).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});
it('constrains the wide profile to reading width', async () => {
  Object.assign(mockLayout, { width: 1200, isWide: true, hasRail: true });
  const root = await render(Account);
  const scroll = root.container.queryAll(node => !!node.props.contentContainerStyle)[0];
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle).maxWidth).toBe(720);
  await act(async () => root.unmount());
});
it('renders a missing profile without failing', async () => {
  api.mockResolvedValue({ profile: null });
  const root = await render(Account);
  expect(text(root)).toContain('Your profile is not available.');
  await act(async () => root.unmount());
});
it.each([Account, PolicyWallet])('shows loading, exact business-rule messages, and retries', async Component => {
  let reject;
  api.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const root = await render(Component);
  expect(root.container.queryAll(node => String(node.props.accessibilityLabel).startsWith('Loading')).length).toBeGreaterThan(0);
  await act(async () => reject(new Error('Your customer-facing business rule.')));
  expect(text(root)).toContain('Your customer-facing business rule.');
  await press(root, 'Try Again');
  expect(text(root)).not.toContain('Your customer-facing business rule.');
  await act(async () => root.unmount());
});
it.each([390, 839, 840, 1200])('renders list-detail at the rail threshold: %s', async width => {
  Object.assign(mockLayout, { width, isWide: width >= 600, hasRail: width >= 840 });
  const root = await render(PolicyWallet, { selectedId: 'policy-1' });
  const layout = root.container.queryAll(node => node.props.testID === 'policy-layout')[0];
  expect(StyleSheet.flatten(layout.props.style).flexDirection).toBe(width >= 840 ? 'row' : undefined);
  expect(api.mock.calls.some(([path]) => path === '/policies')).toBe(width >= 840);
  expect(text(root)).toContain('Not yet active.');
  expect(text(root)).toContain('Test broker');
  await press(root, 'Open Certificate.pdf');
  expect(openDocument).toHaveBeenCalledWith('https://example.test/fresh');
  await act(async () => root.unmount());
});
it('shows an empty wallet', async () => {
  api.mockResolvedValue([]);
  const root = await render(PolicyWallet);
  expect(text(root)).toContain('No policies yet.');
  await act(async () => root.unmount());
});
