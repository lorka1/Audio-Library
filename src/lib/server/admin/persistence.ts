import { connectMongoDevelopment } from '../mongodb/client';
import { getMongoCollections } from '../mongodb/collections';
import type { AdminRepository } from './contract';
import { createMongoAdminRepository } from './mongodb-repository';

let repositoryPromise: Promise<AdminRepository> | undefined;

export async function getApplicationAdminRepository(): Promise<AdminRepository> {
	if (!repositoryPromise) {
		const attempt = connectMongoDevelopment().then(({ database }) =>
			createMongoAdminRepository(getMongoCollections(database))
		);
		let cached: Promise<AdminRepository>;
		cached = attempt.catch((error) => {
			if (repositoryPromise === cached) repositoryPromise = undefined;
			throw error;
		});
		repositoryPromise = cached;
	}

	return repositoryPromise;
}
