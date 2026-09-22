#!/usr/bin/env node
'use strict';

/*
 * tools/fetch_mizuho.js の解析処理のテストです。ネットワークは使いません。
 *
 *   node tools/test_parse.js
 *
 * tools/testdata/ のHTMLは、みずほ銀行の「抽せん数字一覧表」の画面構成を
 * 再現したものです（回別・抽せん日・本数字・ボーナス数字・等級別の口数と金額・
 * 販売実績額・キャリーオーバー、および「2026年9月分（第2134回〜第2139回）」の見出し）。
 */

var fs = require('fs');
var path = require('path');
var M = require('./fetch_mizuho.js');

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

function readFixture(name) {
  var buf = fs.readFileSync(path.join(__dirname, 'testdata', name));
  return M.decodeBody(buf, null);
}

console.log('みずほ「抽せん数字一覧表」の構成で解析できること');

var t6 = readFixture('mizuho_loto6_202609.html');
var d6 = M.extractDraws(t6, M.SPECS.loto6);
check('ロト6: 見出しの回号を拾わず2件だけ読む', d6.length, 2);
check('ロト6: 第2139回', d6[0], {
  no: 2139, date: '2026-09-21', main: [3, 6, 23, 34, 36, 43], bonus: [29]
});
check('ロト6: 第2138回（1等が該当なしの回）', d6[1], {
  no: 2138, date: '2026-09-17', main: [9, 16, 21, 26, 38, 40], bonus: [12]
});
check('ロト6: 見出しの第2134回が混ざらない', d6.filter(function (d) { return d.no === 2134; }).length, 0);
check('ロト6: 検証エラーなし', M.validate(d6, M.SPECS.loto6), []);

var t7 = readFixture('mizuho_loto7_202609.html');
var d7 = M.extractDraws(t7, M.SPECS.loto7);
check('ロト7: 2件読む', d7.length, 2);
check('ロト7: 第695回（ボーナス2個）', d7[0], {
  no: 695, date: '2026-09-18', main: [5, 6, 11, 16, 22, 24, 34], bonus: [15, 18]
});
check('ロト7: 第694回', d7[1], {
  no: 694, date: '2026-09-11', main: [3, 13, 24, 26, 30, 31, 36], bonus: [23, 34]
});
check('ロト7: 見出しの第693回が混ざらない', d7.filter(function (d) { return d.no === 693; }).length, 0);
check('ロト7: 検証エラーなし', M.validate(d7, M.SPECS.loto7), []);

console.log('見出しが無いレイアウトでも読めること');
var plain = '<table><tr><td>第1898回</td><td>2024年4月25日</td>'
  + '<td>02</td><td>08</td><td>14</td><td>20</td><td>29</td><td>38</td><td>16</td>'
  + '<td>1等 0口 0円</td></tr></table>';
check('フォールバック解析', M.extractDraws(plain, M.SPECS.loto6), [
  { no: 1898, date: '2024-04-25', main: [2, 8, 14, 20, 29, 38], bonus: [16] }
]);

console.log('賞金額や口数を数字として拾わないこと');
var moneyOnly = '<table><tr><th>回別</th><td>第2000回</td></tr>'
  + '<tr><th>抽せん日</th><td>2025年1月6日</td></tr>'
  + '<tr><th>1等</th><td>3口</td><td>100,000,000円</td></tr></table>';
check('数字行が無い回は取り込まない', M.extractDraws(moneyOnly, M.SPECS.loto6), []);

console.log('異常なデータを検証で弾けること');
check('範囲外の数字を検出', M.validate([
  { no: 1, date: null, main: [1, 2, 3, 4, 5, 99], bonus: [7] }
], M.SPECS.loto6).length, 1);
check('空の結果を検出', M.validate([], M.SPECS.loto6).length, 1);

console.log('過去回リンクの抽出と優先順位');
var base = 'https://www.mizuhobank.co.jp/takarakuji/check/loto/loto6/index.html';
var linksHtml = [
  '<a href="#top">上へ</a>',
  '<a href="javascript:void(0)">メニュー</a>',
  '<a href="/takarakuji/check/loto/loto6/index.html">今月分</a>',
  '<a href="./backnumber/detail.html?fromto=2120_2139&amp;type=loto6">バックナンバー</a>',
  '<a href="/takarakuji/check/loto/loto6/index_202608.html">2026年8月分</a>',
  '<a href="/takarakuji/check/loto/loto7/index.html">ロト7</a>',
  '<a href="https://example.com/other.html">外部</a>',
  '<a href="/takarakuji/check/loto/loto6/rule.pdf">ルール</a>'
].join('\n');
var links = M.findCandidateLinks(linksHtml, base);
check('候補は2件', links.length, 2);
check('バックナンバーが最優先', links[0],
  'https://www.mizuhobank.co.jp/takarakuji/check/loto/loto6/backnumber/detail.html?fromto=2120_2139&type=loto6');
check('月別アーカイブも候補', links[1],
  'https://www.mizuhobank.co.jp/takarakuji/check/loto/loto6/index_202608.html');
check('起点ページ自身は除外', links.indexOf(base), -1);

console.log('文字コードの自動判別');
check('Shift_JISで読めている', /ロト6抽せん数字一覧表/.test(t6), true);
check('全角数字を半角に変換', M.extractDraws(
  '<td>第１２３回</td><td>２０２４年１月２日</td><td>０１</td><td>０２</td>'
  + '<td>０３</td><td>０４</td><td>０５</td><td>０６</td><td>０７</td>',
  M.SPECS.loto6).length, 1);

console.log('');
console.log('結果: ' + pass + '件成功 / ' + fail + '件失敗');
process.exit(fail === 0 ? 0 : 1);
