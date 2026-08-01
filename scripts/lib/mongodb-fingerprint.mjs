import { createHash } from 'node:crypto';

const OPERATION_TIMEOUT_MS = 5_000;

export async function safeMongoAggregateFingerprint(collections) {
	const summaries = [];
	for (const name of [
		'users',
		'sessions',
		'tracks',
		'playlists',
		'playlistItems',
		'counters',
		'migrations'
	]) {
		const [summary] = await collections[name]
			.aggregate(
				[
					{
						$group: {
							_id: null,
							count: { $sum: 1 },
							totalBytes: { $sum: { $bsonSize: '$$ROOT' } }
						}
					},
					{ $project: { _id: 0, count: 1, totalBytes: 1 } }
				],
				{ maxTimeMS: OPERATION_TIMEOUT_MS }
			)
			.toArray();
		summaries.push({
			name,
			count: summary?.count ?? 0,
			totalBytes: summary?.totalBytes ?? 0
		});
	}
	return createHash('sha256')
		.update(JSON.stringify(summaries))
		.digest('hex');
}
