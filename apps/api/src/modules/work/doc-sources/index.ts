import type { DocSource } from './types';
import { PART1 } from './part1';
import { PART2 } from './part2';
import { PART3 } from './part3';

export type { DocSource } from './types';
export const DOC_SOURCES: ReadonlyMap<string, DocSource> = new Map([...PART1, ...PART2, ...PART3].map((s) => [s.pageId, s]));
