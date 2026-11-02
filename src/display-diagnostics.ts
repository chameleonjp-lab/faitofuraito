import { translate as t } from './i18n';

// Explicit opt-in for investigating a screenshot from a device we cannot inspect.
// This reads presentation state only; it never sends data or changes game state.
const UI_RELEASE = '20261004-shared-controls';

export function updateDisplayDiagnostics(): void {
  if (new URLSearchParams(location.search).get('display-check') !== '1') return;
  const html = document.querySelector<HTMLMetaElement>('meta[name="chameleonjp-release"]')?.content ?? '不明';
  const css = getComputedStyle(document.documentElement).getPropertyValue('--flight-ui-release').trim().replace(/^['"]|['"]$/g, '') || '不明';
  const result = document.getElementById('result');
  const link = document.getElementById('result-return-home');
  const bounds = link?.getBoundingClientRect();
  const style = link ? getComputedStyle(link) : null;
  const hasBox = bounds && bounds.width > 0 && bounds.height > 0 && style?.visibility === 'visible' && style.opacity !== '0';
  const inViewport = bounds && bounds.left >= 0 && bounds.top >= 0 && bounds.right <= innerWidth && bounds.bottom <= innerHeight;
  const hit = bounds ? document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2) : null;
  const linkState = !link ? '要素なし'
    : result?.hidden ? '結果画面待ち'
      : !hasBox ? '非表示'
        : !inViewport ? '画面外'
          : !hit || !link.contains(hit) ? '重なりあり' : '表示';
  const text = t('表示確認 JS {{arg1}} / {{arg2}} / HTML {{arg3}} / CSS {{arg4}} / 戻る {{arg5}}', {
    1: UI_RELEASE,
    2: location.pathname,
    3: html.replace('faitofuraito-', ''),
    4: css,
    5: t(linkState),
  });
  for (const output of document.querySelectorAll<HTMLElement>('[data-display-check]')) {
    output.hidden = false;
    output.textContent = text;
  }
}

