import type { GameMode } from './types';

/** Keep the selected flight mode on the lab page's two-mode detail switch. */
export function flightRankingUrl(mode: GameMode): string {
  return `https://chameleonjp-lab.github.io/chameleonjp_lab/ranking.html?game=faitofuraito&difficulty=${mode}`;
}
