/* global jest, beforeEach, it, expect */
import { act, createElement } from 'react';
import { StyleSheet } from 'react-native';
import SignIn from '../../../app/sign-in';
import { PreviewListDetail } from '../preview-list-detail';

// Reuse jest-expo's installed renderer; no new dependency.
const { createRoot } = require(require.resolve('test-renderer', { paths: [require.resolve('jest-expo/package.json')] }));
const mockLayout = { width: 375, height: 812, isWide: false, hasRail: false };
jest.mock('../../lib/layout/use-layout', () => ({ useLayout: () => mockLayout }));
jest.mock('../../lib/supabase', () => ({ supabase: { auth: {} } }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return { SafeAreaView: View };
});

beforeEach(() => {
  Object.assign(mockLayout, { width: 375, height: 812, isWide: false, hasRail: false });
});

it('renders the phone sign-in form inside a growing scroll container', async () => {
  const root = createRoot();
  await act(async () => { root.render(createElement(SignIn)); });
  const email = root.container.queryAll((node) => node.props.accessibilityLabel === 'Email')[0];
  const password = root.container.queryAll((node) => node.props.accessibilityLabel === 'Password')[0];
  expect(email).toBeDefined();
  expect(password).toBeDefined();
  const scroll = root.container.queryAll((node) => !!node.props.contentContainerStyle)[0];
  expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({ flexGrow: 1, padding: 24, maxWidth: 600 });
  for (const field of [email, password]) {
    let node = field;
    while (node) {
      const style = StyleSheet.flatten(node.props.style);
      expect(style?.display).not.toBe('none');
      expect(style?.height).not.toBe(0);
      node = node.parent;
    }
  }
  await act(async () => { root.unmount(); });
});

it('retains list selection across compact/wide changes', async () => {
  const root = createRoot();
  const render = () => root.render(createElement(PreviewListDetail, { title: 'Requests', description: 'Preview description' }));
  Object.assign(mockLayout, { width: 951, isWide: true, hasRail: true });
  await act(async () => { render(); });
  const buttons = root.container.queryAll((node) => node.props.accessibilityRole === 'button');
  await act(async () => { buttons[1].props.onClick({ nativeEvent: {}, currentTarget: 1, target: 1 }); });
  Object.assign(mockLayout, { width: 466, isWide: false, hasRail: false });
  await act(async () => { render(); });
  Object.assign(mockLayout, { width: 669, isWide: true, hasRail: false });
  await act(async () => { render(); });
  expect(root.container.queryAll((node) => node.props.accessibilityRole === 'button')[1].props.accessibilityState.selected).toBe(true);
  await act(async () => { root.unmount(); });
});
