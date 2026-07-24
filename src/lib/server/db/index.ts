import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { serverConfig } from '../config';
import * as schema from './schema';

mkdirSync(dirname(serverConfig.databasePath), { recursive: true });

const sqlite = createClient({
	url: pathToFileURL(serverConfig.databasePath).href
});

export const db = drizzle({
	client: sqlite,
	schema
});

export { sqlite };
export * from './schema';
export type * from './types';
