'use strict';
const params = new URLSearchParams(location.search);
const archive = params.get('archive') === '1' || params.get('rules') === '1';
let mode = archive && params.get('mode') === '60' ? 60 : 30;
let pack = archive && params.get('pack') === 'code' ? 'code' : 'english';
const rules = archive && params.get('rules') === '1' ? 1 : 2;
let currentRequest, generation = 0;
const scores = document.querySelector('#scores'), status = document.querySelector('#status');
const refresh = document.querySelector('#refresh'), board = document.querySelector('#board');
const dateFormat = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
function message(text) {
  const row = document.createElement('tr'), cell = document.createElement('td');
  cell.colSpan = 5; cell.className = 'empty'; cell.textContent = text;
  row.append(cell); scores.replaceChildren(row);
}
function selection() {
  document.querySelectorAll('[data-mode]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.mode) === mode)));
  document.querySelectorAll('[data-pack]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.pack === pack)));
  document.querySelector('#board-title').textContent = `${mode}秒・${pack === 'code' ? 'Code' : 'English'} ランキング`;
  const url = new URL(location.href); url.searchParams.set('mode', mode); url.searchParams.set('pack', pack); url.searchParams.set('rules', rules);
  if (archive) url.searchParams.set('archive', '1');
  else url.searchParams.delete('archive');
  const other = new URL(url); other.searchParams.set('archive', '1'); other.searchParams.set('rules', archive ? (rules === 1 ? 2 : 1) : 1);
  document.querySelector('#rules-link').href = other;
  document.querySelector('#rules-link').textContent = !archive ? '過去の記録を見る' : rules === 1 ? '以前の自動確定ルールの記録' : '旧ルールの記録';
  document.querySelector('#rules-label').textContent = !archive ? 'オンラインはEnglish・30秒で挑戦' : rules === 1 ? '過去の記録：区切りキーで確定するルール' : '過去の記録：自動確定ルール';
  document.querySelector('#archive-filters').hidden = !archive;
  document.querySelector('#archive-exit').hidden = !archive;
  document.querySelector('#fixed-board').hidden = archive;
  history.replaceState(null, '', url);
}
async function load() {
  selection(); currentRequest?.abort(); currentRequest = new AbortController(); const controller = currentRequest; const version = ++generation;
  const endpoint = window.KEY_DASH_API_URL;
  if (!endpoint) { message('ランキングの公開準備中です。'); status.textContent = '保存APIの設定が完了すると、ここに記録が表示されます。'; board.setAttribute('aria-busy', 'false'); return; }
  board.setAttribute('aria-busy', 'true'); refresh.disabled = true; status.textContent = '';
  message('記録を読み込んでいます。');
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${endpoint}/v1/leaderboard?mode=${mode}&pack=${pack}&rules=${rules}`, { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
    if (!response.ok) throw new Error('API unavailable');
    const data = await response.json();
    if (version !== generation) return;
    if (data.rules !== rules || data.mode !== mode || data.pack !== pack || !Array.isArray(data.scores) || data.scores.length > 100) throw new Error('Invalid board');
    const rows = data.scores.map(score => {
      if (typeof score.name !== 'string' || !/^[A-Za-z0-9_-]{3,12}$/.test(score.name) || !Number.isInteger(score.wpm) || score.wpm < 0 || score.wpm > 999 || !Number.isInteger(score.accuracy) || score.accuracy < 0 || score.accuracy > 100 || !Number.isInteger(score.rank) || !Number.isFinite(score.recorded_at)) throw new Error('Invalid score');
      const row = document.createElement('tr');
      [score.rank, score.name, score.wpm, `${score.accuracy}%`, dateFormat.format(score.recorded_at)].forEach((value, index) => {
        const cell = document.createElement('td'); cell.textContent = value; if (index === 4) cell.className = 'date';
        if (index === 3 && rules === 2) {
          if (!Number.isInteger(score.mistakes) || score.mistakes < 0 || score.mistakes > 2400) throw new Error('Invalid misses');
          const misses = document.createElement('small'); misses.className = 'miss-count'; misses.textContent = `${score.mistakes}ミス`; cell.append(misses);
        }
        row.append(cell);
      }); return row;
    });
    if (!rows.length) message('まだ記録がありません。最初のチャレンジャーになろう。');
    else scores.replaceChildren(...rows);
    status.textContent = `${mode}秒 · ${pack === 'code' ? 'Code' : 'English'} / 上位100人の自己ベスト`;
  } catch {
    if (version !== generation) return;
    message('ランキングを取得できませんでした。'); status.textContent = '通信状態を確認して「更新」を押してください。';
  } finally {
    clearTimeout(timer);
    if (version === generation) { board.setAttribute('aria-busy', 'false'); refresh.disabled = false; }
  }
}
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => { mode = Number(button.dataset.mode); load(); }));
document.querySelectorAll('[data-pack]').forEach(button => button.addEventListener('click', () => { pack = button.dataset.pack; load(); }));
refresh.addEventListener('click', load);
load();
