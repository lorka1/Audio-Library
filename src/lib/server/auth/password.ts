import { randomBytes } from 'node:crypto';
import { compare, hash } from 'bcryptjs';

const BCRYPT_COST = 12;

let dummyPasswordHash: Promise<string> | undefined;

function getDummyPasswordHash(): Promise<string> {
	dummyPasswordHash ??= hash(randomBytes(32).toString('base64url'), BCRYPT_COST);
	return dummyPasswordHash;
}

export function hashPassword(password: string): Promise<string> {
	return hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
	return compare(password, passwordHash);
}

export async function performDummyPasswordCheck(password: string): Promise<void> {
	await compare(password, await getDummyPasswordHash());
}
