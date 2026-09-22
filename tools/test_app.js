#!/usr/bin/env node
'use strict';

/*
 * index.html のアプリ本体のテストです。ブラウザもネットワークも使いません。
 *
 *   node tools/test_app.js
 *
 * index.html から <script> の中身を取り出し、DOM・localStorage・fetch を差し替えた
 * 関数として実行して、描画結果の文字列を検査します。
 */

var fs = require('fs');
var path = require('path');

var pass = 0;
var fail = 0;

function check(name, actual, expected) {
  var a = JSON.stringify(actual);
  var e = JSON.stringify(expected);
  if (a === e) {
    pass += 1;
    console.log('  ok   ' + name);
  } else {
    fail += 1;
    console.log('  NG   ' + name);
    console.log('       期待: ' + e);
    console.log('       実際: ' + a);
  }
}

function has(name, text, needle) {
  check(name, text.indexOf(needle) >= 0, true);
}

var source = (function () {
  var html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  var m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) { throw new Error('index.html に <script> が見つかりません'); }
  return m[1];
}());

/* アプリを隔離環境で起動する。戻り値でクリックや描画結果を触れる */
function boot(opts) {
  opts = opts || {};
  var appEl = { innerHTML: '', addEventListener: function () { } };
  var els = {};
  var handlers = {};
  var calls = [];
  var inputHooks = {};

  var doc = {
    addEventListener: function (t, f) { handlers[t] = f; },
    getElementById: function (id) {
      if (id === 'app') { return appEl; }
      if (!els[id]) {
        els[id] = {
          value: '',
          innerHTML: '',
          addEventListener: function (t, f) { inputHooks[id] = f; }
        };
      }
      return els[id];
    },
    createElement: function () {
      return { style: {}, appendChild: function () { }, click: function () { }, select: function () { } };
    },
    body: { appendChild: function () { }, removeChild: function () { } }
  };
  var store = {};
  if (opts.saved) { store['lotoStatsApp.v1'] = JSON.stringify(opts.saved); }
  var storage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) { store[k] = v; }
  };
  var served = opts.served || {};
  function fakeFetch(url) {
    calls.push(url);
    if (Object.prototype.hasOwnProperty.call(served, url)) {
      return Promise.resolve({
        ok: true, status: 200,
        text: function () { return Promise.resolve(served[url]); }
      });
    }
    return Promise.resolve({
      ok: false, status: 404,
      text: function () { return Promise.resolve(''); }
    });
  }

  var runner = new Function(
    'window', 'document', 'localStorage', 'navigator', 'location',
    'alert', 'confirm', 'fetch', 'Blob', 'URL',
    source
  );
  runner(
    { addEventListener: function () { } },
    doc,
    storage,
    { onLine: true },
    { protocol: opts.protocol || 'https:' },
    function (m) { calls.push('[alert] ' + m); },
    function () { return true; },
    fakeFetch,
    function () { },
    { createObjectURL: function () { return ''; }, revokeObjectURL: function () { } }
  );

  return {
    html: function () { return appEl.innerHTML; },
    text: function () { return appEl.innerHTML.replace(/<[^>]*>/g, '|').replace(/\|+/g, '|'); },
    els: els,
    calls: calls,
    store: store,
    status: function () { return (els.fetchStatus ? els.fetchStatus.innerHTML : '').replace(/<[^>]*>/g, ''); },
    setPaste: function (v) {
      els.paste = els.paste || { value: '', addEventListener: function (t, f) { inputHooks.paste = f; } };
      els.paste.value = v;
      if (inputHooks.paste) { inputHooks.paste(); }
    },
    click: function (attrs) {
      handlers.click({
        target: {
          getAttribute: function (k) {
            return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null;
          },
          parentNode: null
        }
      });
    },
    set: function (key, value, type) {
      handlers.change({
        target: {
          getAttribute: function (k) { return k === 'data-set' ? key : null; },
          type: type || 'text',
          value: value,
          checked: value === true
        }
      });
    }
  };
}

/* 手で数えられる4回分。各項目の期待値はコメントのとおり */
var SAMPLE = [
  { no: 104, date: null, main: [1, 2, 3, 11, 21, 31], bonus: [5] },
  { no: 103, date: null, main: [2, 5, 9, 14, 22, 33], bonus: [40] },
  { no: 102, date: null, main: [5, 6, 7, 8, 19, 29], bonus: [12] },
  { no: 101, date: null, main: [10, 20, 30, 40, 41, 42], bonus: [1] }
];

console.log('① 出現回数の集計');
var a = boot({ saved: { game: 'loto6', windowSize: 24, data: { loto6: SAMPLE, loto7: [] } } });
a.click({ 'data-act': 'tab', 'data-t': 'freq' });
var freq = a.text();
has('対象期間の表示', freq, '対象: 第101回 〜 第104回（4回分）');
has('延べ出現数は 4回×6個', freq, '24個');
has('2回出た数字は2個（02と05）', freq, '出現回数2回 : 2個');
has('1回出た数字は20個', freq, '出現回数1回 : 20個');
has('未出現は21個', freq, '出現回数0回 : 21個');
check('出現回数の内訳の合計が43個', 2 + 20 + 21, 43);

console.log('② 条件別の出現確率');
var b = boot({ saved: { game: 'loto6', windowSize: 24, data: { loto6: SAMPLE, loto7: [] } } });
b.click({ 'data-act': 'tab', 'data-t': 'cond' });
var cond = b.text();
has('引っ張り1個が2回', cond, '引っ張り 1個|2 / 3|66.7%');
has('引っ張りなしが1回', cond, '引っ張りなし（0個）|1 / 3|33.3%');
has('3連続ありが2回', cond, '3連続あり|2 / 4|50.0%');
has('4連続以上が1回', cond, '4連続以上あり|1 / 4|25.0%');
has('末尾3個一致以上が2回', cond, '3個一致以上あり|2 / 4|50.0%');
has('合計値レンジ', cond, '69〜183');
has('明細の引っ張り表示', cond, '1（02）');
has('明細の連続表示', cond, '05-06-07-08');
has('明細の末尾表示', cond, '10・20・30・40');

console.log('予想の生成');
var c = boot({ saved: { game: 'loto6', windowSize: 24, predictCount: 5, data: { loto6: SAMPLE, loto7: [] } } });
c.click({ 'data-act': 'tab', 'data-t': 'pred' });
c.click({ 'data-act': 'gen' });
var picks = c.html().match(/<span class="chip pick">(\d+)<\/span>/g) || [];
check('5口×6個＝30個の数字を生成', picks.length, 30);
var okSets = true;
for (var p = 0; p < 5; p++) {
  var set = picks.slice(p * 6, p * 6 + 6).map(function (x) { return Number(x.replace(/\D/g, '')); });
  var seen = {};
  for (var q = 0; q < set.length; q++) {
    if (set[q] < 1 || set[q] > 43 || seen[set[q]]) { okSets = false; }
    seen[set[q]] = 1;
  }
}
check('各口が1〜43の重複なし6個', okSets, true);

console.log('貼り付け取り込み');
var d = boot({ saved: { game: 'loto6', data: { loto6: [], loto7: [] } } });
d.setPaste([
  '第1900回 2026年5月2日 03 11 19 24 35 41 (07)',
  '1899,2026/04/29,5,12,18,26,33,43,9',
  '第1898回\t2026.4.25\t2 8 14 20 29 38 [16]',
  '01 04 17 22 31 36 40',
  'ここは数字のない行',
  '第1897回 2026年4月22日 03 11 19 24 35 99 (07)'
].join('\n'));
d.click({ 'data-act': 'import' });
var dataText = d.text();
has('4件取り込み', dataText, '保有データ（4件）');
has('回号と日付を読む', dataText, '2026-05-02');
has('カンマ区切りを読む', dataText, '05 12 18 26 33 43');
has('タブ区切りと角かっこを読む', dataText, '02 08 14 20 29 38');
check('範囲外の数字を含む行を弾く', dataText.indexOf('1897') < 0, true);

console.log('みずほのページをコピーして貼り付け');
var pageCopy = [
  'ロト6抽せん数字一覧表',
  '更新日：2026年9月21日 月曜日',
  '2026年9月分　（第2134回〜第2139回）',
  '回別\t第2139回',
  '抽せん日\t2026年9月21日',
  '本数字\t03\t06\t23\t34\t36\t43',
  'ボーナス数字\t(29)',
  '1等\t1口\t451,342,500円',
  '2等\t5口\t14,016,800円',
  '3等\t243口\t311,400円',
  '4等\t11,392口\t7,000円',
  '5等\t180,788口\t1,000円',
  '販売実績額\t1,422,544,400円',
  'キャリーオーバー\t0円',
  '回別\t第2138回',
  '抽せん日\t2026年9月17日',
  '本数字\t09\t16\t21\t26\t38\t40',
  'ボーナス数字\t(12)',
  '1等\t該当なし\t該当なし',
  '2等\t6口\t10,887,100円'
].join('\n');
var pc = boot({ saved: { game: 'loto6', data: { loto6: [], loto7: [] } } });
pc.setPaste(pageCopy);
pc.click({ 'data-act': 'import' });
var pcText = pc.text();
has('ページのコピーから2件読む', pcText, '保有データ（2件）');
has('第2139回の本数字', pcText, '03 06 23 34 36 43');
has('第2139回のボーナス', pcText, '(29)');
has('第2138回の本数字', pcText, '09 16 21 26 38 40');
has('抽せん日も読む', pcText, '2026-09-21');
check('見出しの第2134回を取り込まない', pcText.indexOf('2134') < 0, true);
check('賞金額を回号にしない', pcText.indexOf('451') < 0, true);

var pc7 = boot({ saved: { game: 'loto7', data: { loto6: [], loto7: [] } } });
pc7.setPaste([
  'ロト7抽せん数字一覧表',
  '2026年9月分　（第693回〜第695回）',
  '回別\t第695回',
  '抽せん日\t2026年9月18日',
  '本数字\t05\t06\t11\t16\t22\t24\t34',
  'ボーナス数字\t(15)\t(18)',
  '1等\t1口\t1,200,000,000円',
  '回別\t第694回',
  '抽せん日\t2026年9月11日',
  '本数字\t03\t13\t24\t26\t30\t31\t36',
  'ボーナス数字\t(23)\t(34)',
  '1等\t1口\t1,200,000,000円'
].join('\n'));
pc7.click({ 'data-act': 'import' });
var pc7Text = pc7.text();
has('ロト7もページのコピーから読む', pc7Text, '保有データ（2件）');
has('ロト7の本数字', pc7Text, '05 06 11 16 22 24 34');
has('ロト7のボーナス2個', pc7Text, '(15 18)');

console.log('回ごとに1行の一覧表を貼り付け');
var listRows6 = [
  '回別\t抽選日\t本数字\tボーナス数字\t1等\t口数\t当せん金\tキャリーオーバー',
  '第2139回\t2026/9/21\t03\t06\t23\t34\t36\t43\t29\t1\t4億5,134万円\t0円',
  '第2138回\t2026/9/17\t09\t16\t21\t26\t38\t40\t12\t0\t該当なし\t2億円',
  '第2135回\t2026/9/7\t07\t13\t32\t34\t37\t39\t41\t0\t該当なし\t2億円',
  '第2133回\t2026/8/31\t01\t11\t14\t20\t29\t38\t27\t1\t2億円\t3千万円',
  '第2130回\t2026/8/20\t12\t18\t35\t40\t41\t43\t03\t1\t5億1,009万円\t0円'
].join('\n');
var lr = boot({ saved: { game: 'loto6', data: { loto6: [], loto7: [] } } });
lr.setPaste(listRows6);
lr.click({ 'data-act': 'import' });
var lrText = lr.text();
has('5件読む', lrText, '保有データ（5件）');
has('スラッシュ区切りの日付を読む', lrText, '2026-09-21');
has('日付の数字を当せん番号にしない', lrText, '03 06 23 34 36 43');
check('日付の 9 と 21 が混ざらない', lrText.indexOf('03 06 09 21 23 34') < 0, true);
has('1桁の月日も読む', lrText, '2026-09-07');
has('当せん金の数字を拾わない', lrText, '12 18 35 40 41 43');
has('該当なしの回も読む', lrText, '09 16 21 26 38 40');

var listRows7 = [
  '回別\t抽選日\t本数字\tbonus数字\t1等\t口数\t当せん金\tキャリーオーバー',
  '第695回\t2026/9/18\t05\t06\t11\t16\t22\t24\t34\t15\t18\t1\t12億円\t8億円',
  '第692回\t2026/8/28\t07\t09\t15\t18\t20\t28\t31\t21\t34\t0\t該当なし\t25億円'
].join('\n');
var lr7 = boot({ saved: { game: 'loto7', data: { loto6: [], loto7: [] } } });
lr7.setPaste(listRows7);
lr7.click({ 'data-act': 'import' });
var lr7Text = lr7.text();
has('ロト7も2件読む', lr7Text, '保有データ（2件）');
has('ロト7の本数字7個', lr7Text, '05 06 11 16 22 24 34');
has('ロト7のボーナス2個', lr7Text, '(15 18)');
has('ロト7の該当なしの回', lr7Text, '07 09 15 18 20 28 31');

console.log('取り込みは常に追加になる');
var addOnly = boot({ saved: { game: 'loto6', data: { loto6: [], loto7: [] } } });
addOnly.setPaste('第2139回 2026/9/21 03 06 23 34 36 43 29 1 4億5,134万円 0円');
addOnly.click({ 'data-act': 'import' });
addOnly.setPaste('第2138回 2026/9/17 09 16 21 26 38 40 12 0 該当なし 2億円');
addOnly.click({ 'data-act': 'import' });
has('前に入れた回が消えない', addOnly.text(), '保有データ（2件）');
addOnly.setPaste('第2139回 2026/9/21 03 06 23 34 36 43 29 1 4億5,134万円 0円');
addOnly.click({ 'data-act': 'import' });
has('同じ回は重複しない', addOnly.text(), '保有データ（2件）');

console.log('予想の作り方の説明');
var ex = boot({ saved: { game: 'loto6', windowSize: 24, data: { loto6: SAMPLE, loto7: [] } } });
ex.click({ 'data-act': 'tab', 'data-t': 'pred' });
var exText = ex.text();
has('重みの式を示す', exText, 'c ＋ 0.9');
has('バランスの誤解を解く', exText, 'ホットとコールドを混ぜる、という意味の「バランス」ではありません');
has('確率は上がらないと明記', exText, 'この操作で当せん確率は上がりません');

console.log('廃止した機能が残っていないこと');
var gone = boot({ saved: { game: 'loto6', data: { loto6: [], loto7: [] } } });
var goneHtml = gone.html();
check('保存済みJSONの読み込み欄が無い', goneHtml.indexOf('remoteBase') < 0, true);
check('手入力の欄が無い', goneHtml.indexOf('manual-add') < 0, true);
check('置き換えボタンが無い', goneHtml.indexOf('import-replace') < 0, true);
check('取り込みボタンはある', goneHtml.indexOf('data-act="import"') >= 0, true);
check('通信しない', gone.calls.length, 0);

console.log('バージョン表示');
var v = fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim();
var sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
var appVer = source.match(/APP_VERSION = '([\d.]+)'/);
check('index.html のバージョンが VERSION と一致', appVer ? appVer[1] : null, v);
check('sw.js のバージョンが VERSION と一致',
  (sw.match(/APP_VERSION = '([\d.]+)'/) || [])[1], v);
has('画面にバージョンを表示', gone.text(), 'v' + v);

console.log('CSSの決まりごと');
var htmlAll = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
check('CSSカスタムプロパティを使っていない', /var\(\s*-/.test(htmlAll), false);
check('ハイフン2つの並びが無い', htmlAll.indexOf('-' + '-') >= 0, false);

console.log('');
console.log('結果: ' + pass + '件成功 / ' + fail + '件失敗');
process.exit(fail === 0 ? 0 : 1);
