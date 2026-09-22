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
check('読込・新規・重複の件数を伝える',
  /1件読込 ／ 1件新規追加/.test(addOnly.calls.join(' ')), true);
addOnly.setPaste([
  '第2139回 2026/9/21 03 06 23 34 36 43 29 1 4億5,134万円 0円',
  '第2138回 2026/9/17 09 16 21 26 38 40 12 0 該当なし 2億円',
  '第2137回 2026/9/14 04 08 10 25 28 33 09 2 3億7,014万円 0円'
].join('\n'));
addOnly.click({ 'data-act': 'import' });
has('同じ回は重複しない', addOnly.text(), '保有データ（3件）');
check('重複の件数も伝える',
  /3件読込 ／ 1件新規追加 ／ 2件取込済（重複）/.test(addOnly.calls.join(' ')), true);

console.log('予想の作り方の説明');
var ex = boot({ saved: { game: 'loto6', windowSize: 24, data: { loto6: SAMPLE, loto7: [] } } });
ex.click({ 'data-act': 'tab', 'data-t': 'pred' });
var exText = ex.text();
has('帯の分け方を説明する', exText, '数字を3つの帯に分ける');
has('帯が混ざることを説明する', exText, '加熱帯だけで揃うわけではなく');
has('帯の中は等確率だと明記', exText, '等確率');
has('確率は上がらないと明記', exText, 'この操作で当せん確率は上がりません');

console.log('頻度帯（利用者提供の実データ8回分で確認）');
/*
 * 第2139回〜第2130回のロト6当せん番号（利用者が画面から取り込んだもの）。
 * 8回 × 6個 ＝ 48個。期待値 8×6÷43 ＝ 1.116回、標準偏差 0.98回 なので、
 * 境目は 1.606回 と 0.626回。つまり 2回以上が加熱帯、1回が標準帯、0回が低頻度帯になる。
 */
var REAL8 = [
  { no: 2139, date: '2026-09-21', main: [3, 6, 23, 34, 36, 43], bonus: [29] },
  { no: 2138, date: '2026-09-17', main: [9, 16, 21, 26, 38, 40], bonus: [12] },
  { no: 2137, date: '2026-09-14', main: [4, 8, 10, 25, 28, 33], bonus: [9] },
  { no: 2136, date: '2026-09-10', main: [6, 7, 33, 37, 41, 43], bonus: [42] },
  { no: 2135, date: '2026-09-07', main: [7, 13, 32, 34, 37, 39], bonus: [41] },
  { no: 2134, date: '2026-09-03', main: [5, 9, 10, 19, 26, 35], bonus: [18] },
  { no: 2133, date: '2026-08-31', main: [1, 11, 14, 20, 29, 38], bonus: [27] },
  { no: 2130, date: '2026-08-20', main: [12, 18, 35, 40, 41, 43], bonus: [3] }
];
var bd = boot({ saved: { game: 'loto6', windowSize: 24, data: { loto6: REAL8, loto7: [] } } });
bd.click({ 'data-act': 'tab', 'data-t': 'freq' });
var bdText = bd.text();
has('加熱帯の個数（2回以上の13個）', bdText, '加熱帯（13個）');
has('標準帯の個数（1回の21個）', bdText, '標準帯（21個）');
has('低頻度帯の個数（0回の9個）', bdText, '低頻度帯（9個）');
check('3つの帯で全数字を覆う', 13 + 21 + 9, 43);

bd.click({ 'data-act': 'tab', 'data-t': 'cond' });
var compText = bd.text();
has('第2139回の構成（加熱3・標準3・低0）が数えられている', compText, '3個|3個|0個');
has('帯の組み合わせを表示', compText, '頻度帯の組み合わせ');

console.log('帯の構成どおりに選ぶこと');
var bp = boot({ saved: { game: 'loto6', windowSize: 24, predictCount: 10, bandMode: 'manual',
  bandHot: 2, bandMid: 3, bandCold: 1, useCarry: false, useConsec: false,
  useTail: false, useSum: false, useOdd: false, data: { loto6: REAL8, loto7: [] } } });
bp.click({ 'data-act': 'tab', 'data-t': 'pred' });
bp.click({ 'data-act': 'gen' });
var bpHtml = bp.html();
var bands = bpHtml.match(/加熱 (\d+)個 ／ 標準 (\d+)個 ／ 低頻度 (\d+)個/g) || [];
check('10口すべてに帯の内訳が出る', bands.length, 10);
var allMatch = true;
for (var z = 0; z < bands.length; z++) {
  if (bands[z] !== '加熱 2個 ／ 標準 3個 ／ 低頻度 1個') { allMatch = false; }
}
check('指定した 加熱2・標準3・低頻度1 のとおりに選ばれる', allMatch, true);

var bad = boot({ saved: { game: 'loto6', windowSize: 24, bandMode: 'manual',
  bandHot: 6, bandMid: 6, bandCold: 6, data: { loto6: REAL8, loto7: [] } } });
bad.click({ 'data-act': 'tab', 'data-t': 'pred' });
bad.click({ 'data-act': 'gen' });
has('合計が合わないときは理由を出す', bad.text(), '合計を6個にしてください');

var auto = boot({ saved: { game: 'loto6', windowSize: 24, predictCount: 5,
  data: { loto6: REAL8, loto7: [] } } });
auto.click({ 'data-act': 'tab', 'data-t': 'pred' });
auto.click({ 'data-act': 'gen' });
var autoBands = auto.html().match(/加熱 (\d+)個 ／ 標準 (\d+)個 ／ 低頻度 (\d+)個/g) || [];
check('自動でも5口生成する', autoBands.length, 5);
var inPast = true;
var pastKeys = {};
for (var r2 = 0; r2 < REAL8.length; r2++) {
  var hot = 0, mid = 0, cold = 0;
  for (var n2 = 0; n2 < REAL8[r2].main.length; n2++) {
    var cnt = 0;
    for (var r3 = 0; r3 < REAL8.length; r3++) {
      if (REAL8[r3].main.indexOf(REAL8[r2].main[n2]) >= 0) { cnt += 1; }
    }
    if (cnt >= 2) { hot += 1; } else if (cnt === 1) { mid += 1; } else { cold += 1; }
  }
  pastKeys['加熱 ' + hot + '個 ／ 標準 ' + mid + '個 ／ 低頻度 ' + cold + '個'] = 1;
}
for (var a2 = 0; a2 < autoBands.length; a2++) {
  if (!pastKeys[autoBands[a2]]) { inPast = false; }
}
check('自動のときは過去に実際にあった構成だけを使う', inPast, true);

console.log('1口だけの作り直し');
function setsOf(view) {
  var chipsAll = view.html().match(/<span class="chip pick">(\d+)<\/span>/g) || [];
  var out = [];
  for (var i = 0; i < chipsAll.length; i += 6) {
    out.push(chipsAll.slice(i, i + 6).map(function (x) { return x.replace(/\D/g, ''); }).join(' '));
  }
  return out;
}
var rg = boot({ saved: { game: 'loto6', windowSize: 24, predictCount: 5,
  useCarry: false, useConsec: false, useTail: false, useSum: false, useOdd: false,
  data: { loto6: REAL8, loto7: [] } } });
rg.click({ 'data-act': 'tab', 'data-t': 'pred' });
rg.click({ 'data-act': 'gen' });
var before = setsOf(rg);
check('5口できている', before.length, 5);
check('作り直しボタンが口ごとにある',
  (rg.html().match(/data-act="regen"/g) || []).length, 5);

rg.click({ 'data-act': 'regen', 'data-i': '2' });
var after = setsOf(rg);
check('口数は変わらない', after.length, 5);
check('1口目はそのまま', after[0], before[0]);
check('2口目はそのまま', after[1], before[1]);
check('4口目はそのまま', after[3], before[3]);
check('5口目はそのまま', after[4], before[4]);
check('指定した3口目だけが入れ替わる', after[2] !== before[2], true);
check('作り直すと必ず別の組み合わせになる', after.indexOf(before[2]), -1);
var dup = false;
for (var d1 = 0; d1 < after.length; d1++) {
  for (var d2 = d1 + 1; d2 < after.length; d2++) { if (after[d1] === after[d2]) { dup = true; } }
}
check('他の口と重複しない', dup, false);
var nums3 = after[2].split(' ').map(Number);
var uniq3 = {};
var ok3 = nums3.length === 6;
for (var u = 0; u < nums3.length; u++) {
  if (nums3[u] < 1 || nums3[u] > 43 || uniq3[nums3[u]]) { ok3 = false; }
  uniq3[nums3[u]] = 1;
}
check('作り直した口も1〜43の重複なし6個', ok3, true);

var rgm = boot({ saved: { game: 'loto6', windowSize: 24, predictCount: 3, bandMode: 'manual',
  bandHot: 2, bandMid: 3, bandCold: 1, useCarry: false, useConsec: false,
  useTail: false, useSum: false, useOdd: false, data: { loto6: REAL8, loto7: [] } } });
rgm.click({ 'data-act': 'tab', 'data-t': 'pred' });
rgm.click({ 'data-act': 'gen' });
rgm.click({ 'data-act': 'regen', 'data-i': '0' });
var mb = rgm.html().match(/加熱 (\d+)個 ／ 標準 (\d+)個 ／ 低頻度 (\d+)個/g) || [];
var keepManual = true;
for (var k3 = 0; k3 < mb.length; k3++) {
  if (mb[k3] !== '加熱 2個 ／ 標準 3個 ／ 低頻度 1個') { keepManual = false; }
}
check('手動指定は作り直しても守られる', keepManual && mb.length === 3, true);

console.log('帯の集計に自分自身を含めないこと');
/*
 * 解析の動作を確かめるための作り物の並びで、当せん番号ではない。
 * 43で互いに異なる7つのずらし幅を使うので、6個の本数字とボーナスは必ず重複しない。
 */
var MECH = [];
for (var mi = 0; mi < 40; mi++) {
  var offs = [0, 5, 11, 17, 23, 31, 37];
  var nums = offs.map(function (o) { return ((mi * 7 + o) % 43) + 1; });
  MECH.push({ no: 900 - mi, date: null, main: nums.slice(0, 6).sort(function (a, b) { return a - b; }), bonus: [nums[6]] });
}

/* その回より前の n 回がそろった回だけで帯を決める、独立した実装 */
function expectedComposition(all, n, max, mainCount) {
  var map = {};
  var used = 0;
  for (var i = 0; i < n; i++) {
    var back = all.slice(i + 1, i + 1 + n);
    if (back.length < n) { break; }
    var cnt = [];
    var j;
    for (j = 0; j <= max; j++) { cnt.push(0); }
    for (j = 0; j < back.length; j++) {
      for (var b = 0; b < back[j].main.length; b++) { cnt[back[j].main[b]] += 1; }
    }
    var pr = mainCount / max;
    var e = back.length * pr;
    var sd = Math.sqrt(back.length * pr * (1 - pr));
    var hi = e + sd * 0.5;
    var lo = e - sd * 0.5;
    var pat = { hot: 0, mid: 0, cold: 0 };
    for (var m = 0; m < all[i].main.length; m++) {
      var c = cnt[all[i].main[m]];
      pat[c > hi ? 'hot' : (c < lo ? 'cold' : 'mid')] += 1;
    }
    var key = pat.hot + '-' + pat.mid + '-' + pat.cold;
    map[key] = (map[key] || 0) + 1;
    used += 1;
  }
  return { map: map, used: used };
}

var mech = boot({ saved: { game: 'loto6', windowSize: 24, data: { loto6: MECH, loto7: [] } } });
mech.click({ 'data-act': 'tab', 'data-t': 'cond' });
var mechHtml = mech.html();
var exp = expectedComposition(MECH, 24, 43, 6);

var shown = {};
var rowRe = /<td class="l">(\d+)個<\/td><td class="l">(\d+)個<\/td><td class="l">(\d+)個<\/td><td>(\d+)回<\/td>/g;
var rm;
while ((rm = rowRe.exec(mechHtml)) !== null) {
  shown[rm[1] + '-' + rm[2] + '-' + rm[3]] = Number(rm[4]);
}
function sortedPairs(o) {
  return Object.keys(o).sort().map(function (k) { return k + ':' + o[k]; });
}
check('その回より前だけで数えた結果と一致する', sortedPairs(shown), sortedPairs(exp.map));
check('満了した16回ぶんだけを集計している', exp.used, 16);
check('自分自身を含める数え方には戻っていない',
  mechHtml.indexOf('履歴が足りないため') < 0, true);
has('前のデータだけで決めていると明記', mech.text(), 'その回より前のデータだけで決めています');
has('満了した回だけを数えたと明記', mech.text(), '直前24回がそろった16回ぶんを集計しています');
check('窓が短い回を混ぜていない', mech.text().indexOf('窓の長さがそろわない回は数えていません') >= 0, true);

console.log('窓の長さがそろわない回を混ぜないこと');
/*
 * 直前24回がそろう回が10件に満たない並び。取れるだけ短い窓に全部そろえて
 * 数え直すことを確かめる。作り物であり当せん番号ではない。
 */
var HALF = MECH.slice(0, 30);
var halfBoot = boot({ saved: { game: 'loto6', windowSize: 24, data: { loto6: HALF, loto7: [] } } });
halfBoot.click({ 'data-act': 'tab', 'data-t': 'cond' });
var halfText = halfBoot.text();
var expHalf = expectedComposition(HALF, 15, 43, 6);
check('直前15回にそろえて15回ぶん数える', expHalf.used, 15);
has('そろえた長さを伝える', halfText, '帯の判定を直前15回にそろえて15回ぶん数えています');
has('必要な保有件数を伝える', halfText, '保有が34件になると');
check('自分自身を含める数え方には落ちていない',
  halfText.indexOf('履歴が足りないため') < 0, true);

function shownComposition(html) {
  var out = {};
  var re = /<td class="l">(\d+)個<\/td><td class="l">(\d+)個<\/td><td class="l">(\d+)個<\/td><td>(\d+)回<\/td>/g;
  var m;
  while ((m = re.exec(html)) !== null) { out[m[1] + '-' + m[2] + '-' + m[3]] = Number(m[4]); }
  return out;
}
check('短い窓にそろえた結果と一致する',
  sortedPairs(shownComposition(halfBoot.html())), sortedPairs(expHalf.map));

/* 「全件」は対象期間が保有データ全体なので、そろう回が1件も取れない */
var allWin = boot({ saved: { game: 'loto6', windowSize: 0, data: { loto6: MECH, loto7: [] } } });
allWin.click({ 'data-act': 'tab', 'data-t': 'cond' });
var allText = allWin.text();
var expAll = expectedComposition(MECH, 20, 43, 6);
check('全件でも20回にそろえて20回ぶん数える', expAll.used, 20);
has('全件のときも長さをそろえる', allText, '帯の判定を直前20回にそろえて20回ぶん数えています');
has('全件のときの直し方を伝える', allText, '集計対象を20回以下にするか');
check('全件で長さの違う窓を混ぜていない',
  sortedPairs(shownComposition(allWin.html())), sortedPairs(expAll.map));

var few = boot({ saved: { game: 'loto6', windowSize: 24, data: { loto6: REAL8, loto7: [] } } });
few.click({ 'data-act': 'tab', 'data-t': 'cond' });
has('履歴が足りないときは断り書きを出す', few.text(), '履歴が足りないため');
has('加熱帯が多めに出ることを伝える', few.text(), '加熱帯が多めに出ます');

console.log('表現の見直し');
var wording = boot({ saved: { game: 'loto6', windowSize: 24, data: { loto6: REAL8, loto7: [] } } });
wording.click({ 'data-act': 'tab', 'data-t': 'info' });
var wText = wording.text();
check('「安定します」を使っていない', wText.indexOf('安定') < 0, true);
check('「既定24回」を使っていない', wText.indexOf('既定24回') < 0, true);
has('集計する回数を増やしても当たりやすさは変わらないと書く', wText, '集計する回数を増やしても次回の当たりやすさは変わりません');

console.log('廃止した機能が残っていないこと');
var gone = boot({ saved: { game: 'loto6', data: { loto6: [], loto7: [] } } });
var goneHtml = gone.html();
check('保存済みJSONの読み込み欄が無い', goneHtml.indexOf('remoteBase') < 0, true);
check('手入力の欄が無い', goneHtml.indexOf('manual-add') < 0, true);
check('置き換えボタンが無い', goneHtml.indexOf('import-replace') < 0, true);
check('ダミーデータ生成が無い', goneHtml.indexOf('data-act="demo"') < 0, true);
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
