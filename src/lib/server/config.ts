import { env } from '$env/dynamic/private';
import {
	parseOperationalConfig,
	type OperationalConfig,
	type OperationalEnvironment
} from './operational/config';

export function getServerConfig(
	environment: OperationalEnvironment = {
		...env,
		NODE_ENV: process.env.NODE_ENV,
		ORIGIN: process.env.ORIGIN
	},
	projectRoot = process.cwd()
): OperationalConfig {
	return parseOperationalConfig(environment, projectRoot);
}
