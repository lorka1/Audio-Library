/**
 * The SQLite/Drizzle implementation retains the mature query-parity functions
 * in repository.ts while exposing the focused M4 TrackRepository contract.
 */
export {
	createSqliteTrackRepository,
	sqliteTrackRepository
} from './repository';
