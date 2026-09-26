import fs from 'fs';
import path from 'path';
import type { Checker } from './checker';

const dirURL = new URL('./impl', import.meta.url);

const checkers: Checker[] = (await Promise.all(fs.readdirSync(dirURL).map(u => path.join(dirURL.pathname, u)).map(async u => await import(u)))).map(m => m.default);

export const staticCheckerNames = checkers.map((checker) => checker.name);

export function runStaticChecks(data: string) {
    return checkers.flatMap(checker => checker.check(data));
}
