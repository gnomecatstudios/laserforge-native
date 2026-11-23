<script lang="ts">
  import type { BooleanOperation } from 'libopenlaser/project';
  let { operation }: { operation: BooleanOperation } = $props();
  const uid = $props.id();
</script>

<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <defs>
    <mask id={uid}>
      <rect width="24" height="24" fill="black" />
      {#if operation === 'union'}
        <rect x="2" y="2" width="13" height="13" fill="white" /><rect
          x="9"
          y="9"
          width="13"
          height="13"
          fill="white"
        />
      {:else if operation === 'subtract'}
        <rect x="2" y="2" width="13" height="13" fill="white" /><rect
          x="9"
          y="9"
          width="13"
          height="13"
          fill="black"
        />
      {:else if operation === 'intersect'}
        <rect x="9" y="9" width="6" height="6" fill="white" />
      {:else}
        <rect x="2" y="2" width="13" height="13" fill="white" /><rect
          x="9"
          y="9"
          width="13"
          height="13"
          fill="white"
        /><rect x="9" y="9" width="6" height="6" fill="black" />
      {/if}
    </mask>
  </defs>
  <rect width="24" height="24" fill="currentColor" mask="url(#{uid})" opacity="0.5" />
  <rect x="2" y="2" width="13" height="13" stroke="currentColor" /><rect
    x="9"
    y="9"
    width="13"
    height="13"
    stroke="currentColor"
  />
</svg>
