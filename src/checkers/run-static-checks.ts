import fs from 'fs';
import path from 'path';
import type { Checker } from './checker';
import { findKeywords, type KeywordIndex } from './keywords';

const dirURL = new URL('./impl', import.meta.url);

const checkers: Checker[] = (await Promise.all(fs.readdirSync(dirURL).map(u => path.join(dirURL.pathname, u)).map(async u => await import(u)))).map(m => m.default);

export const staticCheckerNames = checkers.map((checker) => checker.name);

// `keywords`: the custom keyword list, when there is one
export function runStaticChecks(data: string, keywords?: KeywordIndex) {
    const found = checkers.flatMap(checker => checker.check(data));
    return keywords ? [...found, ...findKeywords(data, keywords)] : found;
}
