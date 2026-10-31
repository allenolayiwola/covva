/* global it, expect, __dirname */
import { readFileSync } from 'node:fs';
import path from 'node:path';
const { transformMainActivity, configureActivity, orientationPolicy } = require('../with-adaptive-orientation');
const config = require('../../app.json').expo;

it('keeps iPhone portrait and allows every iPad orientation', () => {
  expect(config.orientation).toBe('default');
  expect(config.ios.supportsTablet).toBe(true);
  expect(config.ios.infoPlist.UISupportedInterfaceOrientations).toEqual(['UIInterfaceOrientationPortrait']);
  expect(config.ios.infoPlist['UISupportedInterfaceOrientations~ipad']).toEqual([
    'UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight',
  ]);
  expect(config.plugins).toContain('./plugins/with-adaptive-orientation');
});
it.each([[375, 'PORTRAIT'], [599, 'PORTRAIT'], [600, 'FULL_USER'], [840, 'FULL_USER']])('applies orientation at smallest width %s', (width, expected) => {
  expect(orientationPolicy(width)).toBe(expected);
});
it('transforms the installed Expo Kotlin template idempotently', () => {
  // Fixture copied from the installed Expo 58.0.21 template.tgz.
  const source = readFileSync(path.join(__dirname, 'fixtures/MainActivity.kt'), 'utf8');
  const transformed = transformMainActivity(source);
  expect(transformMainActivity(transformed)).toBe(transformed);
  expect(transformed).toContain('super.onCreate(null)\n    applyCovvaOrientation()');
  expect(transformed).toContain('super.onConfigurationChanged(newConfig)\n    applyCovvaOrientation()');
  expect(transformed).toContain('resources.configuration.smallestScreenWidthDp >= 600');
  expect(transformed).toContain('SCREEN_ORIENTATION_FULL_USER');
  expect(transformed).toContain('SCREEN_ORIENTATION_PORTRAIT');
});
it('preserves an existing configuration callback', () => {
  const source = 'class MainActivity {\n override fun onCreate(state: Bundle?) {\n super.onCreate(null)\n }\n override fun onConfigurationChanged(config: Configuration) {\n super.onConfigurationChanged(config)\n existingWork()\n }\n}';
  const result = transformMainActivity(source);
  expect(result.match(/override fun onConfigurationChanged/g)).toHaveLength(1);
  expect(result).toContain('super.onConfigurationChanged(config)\n    applyCovvaOrientation()');
  expect(result).toContain('existingWork()');
  expect(() => transformMainActivity('class MainActivity {}')).toThrow();
});
it('preserves manifest orientation and config flags while enabling resize', () => {
  const activity = { $: { 'android:screenOrientation': 'unspecified', 'android:configChanges': 'keyboard|uiMode' } };
  const result = configureActivity(activity);
  expect(configureActivity(result)).toEqual(result);
  expect(result.$['android:screenOrientation']).toBe('unspecified');
  expect(result.$['android:resizeableActivity']).toBe('true');
  expect(result.$['android:configChanges'].split('|')).toEqual(expect.arrayContaining(['keyboard', 'uiMode', 'screenSize', 'smallestScreenSize', 'screenLayout', 'orientation']));
});
