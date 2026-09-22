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
 *   LOTO_MONTHS … 何か月前まで遡るか（既定 30）
 *   LOTO_SLEEP  … リクエスト間隔のミリ秒（既定 1200。むやみに小さくしないこと）
 *   LOTO_UA     … User-Agent を差し替える
 *   LOTO_URL    … 起点URLを差し替える
 *   LOTO_URLS   … 取得するURLをカンマ区切りで直接指定（巡回せずこの一覧だけを読む）
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
    minYear: 2000,
    url: 'https://www.mizuhobank.co.jp/takarakuji/check/loto/loto6/index.html'
  },
  loto7: {
    key: 'loto7',
    label: 'ロト7',
    max: 37,
    main: 7,
    bonus: 2,
    minYear: 2013,
    url: 'https://www.mizuhobank.co.jp/takarakuji/check/loto/loto7/index.html'
  }
};

var UA = process.env.LOTO_UA
  || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
var DEBUG = process.env.LOTO_DEBUG === '1';

function log(msg) { process.stdout.write(msg + '\n'); }
function dbg(msg) { if (DEBUG) { process.stdout.write('  [debug] ' + msg + '\n'); } }
var SLEEP_MS = Number(process.env.LOTO_SLEEP === undefined ? 1200 : process.env.LOTO_SLEEP);
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

async function fetchText(url, referer) {
  dbg('GET ' + url);
  var headers = {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ja,en-US;q=0.9,en;q=0.8',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Upgrade-Insecure-Requests': '1'
  };
  if (referer) { headers.Referer = referer; }
  var res = await fetch(url, { headers: headers, redirect: 'follow' });
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error('HTTP 403（アクセスを拒否されました。'
        + 'User-Agent が弾かれているか、実行元のIPが拒否されている可能性があります）: ' + url);
    }
    throw new Error('HTTP ' + res.status + ' : ' + url);
  }
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
    var dm = block.slice(0, 200).match(/\d{4}\s*[年\/\.\-]\s*\d{1,2}\s*[月\/\.\-]\s*\d{1,2}\s*日?/);
    if (!dm) { return null; }
    var body = block.slice(block.indexOf(dm[0]) + dm[0].length);
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
    var dm = block.slice(0, 200).match(/(\d{4})\s*[年\/\.\-]\s*(\d{1,2})\s*[月\/\.\-]\s*(\d{1,2})\s*日?/);
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

/*
 * みずほの「抽せん数字一覧表」は1か月分ずつの掲載で、
 * 過去の月は index.html?year=2026&month=8 の形式で参照できます。
 */
function baseUrl(spec) {
  return process.env.LOTO_URL || spec.url;
}

function monthUrl(spec, year, month) {
  var u = new URL(baseUrl(spec));
  u.searchParams.set('year', String(year));
  u.searchParams.set('month', String(month));
  return u.toString();
}

function prevMonth(year, month) {
  var m = month - 1;
  var y = year;
  if (m < 1) { m = 12; y = y - 1; }
  return { year: y, month: m };
}

/* 日本時間での今日の年月（みずほの掲載は日本時間基準のため） */
function todayJst() {
  var now = new Date(Date.now() + 9 * 3600 * 1000);
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
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

async function collect(spec, limit, months, fetchFn, existing) {
  var get = fetchFn || fetchText;
  var draws = (existing || []).slice();

  if (process.env.LOTO_FILE) {
    var buf = fs.readFileSync(process.env.LOTO_FILE);
    draws = mergeDraws(draws, extractDraws(decodeBody(buf, null), spec));
    log('  ' + spec.label + ': ローカルファイルから 計' + draws.length + '件');
    return draws.slice(0, limit);
  }

  if (process.env.LOTO_URLS) {
    var listed = process.env.LOTO_URLS.split(',').map(function (x) { return x.trim(); })
      .filter(function (x) { return x.length > 0; });
    for (var u2 = 0; u2 < listed.length; u2++) {
      if (u2 > 0) { await sleep(SLEEP_MS); }
      try {
        var page = await get(listed[u2]);
        var was = draws.length;
        draws = mergeDraws(draws, extractDraws(page, spec));
        log('  ' + spec.label + ': ' + listed[u2] + ' から ' + (draws.length - was) + '件（計 ' + draws.length + '件）');
      } catch (e5) {
        log('  ' + spec.label + ': 取得失敗 ' + listed[u2] + ' (' + e5.message + ')');
      }
    }
    return draws.slice(0, limit);
  }

  /* 当月のページ */
  var first = await get(baseUrl(spec));
  var before0 = draws.length;
  draws = mergeDraws(draws, extractDraws(first, spec));
  log('  ' + spec.label + ': 当月ページから ' + (draws.length - before0) + '件（計 ' + draws.length + '件）');

  /* 遡る起点の年月。最新回の抽せん日があればそこから、無ければ日本時間の今月から */
  var cur = todayJst();
  if (draws.length > 0 && draws[0].date) {
    var ym = draws[0].date.split('-');
    cur = { year: Number(ym[0]), month: Number(ym[1]) };
  }

  var emptyRun = 0;
  for (var k = 0; k < months; k++) {
    if (draws.length >= limit) {
      dbg('保持件数が上限に達したため終了');
      break;
    }
    cur = prevMonth(cur.year, cur.month);
    if (cur.year < spec.minYear) {
      dbg('発売開始年より前のため終了');
      break;
    }
    var url = monthUrl(spec, cur.year, cur.month);
    await sleep(SLEEP_MS);
    var added = 0;
    try {
      var text = await get(url, baseUrl(spec));
      var before = draws.length;
      draws = mergeDraws(draws, extractDraws(text, spec));
      added = draws.length - before;
    } catch (e6) {
      log('  ' + spec.label + ': 取得失敗 ' + url + ' (' + e6.message + ')');
      added = 0;
    }
    if (added > 0) {
      emptyRun = 0;
      log('  ' + spec.label + ': ' + cur.year + '年' + cur.month + '月分から ' + added + '件（計 ' + draws.length + '件）');
    } else {
      emptyRun += 1;
      dbg(cur.year + '年' + cur.month + '月分: 新しい回なし');
      if (emptyRun >= 2) {
        dbg('既知の回に追いついたため終了');
        break;
      }
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
  var months = Number(process.env.LOTO_MONTHS || 30);
  var keys = target === 'both' ? ['loto6', 'loto7'] : [target];
  var failed = 0;

  fs.mkdirSync(outDir, { recursive: true });

  for (var i = 0; i < keys.length; i++) {
    var spec = SPECS[keys[i]];
    if (!spec) { log('不明な対象: ' + keys[i]); failed += 1; continue; }
    log(spec.label + ' の取得を開始');
    var outPath = path.join(outDir, spec.key + '.json');
    var existing = [];
    try {
      existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
      if (!Array.isArray(existing)) { existing = []; }
      log('  ' + spec.label + ': 既存データ ' + existing.length + '件');
    } catch (e0) { existing = []; }
    var draws;
    try {
      draws = await collect(spec, limit, months, null, existing);
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

module.exports = {
  SPECS: SPECS,
  decodeBody: decodeBody,
  htmlToText: htmlToText,
  extractDraws: extractDraws,
  monthUrl: monthUrl,
  prevMonth: prevMonth,
  collect: collect,
  mergeDraws: mergeDraws,
  validate: validate
};

if (require.main === module) {
  main().catch(function (e) {
    log('想定外のエラー: ' + (e && e.stack ? e.stack : e));
    process.exit(1);
  });
}
