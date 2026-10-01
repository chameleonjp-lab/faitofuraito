import type { GameMode } from './types';

export function flightRankingUrl(mode: GameMode): string {
  return `https://chameleonjp-lab.github.io/chameleonjp_lab/ranking.html?game=faitofuraito&difficulty=${mode}`;
}
