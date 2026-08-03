<script lang="ts">
	let {
		variant = 'hero',
		class: className = ''
	}: {
		variant?: 'hero' | 'compact';
		class?: string;
	} = $props();
</script>

<div
	class={`audio-waveform audio-waveform--${variant} ${className}`}
	aria-hidden="true"
>
	<svg viewBox="0 0 760 360" role="presentation" focusable="false">
		<g class="audio-waveform__bars">
			<path
				d="M10 190v-8m12 8v-13m12 13v-20m12 20v-30m12 30v-42m12 42v-58m12 58v-76m12 76V98m12 92V78m12 112V61m12 129V50m12 140V45m12 145V50m12 140V63m12 127V84m12 106v-78m12 78v-51m12 51v-31m12 31v-18m12 18v-12m12 12v-18m12 18v-34m12 34v-55m12 55v-78m12 78V88m12 102V64m12 126V47m12 143V39m12 151V37m12 153V42m12 148V55m12 135V75m12 115V99m12 91v-66m12 66v-47m12 47v-34m12 34v-28m12 28v-31m12 31v-42m12 42v-59m12 59v-78m12 78V91m12 99V70m12 120V57m12 133V52m12 138V56m12 134V69m12 121V87m12 103v-82m12 82v-63m12 63v-46m12 46v-34m12 34v-25m12 25v-19"
			></path>
		</g>

		<g class="audio-waveform__lines">
			<path d="M-8 196C73 196 73 116 153 116s81 109 161 109 81-154 161-154 81 134 161 134 81-92 161-92 81 73 161 73"></path>
			<path d="M-8 204C73 204 73 130 153 130s81 103 161 103S395 86 475 86s81 127 161 127 81-84 161-84 81 66 161 66"></path>
			<path d="M-8 212C73 212 73 145 153 145s81 94 161 94 81-137 161-137 81 119 161 119 81-76 161-76 81 59 161 59"></path>
			<path d="M-8 220C73 220 73 160 153 160s81 84 161 84 81-125 161-125 81 110 161 110 81-68 161-68 81 52 161 52"></path>
			<path d="M-8 228C73 228 73 176 153 176s81 72 161 72 81-110 161-110 81 99 161 99 81-59 161-59 81 44 161 44"></path>
		</g>

		<g class="audio-waveform__particles">
			<circle cx="122" cy="58" r="2"></circle>
			<circle cx="208" cy="274" r="3"></circle>
			<circle cx="326" cy="81" r="2.5"></circle>
			<circle cx="438" cy="297" r="2"></circle>
			<circle cx="548" cy="55" r="3"></circle>
			<circle cx="687" cy="270" r="2"></circle>
			<circle cx="724" cy="76" r="1.75"></circle>
		</g>
	</svg>
</div>

<style>
	.audio-waveform {
		position: relative;
		min-width: 0;
		pointer-events: none;
		filter: drop-shadow(0 0 2rem rgb(102 51 238 / 28%));
	}

	svg {
		display: block;
		width: 100%;
		height: auto;
		overflow: visible;
	}

	.audio-waveform__bars {
		fill: none;
		stroke: #6544ec;
		stroke-width: 1.1;
		stroke-linecap: round;
		opacity: 0.42;
		transform-origin: center;
		animation: waveform-breathe 7s ease-in-out infinite;
	}

	.audio-waveform__lines {
		fill: none;
		stroke: #824dff;
		stroke-width: 1.35;
		stroke-linecap: round;
		opacity: 0.65;
	}

	.audio-waveform__lines path:first-child {
		stroke: #9b5cff;
		stroke-width: 2.4;
		opacity: 0.95;
	}

	.audio-waveform__lines path:nth-child(2) {
		stroke: #6847f5;
		opacity: 0.8;
	}

	.audio-waveform__lines path:nth-child(4),
	.audio-waveform__lines path:nth-child(5) {
		stroke: #3346d9;
		opacity: 0.38;
	}

	.audio-waveform__particles {
		fill: #754cff;
		opacity: 0.75;
		animation: particles-float 9s ease-in-out infinite alternate;
	}

	.audio-waveform--compact {
		opacity: 0.84;
	}

	@keyframes waveform-breathe {
		0%,
		100% {
			opacity: 0.36;
			transform: scaleY(0.96);
		}
		50% {
			opacity: 0.52;
			transform: scaleY(1.03);
		}
	}

	@keyframes particles-float {
		to {
			transform: translate3d(0.5rem, -0.6rem, 0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.audio-waveform__bars,
		.audio-waveform__particles {
			animation: none;
		}
	}
</style>
