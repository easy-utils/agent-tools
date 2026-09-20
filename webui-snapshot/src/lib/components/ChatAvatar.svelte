<script lang="ts">
  // ChatAvatar — honeycomb identicon circle, an exact port of the Flutter /
  // Compose implementation (same seed hash + pattern), rendered as an inline
  // SVG. Used by the session list (seeded by the session id).
  import { avatarSpec, type HexCell } from '$lib/identicon'

  let { seed, size = 40 }: { seed: string; size?: number } = $props()

  const spec = $derived(avatarSpec(seed))
  const d = $derived(size)

  function points(h: HexCell): string {
    const cx = d / 2 + h.x * d
    const cy = d / 2 + h.y * d
    const r = h.r * d
    const pts: string[] = []
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * Math.PI) / 3
      pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`)
    }
    return pts.join(' ')
  }
</script>

<svg width={d} height={d} viewBox="0 0 {d} {d}" class="shrink-0" aria-hidden="true">
  <clipPath id={`av-${seed.replace(/[^a-zA-Z0-9]/g, '')}`}>
    <circle cx={d / 2} cy={d / 2} r={d / 2} />
  </clipPath>
  <circle cx={d / 2} cy={d / 2} r={d / 2} fill={spec.bg} />
  <g clip-path={`url(#av-${seed.replace(/[^a-zA-Z0-9]/g, '')})`}>
    {#each spec.hexes.filter(h => h.on) as h}
      <polygon points={points(h)} fill={spec.fg} />
    {/each}
  </g>
</svg>
