/* global describe, it, expect, __dirname */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { LINK_DOMAINS, LINK_PATH_PREFIXES } from '../deep-links';

const root = path.resolve(__dirname, '../../..');
const { expo } = JSON.parse(readFileSync(path.join(root, 'app.json'), 'utf8'));

/** Reads width, height and whether the PNG has an alpha channel from its header. */
function png(rel) {
  const buf = readFileSync(path.join(root, rel));
  expect(buf.subarray(1, 4).toString()).toBe('PNG');
  const colorType = buf[25];
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), alpha: colorType === 4 || colorType === 6 };
}

describe('app.json', () => {
  it('has an opaque 1024px app icon (App Store rejects transparency)', () => {
    expect(png(expo.icon)).toEqual({ width: 1024, height: 1024, alpha: false });
  });

  it('has Android adaptive icon layers', () => {
    const { adaptiveIcon } = expo.android;
    expect(png(adaptiveIcon.foregroundImage)).toEqual({ width: 1024, height: 1024, alpha: true });
    expect(png(adaptiveIcon.monochromeImage)).toEqual({ width: 1024, height: 1024, alpha: true });
    expect(adaptiveIcon.backgroundColor).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('configures the splash screen plugin', () => {
    const entry = expo.plugins.find((p) => Array.isArray(p) && p[0] === 'expo-splash-screen');
    expect(entry).toBeDefined();
    expect(png(entry[1].image).alpha).toBe(true);
    expect(entry[1].backgroundColor).toMatch(/^#[0-9A-F]{6}$/i);
  });

  it('claims universal links on every link domain (iOS)', () => {
    const expected = [...LINK_DOMAINS.map((h) => `applinks:${h}`), ...LINK_DOMAINS.map((h) => `webcredentials:${h}`)];
    expect([...expo.ios.associatedDomains].sort()).toEqual(expected.sort());
  });

  it('claims verified app links on every link domain and path (Android)', () => {
    const filters = expo.android.intentFilters;
    expect(filters).toHaveLength(1);
    expect(filters[0]).toMatchObject({ action: 'VIEW', autoVerify: true, category: expect.arrayContaining(['BROWSABLE', 'DEFAULT']) });
    const pairs = filters[0].data.map((d) => `${d.scheme}://${d.host}${d.pathPrefix}`);
    const expected = LINK_DOMAINS.flatMap((h) => LINK_PATH_PREFIXES.map((p) => `https://${h}${p}`));
    expect(pairs.sort()).toEqual(expected.sort());
  });

  it('keeps the custom scheme and bundle ids', () => {
    expect(expo.scheme).toBe('covva');
    expect(expo.ios.bundleIdentifier).toBe('com.covva.app');
    expect(expo.android.package).toBe('com.covva.app');
  });
});
