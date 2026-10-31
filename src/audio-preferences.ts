export const AUDIO_STORAGE_KEY = 'faitofuraito.audio.v1';
export function readAudioPreferences(raw: string | null): { enabled: boolean; volume: number } {
  try {
    const value = raw ? JSON.parse(raw) : {};
    return { enabled: typeof value?.enabled === 'boolean' ? value.enabled : true,
      volume: typeof value?.volume === 'number' && Number.isFinite(value.volume) && value.volume >= 0 && value.volume <= 1 ? value.volume : 1 };
  } catch { return {enabled:true,volume:1}; }
}
