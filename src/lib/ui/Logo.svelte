<script lang="ts">
  import { APP_NAME } from '../config/app';

  interface Props {
    size?: number;
    wordmark?: boolean;
    fontSize?: number;
  }

  let { size = 28, wordmark = true, fontSize = 16 }: Props = $props();
</script>

<span class="lockup">
  <img class="mark" src="./mark.png" width={size} height={size} alt={APP_NAME} />
  {#if wordmark}
    <span class="word" style="font-size: {fontSize}px">{APP_NAME}</span>
  {/if}
</span>

<style>
  .lockup {
    display: inline-flex;
    align-items: center;
    gap: 10px;
  }

  .mark {
    display: block;
    flex-shrink: 0;
    object-fit: contain;
  }

  .word {
    font-weight: 600;
    letter-spacing: -0.035em;
    line-height: 1;
  }
</style>
