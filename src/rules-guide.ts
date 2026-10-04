import type { GameMode } from './types';
import { containDialogTabFocus } from './dialog-focus';

export type GuideInput = 'touch' | 'keyboard';
export interface RulesContext { mode: GameMode; input: GuideInput; keyboardDescription: string; }
export interface RuleSection { heading: string; paragraphs: string[]; }

export function ruleSections({ mode, input, keyboardDescription }: RulesContext): RuleSection[] {
  return [
    { heading: 'ゲーム概要', paragraphs: [
      '空を飛び、敵機を撃墜してスコアを伸ばします。敵をすべて倒して終了するゲームではなく、敵機は追加されます。',
      mode === 'easy' ? 'イージーは有効なプレイ時間300秒です。一時停止中は残り時間が減りません。' : 'ノーマルは時間無制限です。経過時間を表示します。',
    ] },
    { heading: '終了と一時停止', paragraphs: [
      '自機のHPが0になる、敵機と衝突する、低高度の警告開始から10秒が経過すると終了します。イージーは300秒でも終了します。',
      '高度1200m以下で低高度警告が始まります。一度始まった警告は上昇しても解除されません。',
      '一時停止中は機体・敵・弾・装填・制限時間が止まります。説明や設定を閉じても自動では飛行を再開しません。',
    ] },
    { heading: input === 'touch' ? 'スマートフォンの操作' : 'PCの操作', paragraphs: input === 'touch' ? [
      'ボタンのない空の部分に触れ、その位置からドラッグして操縦します。指を離すと操縦入力が戻ります。別の指でボタンを押すこともできます。',
      mode === 'easy' ? 'イージーは照準円内・1.2km以内の敵へ自動射撃します。弾道を見て相手の少し先を狙ってください。操作ボタンは宙返りです。' : 'ノーマルは射撃を長押しして撃ちます。加速・減速も長押し、宙返りは押し直して実行します。弾の照準補助はありません。',
      '操作設定でボタンの配置・大きさ・透明度を変更できます。キーボード設定も切り替えて使えます。',
    ] : [
      keyboardDescription,
      mode === 'easy' ? 'イージーは照準円内・1.2km以内の敵へ自動射撃します。弾道を見て相手の少し先を狙ってください。' : 'ノーマルは射撃キーを押している間だけ撃ちます。加速・減速も長押しです。弾の照準補助はありません。',
      'マウスで空の部分をドラッグしても操縦できます。操作設定から各操作のキーを変更できます。宙返りはキーを押し直して実行します。',
    ] },
    { heading: '射撃・敵機・スコア', paragraphs: [
      '機銃288発・機関砲96発を使い切ると6秒で再装填します。機関砲は1発の威力が大きく、どちらも飛んだ距離が長いほど威力が下がります。',
      '敵機は通常14秒ごとに追加され、生存数は最大5機です。最後の敵を倒すと3秒後に補充されます。',
      '撃墜・弾の節約・完了した宙返りで得点が増え、自機の実際の損傷で減点されます。接触による撃墜も通常の1機として数えます。',
    ] },
    { heading: '記録とランキング', paragraphs: [
      '名前は任意です。名前を入れて出撃した記録が、モード別スコアランキングの対象になります。',
      '名前なしはランク外でプレイ回数のみ記録します。結果画面に同じモードの上位30位を表示します。',
      '通信できない場合でもゲームは遊べます。記録の送信状態を確認し、表示された再試行から送信できます。',
    ] },
  ];
}

/** Native modal keeps focus and Escape inside the guide without resuming the mission. */
export class RulesGuide {
  private readonly dialog: HTMLDialogElement;
  private readonly content: HTMLElement;
  private returnFocus: HTMLElement | null = null;
  private readonly abort = new AbortController();
  get isOpen() { return this.dialog.open; }
  constructor(private readonly context: () => RulesContext, private readonly clearInput: () => void) {
    this.dialog = document.createElement('dialog'); this.dialog.id = 'rules-guide';
    this.dialog.className = 'rules-dialog'; this.dialog.setAttribute('aria-labelledby', 'rules-title');
    this.dialog.innerHTML = '<header class="rules-header"><div><p class="eyebrow">HOW TO PLAY</p><h2 id="rules-title">ルールと操作方法</h2></div><button type="button" id="rules-close" aria-label="説明を閉じる">×</button></header><div id="rules-content" class="rules-content" tabindex="0" role="region" aria-label="ルール説明の内容"></div><footer><button type="button" id="rules-back" class="primary">元の画面へ戻る</button></footer>';
    document.getElementById('app')!.append(this.dialog);
    this.content = this.dialog.querySelector('#rules-content')!;
    for (const id of ['rules-close', 'rules-back']) this.dialog.querySelector('#' + id)!.addEventListener('click', () => this.close(), { signal: this.abort.signal });
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.close(); }, { signal: this.abort.signal });
    this.dialog.addEventListener('keydown', event => containDialogTabFocus(this.dialog, event), { signal: this.abort.signal });
    this.dialog.addEventListener('close', () => { this.clearInput(); this.returnFocus?.focus({ preventScroll: true }); }, { signal: this.abort.signal });
  }
  open(button: HTMLElement) {
    if (this.isOpen) return;
    this.returnFocus = button; this.clearInput(); this.content.replaceChildren();
    for (const section of ruleSections(this.context())) {
      const element = document.createElement('section'), heading = document.createElement('h3');
      heading.textContent = section.heading; element.append(heading);
      for (const text of section.paragraphs) { const p = document.createElement('p'); p.textContent = text; element.append(p); }
      this.content.append(element);
    }
    this.dialog.showModal(); this.content.scrollTop = 0;
    this.dialog.querySelector<HTMLButtonElement>('#rules-close')!.focus({ preventScroll: true });
  }
  close() { if (this.isOpen) this.dialog.close(); }
  dispose() { this.close(); this.abort.abort(); this.dialog.remove(); }
}
