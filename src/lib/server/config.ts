import { env } from '$env/dynamic/private';
import { parseOperationalConfig } from './operational/config';

export const serverConfig = parseOperationalConfig({
	...env,
	NODE_ENV: process.env.NODE_ENV,
	ORIGIN: process.env.ORIGIN
});
