import 'dotenv/config';
import { MongoClientManager } from '../src/lib/server/mongodb/client.ts';
import { readMongoConfig } from '../src/lib/server/mongodb/config.ts';
import { getMongoCollections } from '../src/lib/server/mongodb/collections.ts';
import { normalizeEmail, validateEmail } from '../src/lib/server/auth/validation.ts';

const [operation, rawEmail, ...unexpectedArguments] = process.argv.slice(2);
const email = rawEmail ? normalizeEmail(rawEmail) : '';
const role = operation === 'grant' ? 'admin' : operation === 'revoke' ? 'user' : null;

if (!role || validateEmail(email) || unexpectedArguments.length > 0) {
	console.error('Usage: npm run admin:grant -- user@example.com');
	console.error('   or: npm run admin:revoke -- user@example.com');
	process.exitCode = 1;
} else {
	const config = readMongoConfig(process.env);
	const manager = new MongoClientManager(config);

	try {
		const client = await manager.connect();
		const { users } = getMongoCollections(client.db(config.databaseName));
		const result = await users.updateOne(
			{ email },
			{ $set: { role, updatedAt: new Date() } }
		);

		if (result.matchedCount !== 1) {
			console.error('No existing user was found for the supplied email address.');
			process.exitCode = 1;
		} else {
			console.log(`User role updated to ${role}.`);
		}
	} catch {
		console.error('The user role could not be updated. Check the MongoDB configuration and availability.');
		process.exitCode = 1;
	} finally {
		await manager.close(true).catch(() => {
			process.exitCode = 1;
		});
	}
}
