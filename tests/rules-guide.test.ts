import test from 'node:test';
import assert from 'node:assert/strict';
import {ruleSections} from '../src/rules-guide';
test('FightFlight guide uses its own modes, ending and ranking rather than naval mission rules',()=>{
 for(const mode of ['easy','normal'] as const)for(const input of ['touch','keyboard'] as const){
  const sections=ruleSections({mode,input,keyboardDescription:'Fで射撃・Pで停止'}),text=JSON.stringify(sections);
  assert.match(text,/1200m/);assert.match(text,/14秒/);assert.match(text,/最大5機/);assert.match(text,/上位30位/);assert.match(text,/名前は任意/);
  assert.ok(sections[0].paragraphs.some(p=>p.includes(mode==='easy'?'300秒':'時間無制限')));
  assert.doesNotMatch(text,/魚雷|爆弾|敵艦|僚機|タイムアタック/);
  assert.equal(text.includes('Fで射撃・Pで停止'),input==='keyboard');
  assert.match(text,/説明や設定を閉じても自動では飛行を再開しません/);
 }
});
