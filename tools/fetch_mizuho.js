#!/usr/bin/env node
'use strict';

/*
 * みずほ銀行のサイトからロト6・ロト7の当せん番号を取得して JSON に保存します。
 *
 *   node tools/fetch_mizuho.js [both|loto6|loto7] [出力ディレクトリ] [保持件数]
 *
 * 例: node tools/fetch_mizuho.js both data 120
 *
 * 環境変数
 *   LOTO_PAGES  … バックナンバーを何ページまで辿るか（既定 4）
 *   LOTO_URL    … 起点URLを差し替える
 *   LOTO_FILE   … ネットワークを使わず、保存済みHTMLファイルを解析する（動作確認用）
 *   LOTO_DEBUG  … 1 で詳細ログ
 *
 * 取得先の負荷に配慮し、リクエスト間に待ち時間を入れています。
 * 実行は1日1回程度にとどめてください。
 */

var fs = require('fs');
var path = require('path');

var SPECS = {
  loto6: {
    key: 'loto6',
    label: 'ロト6',
    max: 43,
    main: 6,
    bonus: 1,
    url: 'https://www.mizuhobank.co.jp/retail/takarakuji/loto/loto6/index.html'
  },
  loto7: {
    key: 'loto7',
    label: 'ロト7',
    max: 37,
    main: 7,
    bonus: 2,
    url: 'https://www.mizuhobank.co.jp/retail/takarakuji/loto/loto7/index.html'
  }
};

var UA = 'loto-stats-bot/1.0 (+https://github.com/burneycherry/loto)';
var DEBUG = process.env.LOTO_DEBUG === '1';

function log(msg) { process.stdout.write(msg + '\n'); }
function dbg(msg) { if (DEBUG) { process.stdout.write('  [debug] ' + msg + '\n'); } }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function decodeBody(buf, contentType) {
  var head = Buffer.from(buf).slice(0, 4096).toString('latin1').toLowerCase();
  var enc = null;
  var m = String(contentType || '').toLowerCase().match(/charset=["']?([\w\-]+)/);
  if (m) { enc = m[1]; }
  if (!enc) {
    var m2 = head.match(/charset=["']?([\w\-]+)/);
    if (m2) { enc = m2[1]; }
  }
  if (!enc) { enc = 'shift_jis'; }
  if (/utf.?8/.test(enc)) { enc = 'utf-8'; }
  else if (/shift|sjis|x.sjis|windows.31j|ms932|cp932/.test(enc)) { enc = 'shift_jis'; }
  else if (/euc/.test(enc)) { enc = 'euc-jp'; }
  try {
    return new TextDecoder(enc).decode(buf);
  } catch (e) {
    return new TextDecoder('utf-8').decode(buf);
  }
}

async function fetchText(url) {
  dbg('GET ' + url);
  var res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml,text/csv,*/*',
      'Accept-Language': 'ja'
    },
    redirect: 'follow'
  });
  if (!res.ok) { throw new Error('HTTP ' + res.status + ' : ' + url); }
  var buf = await res.arrayBuffer();
  return decodeBody(buf, res.headers.get('content-type'));
}

function zen2han(s) {
  return s.replace(/[０-９]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });
}

function htmlToText(html) {
  return zen2han(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/[ \t　]+/g, ' ')
    .replace(/\n[ ]+/g, '\n')
    .replace(/\n{2,}/g, '\n');
}

function numbersIn(text, spec, want) {
  var found = [];
  var seen = {};
  var re = /\d+/g;
  var m;
  while ((m = re.exec(text)) !== null) {
    var v = Number(m[0]);
    if (v < 1 || v > spec.max) { continue; }
    if (seen[v]) { continue; }
    seen[v] = 1;
    found.push(v);
    if (found.length >= want) { break; }
  }
  return found;
}

/*
 * 1回分のテキストブロックから本数字とボーナス数字を取り出します。
 * 「本数字」「ボーナス数字」の見出しがあればそれを手がかりにし、
 * 無い場合は賞金欄（「等」「円」以降）を切り捨てたうえで先頭から拾います。
 */
function parseBlock(block, spec) {
  var iMain = block.search(/本数字/);
  var iBonus = block.search(/ボーナス/);
  var mainNums = null;
  var bonusNums = null;

  if (iMain >= 0 && iBonus > iMain) {
    mainNums = numbersIn(block.slice(iMain + 3, iBonus), spec, spec.main);
    var tail = block.slice(iBonus);
    var cut = tail.search(/[等円口]/);
    if (cut > 0) { tail = tail.slice(0, cut); }
    bonusNums = numbersIn(tail, spec, spec.bonus);
  } else {
    var body = block;
    var dm = body.match(/\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/);
    if (dm) { body = body.slice(body.indexOf(dm[0]) + dm[0].length); }
    var cut2 = body.search(/[等円]/);
    if (cut2 > 0) { body = body.slice(0, cut2); }
    var all = numbersIn(body, spec, spec.main + spec.bonus);
    if (all.length === spec.main + spec.bonus) {
      mainNums = all.slice(0, spec.main);
      bonusNums = all.slice(spec.main);
    }
  }

  if (!mainNums || !bonusNums) { return null; }
  if (mainNums.length !== spec.main || bonusNums.length !== spec.bonus) { return null; }
  var seen = {};
  var joined = mainNums.concat(bonusNums);
  for (var i = 0; i < joined.length; i++) {
    var v = joined[i];
    if (!(v >= 1 && v <= spec.max) || seen[v]) { return null; }
    seen[v] = 1;
  }
  return {
    main: mainNums.slice().sort(function (a, b) { return a - b; }),
    bonus: bonusNums.slice().sort(function (a, b) { return a - b; })
  };
}

function extractDraws(html, spec) {
  var text = htmlToText(html);
  var re = /第\s*(\d{1,4})\s*回/g;
  var marks = [];
  var m;
  while ((m = re.exec(text)) !== null) {
    marks.push({ no: Number(m[1]), at: m.index, end: m.index + m[0].length });
  }
  var out = [];
  for (var i = 0; i < marks.length; i++) {
    var no = marks[i].no;
    if (!(no >= 1 && no <= 9999)) { continue; }
    var stop = i + 1 < marks.length ? marks[i + 1].at : text.length;
    var block = text.slice(marks[i].end, Math.min(stop, marks[i].end + 1200));
    var dm = block.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
    var nums = parseBlock(block, spec);
    if (!nums) { dbg('第' + no + '回: 数字を読めずスキップ'); continue; }
    out.push({
      no: no,
      date: dm ? (dm[1] + '-' + ('0' + dm[2]).slice(-2) + '-' + ('0' + dm[3]).slice(-2)) : null,
      main: nums.main,
      bonus: nums.bonus
    });
  }
  return out;
}

function findBacknumberLinks(html, baseUrl) {
  var out = [];
  var seen = {};
  var re = /href\s*=\s*["']([^"']+)["']/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    var href = m[1]
      .replace(/&amp;/gi, '&')
      .replace(/&#38;/g, '&')
      .trim();
    if (!/backnumber/i.test(href)) { continue; }
    if (/\.(pdf|csv|zip)$/i.test(href)) { continue; }
    var abs;
    var host;
    try {
      var u = new URL(href, baseUrl);
      abs = u.toString();
      host = u.host;
    } catch (e) { continue; }
    if (host !== new URL(baseUrl).host) { continue; }
    if (seen[abs]) { continue; }
    seen[abs] = 1;
    out.push(abs);
  }
  return out;
}

function mergeDraws(base, add) {
  var map = {};
  var i;
  for (i = 0; i < base.length; i++) { map[base[i].no] = base[i]; }
  for (i = 0; i < add.length; i++) {
    var d = add[i];
    if (!map[d.no] || (!map[d.no].date && d.date)) { map[d.no] = d; }
  }
  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return b.no - a.no; });
}

async function collect(spec, limit, pages) {
  var startUrl = process.env.LOTO_URL || spec.url;
  var draws = [];

  if (process.env.LOTO_FILE) {
    var html0 = fs.readFileSync(process.env.LOTO_FILE, 'latin1');
    var buf = Buffer.from(html0, 'latin1');
    draws = extractDraws(decodeBody(buf, null), spec);
    log('  ' + spec.label + ': ローカルファイルから ' + draws.length + '件');
    return draws.slice(0, limit);
  }

  var html = await fetchText(startUrl);
  draws = mergeDraws(draws, extractDraws(html, spec));
  log('  ' + spec.label + ': 起点ページから ' + draws.length + '件');

  var links = findBacknumberLinks(html, startUrl);
  dbg('バックナンバー候補 ' + links.length + '件');
  var visited = 0;
  for (var i = 0; i < links.length && visited < pages && draws.length < limit; i++) {
    await sleep(1200);
    try {
      var sub = await fetchText(links[i]);
      visited += 1;
      var before = draws.length;
      draws = mergeDraws(draws, extractDraws(sub, spec));
      log('  ' + spec.label + ': ' + links[i] + ' から ' + (draws.length - before) + '件追加（計 ' + draws.length + '件）');
      var more = findBacknumberLinks(sub, links[i]);
      for (var j = 0; j < more.length; j++) {
        if (links.indexOf(more[j]) < 0) { links.push(more[j]); }
      }
    } catch (e) {
      log('  ' + spec.label + ': 取得失敗 ' + links[i] + ' (' + e.message + ')');
    }
  }
  return draws.slice(0, limit);
}

function validate(draws, spec) {
  var errs = [];
  if (draws.length === 0) {
    errs.push('1件も取得できませんでした（ページ構成が変わった可能性があります）');
    return errs;
  }
  for (var i = 0; i < draws.length; i++) {
    var d = draws[i];
    if (d.main.length !== spec.main || d.bonus.length !== spec.bonus) {
      errs.push('第' + d.no + '回: 数字の個数が不正');
    }
    var seen = {};
    var all = d.main.concat(d.bonus);
    for (var j = 0; j < all.length; j++) {
      if (!(all[j] >= 1 && all[j] <= spec.max) || seen[all[j]]) {
        errs.push('第' + d.no + '回: 数字が範囲外または重複');
        break;
      }
      seen[all[j]] = 1;
    }
  }
  return errs;
}

async function main() {
  var target = process.argv[2] || 'both';
  var outDir = process.argv[3] || 'data';
  var limit = Number(process.argv[4] || 120);
  var pages = Number(process.env.LOTO_PAGES || 4);
  var keys = target === 'both' ? ['loto6', 'loto7'] : [target];
  var failed = 0;

  fs.mkdirSync(outDir, { recursive: true });

  for (var i = 0; i < keys.length; i++) {
    var spec = SPECS[keys[i]];
    if (!spec) { log('不明な対象: ' + keys[i]); failed += 1; continue; }
    log(spec.label + ' の取得を開始');
    var draws;
    try {
      draws = await collect(spec, limit, pages);
    } catch (e) {
      log('  ' + spec.label + ': 取得に失敗しました: ' + e.message);
      failed += 1;
      continue;
    }
    var errs = validate(draws, spec);
    if (errs.length > 0) {
      log('  ' + spec.label + ': 検証エラー ' + errs.length + '件');
      for (var e2 = 0; e2 < Math.min(errs.length, 5); e2++) { log('    ' + errs[e2]); }
      failed += 1;
      continue;
    }
    var outPath = path.join(outDir, spec.key + '.json');
    var prev = null;
    try { prev = fs.readFileSync(outPath, 'utf8'); } catch (e3) { prev = null; }
    if (prev) {
      try {
        draws = mergeDraws(JSON.parse(prev), draws).slice(0, limit);
      } catch (e4) { /* 壊れていれば新しい内容で置き換える */ }
    }
    var json = JSON.stringify(draws, null, 1) + '\n';
    fs.writeFileSync(outPath, json, 'utf8');
    log('  ' + spec.label + ': ' + outPath + ' に ' + draws.length + '件を保存（最新 第' + draws[0].no + '回）');
  }

  if (failed > 0) {
    log('失敗: ' + failed + '件');
    process.exit(1);
  }
  log('完了');
}

main().catch(function (e) {
  log('想定外のエラー: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
