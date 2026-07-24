export const BPM_MIN = 20;
export const BPM_MAX = 300;

export const MUSICAL_KEYS = [
	'C major',
	'C minor',
	'C# major / Db major',
	'C# minor / Db minor',
	'D major',
	'D minor',
	'D# major / Eb major',
	'D# minor / Eb minor',
	'E major',
	'E minor',
	'F major',
	'F minor',
	'F# major / Gb major',
	'F# minor / Gb minor',
	'G major',
	'G minor',
	'G# major / Ab major',
	'G# minor / Ab minor',
	'A major',
	'A minor',
	'A# major / Bb major',
	'A# minor / Bb minor',
	'B major',
	'B minor'
] as const;

export const MUSIC_GENRES = [
	'Electronic',
	'House',
	'Techno',
	'Hip-Hop',
	'Pop',
	'Rock',
	'Metal',
	'Jazz',
	'Classical',
	'Ambient',
	'Drum and Bass',
	'Dubstep',
	'Other'
] as const;

export type MusicalKey = (typeof MUSICAL_KEYS)[number];
export type MusicGenre = (typeof MUSIC_GENRES)[number];
