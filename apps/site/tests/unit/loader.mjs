import { readFile } from 'node:fs/promises';
import ts from 'typescript';
export async function resolve(specifier, context, next) {
  if (specifier === 'server-only') return { url: 'data:text/javascript,export {}', shortCircuit: true };
  if (specifier.startsWith('@/')) return next(new URL(`../../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
  try { return await next(specifier, context); }
  catch (error) {
    if (specifier.startsWith('.')) return next(`${specifier}.ts`, context);
    throw error;
  }
}
export async function load(url, context, next) {
  if (url.startsWith('file:') && new URL(url).pathname.endsWith('.ts')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(await readFile(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
  return next(url, context);
}
