import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { logTrackStorageError } from '$lib/server/tracks/logging';
import { parseTrackQuery } from '$lib/server/tracks/query';
import { listPublicTracks } from '$lib/server/tracks/repository';
import {
	getActiveTrackFilterSummary,
	hasActiveTrackFilters
} from '$lib/tracks-query';

export const load = (async ({ url }) => {
	const parsedQuery = parseTrackQuery(url.searchParams);

	if (!parsedQuery.isValid) {
		return {
			tracks: [],
			filterValues: parsedQuery.values,
			filterErrors: parsedQuery.errors,
			activeFilterSummary: getActiveTrackFilterSummary(parsedQuery.filters),
			hasActiveFilters: true
		};
	}

	try {
		return {
			tracks: await listPublicTracks(parsedQuery.filters),
			filterValues: parsedQuery.values,
			filterErrors: parsedQuery.errors,
			activeFilterSummary: getActiveTrackFilterSummary(parsedQuery.filters),
			hasActiveFilters: hasActiveTrackFilters(parsedQuery.filters)
		};
	} catch (loadError) {
		logTrackStorageError('Unable to list public tracks.', loadError);
		error(500, 'Public tracks are temporarily unavailable.');
	}
}) satisfies PageServerLoad;
