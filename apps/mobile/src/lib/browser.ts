import { openBrowserAsync } from 'expo-web-browser';

export async function openDocument(url: string) {
  if (!/^https?:\/\//i.test(url)) throw new Error('This document link is unavailable. Please try again.');
  await openBrowserAsync(url);
}
