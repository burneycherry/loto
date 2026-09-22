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
d.click({ 'data-act': 'import-replace' });
var dataText = d.text();
has('4件取り込み', dataText, '保有データ（4件）');
has('回号と日付を読む', dataText, '2026-05-02');
has('カンマ区切りを読む', dataText, '05 12 18 26 33 43');
has('タブ区切りと角かっこを読む', dataText, '02 08 14 20 29 38');
check('範囲外の数字を含む行を弾く', dataText.indexOf('1897') < 0, true);

console.log('保存済みデータの自動取得');
var json6 = JSON.stringify([
  { no: 2139, date: '2026-09-21', main: [3, 6, 23, 34, 36, 43], bonus: [29] },
  { no: 2138, date: '2026-09-17', main: [9, 16, 21, 26, 38, 40], bonus: [12] }
]);
var e = boot({
  saved: {
    game: 'loto6',
    remoteBase: 'https://www.mizuhobank.co.jp/takarakuji/check/loto/loto6/index.html',
    data: { loto6: [], loto7: [] }
  },
  served: { './data/loto6.json': json6 }
});
e.click({ 'data-act': 'fetch-remote' });

setTimeout(function () {
  check('保存されていたみずほURLは無視して同じ場所を見る', e.calls, ['./data/loto6.json']);
  has('取得できた', e.text(), 'ロト6 を取得しました（読込 2件 / 新規 2件 / 保有 2件）');

  var f = boot({ saved: { game: 'loto6', data: { loto6: [], loto7: [] } }, served: {} });
  f.set('remoteBase', 'https://www.mizuhobank.co.jp/takarakuji/check/loto/loto6/index.html');
  f.click({ 'data-act': 'fetch-remote' });
  check('みずほURLを入れたら通信せずに止める', f.calls.length, 0);
  has('理由を伝える', f.status(), 'ここはみずほではなく');
  f.click({ 'data-act': 'reset-remote' });
  has('既定に戻せる', f.text(), '取得元を既定');

  var h = boot({ saved: { game: 'loto6', data: { loto6: [], loto7: [] } }, served: {} });
  h.click({ 'data-act': 'fetch-remote' });
  setTimeout(function () {
    has('データ未作成時に試したURLを示す', h.status(), './data/loto6.json');
    has('原因の見当を示す', h.status(), 'まだ作られていない');

    console.log('バージョン表示');
    var v = fs.readFileSync(path.join(__dirname, '..', 'VERSION'), 'utf8').trim();
    var sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
    var appVer = source.match(/APP_VERSION = '([\d.]+)'/);
    check('index.html のバージョンが VERSION と一致', appVer ? appVer[1] : null, v);
    check('sw.js のバージョンが VERSION と一致',
      (sw.match(/APP_VERSION = '([\d.]+)'/) || [])[1], v);
    has('画面にバージョンを表示', h.text(), 'v' + v);

    console.log('CSSの決まりごと');
    var htmlAll = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    check('CSSカスタムプロパティを使っていない', /var\(\s*-/.test(htmlAll), false);
    check('ハイフン2つの並びが無い', htmlAll.indexOf('-' + '-') >= 0, false);

    console.log('');
    console.log('結果: ' + pass + '件成功 / ' + fail + '件失敗');
    process.exit(fail === 0 ? 0 : 1);
  }, 30);
}, 30);
