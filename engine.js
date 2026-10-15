(function (root) {
  'use strict';
  const ROLES = {
    wolf: { name: '人狼', side: '人狼側', icon: '狼', description: '仲間とともに、夜に1人を襲撃します。人狼の数が人間の数以上になれば勝利です。' },
    madman: { name: '狂人', side: '人狼側', icon: '影', description: '人狼を助ける人間です。人狼が誰かは分かりません。占い・霊能では「人狼ではない」と判定されます。' },
    citizen: { name: '市民', side: '市民側', icon: '灯', description: '議論と投票で人狼を探します。夜の疑い投票は非公開で、勝敗には影響しません。' },
    knight: { name: '騎士', side: '市民側', icon: '盾', description: '夜に自分以外の1人を護衛します。護衛した相手への襲撃を防ぎます。' },
    seer: { name: '占い師', side: '市民側', icon: '星', description: '夜に自分以外の1人を占います。確定後に自分だけで結果を確認し、確認ボタンを押してから次の人に渡します。' },
    medium: { name: '霊能者', side: '市民側', icon: '魂', description: '昼に処刑された人が人狼かどうかを、その後の夜に確認できます。' }
  };
  const DEFAULT_COUNTS = { wolf: 2, madman: 1, citizen: 3, knight: 1, seer: 1, medium: 1 };
  const QUEUES = ['deal', 'firstNight', 'night', 'vote', 'runoff'];
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function resume(state) {
    const g = clone(state);
    if (g.phase === 'morningCheck') { g.phase = 'discussion'; g.queue = []; g.cursor = 0; g.actions = {}; g.revision++; }
    return g;
  }
  function randomIndex(n) {
    if (!Number.isInteger(n) || n < 1) throw new Error('抽選候補がありません。');
    const cryptoSource = typeof globalThis !== 'undefined' && globalThis.crypto;
    if (!cryptoSource || !cryptoSource.getRandomValues) return Math.floor(Math.random() * n);
    const limit = Math.floor(4294967296 / n) * n;
    const a = new Uint32Array(1);
    do { cryptoSource.getRandomValues(a); } while (a[0] >= limit);
    return a[0] % n;
  }
  function alive(g) { return g.players.filter(p => p.alive); }
  function player(g, id) { return g.players.find(p => p.id === id); }
  function validate(names, settings) {
    const errors = [];
    if (!Array.isArray(names) || names.length < 3) errors.push('参加者を3人以上登録してください。');
    if (names.some(n => !n.trim() || n.trim().length > 30)) errors.push('名前は1〜30文字で入力してください。');
    if (new Set(names.map(n => n.trim())).size !== names.length) errors.push('同じ名前は使えません。名前を区別してください。');
    const counts = settings.counts;
    if (Object.keys(ROLES).some(r => !Number.isInteger(counts[r]) || counts[r] < 0 || counts[r] > 50)) errors.push('役職人数は0〜50の整数にしてください。');
    if (['knight', 'seer', 'medium'].some(r => counts[r] > 1)) errors.push('騎士・占い師・霊能者は各1人までです。');
    const total = Object.keys(ROLES).reduce((sum, r) => sum + counts[r], 0);
    if (total !== names.length) errors.push('参加者数と役職の合計人数を合わせてください。');
    if (counts.wolf < 1) errors.push('人狼を1人以上入れてください。');
    if (counts.wolf >= total - counts.wolf) errors.push('人間の人数を人狼より多くしてください。');
    if (!Number.isInteger(settings.minSeconds) || settings.minSeconds < 0 || settings.minSeconds > 120) errors.push('最低表示時間は0〜120秒にしてください。');
    if (typeof settings.repeatGuard !== 'boolean') errors.push('連続護衛の設定が正しくありません。');
    if (settings.voteTie !== undefined && !['none', 'random', 'manual', 'runoff'].includes(settings.voteTie)) errors.push('同票時の処理を選んでください。');
    return errors;
  }
  function startQueue(g, phase) {
    g.phase = phase; g.queue = alive(g).map(p => p.id); g.cursor = 0; g.actions = {};
  }
  function prepareInitial(g, pick = randomIndex) {
    if (g.initialPrepared) return;
    const seer = alive(g).find(p => p.role === 'seer');
    g.results = {};
    if (seer) {
      const candidates = alive(g).filter(p => p.id !== seer.id && p.role !== 'wolf');
      const target = candidates[pick(candidates.length)];
      g.results[seer.id] = { target: target.id, verdict: '人狼ではない', seen: false };
    }
    g.initialPrepared = true;
  }
  function create(names, settings, pick = randomIndex) {
    const errors = validate(names, settings);
    if (errors.length) throw new Error(errors.join('\n'));
    const bag = Object.keys(ROLES).flatMap(r => Array(settings.counts[r]).fill(r));
    for (let i = bag.length - 1; i > 0; i--) { const j = pick(i + 1); [bag[i], bag[j]] = [bag[j], bag[i]]; }
    const g = { version: 1, id: String(Date.now()) + '-' + randomIndex(1000000), revision: 0, settings: { voteTie: 'random', ...clone(settings) },
      players: names.map((name, i) => ({ id: 'p' + i, name: name.trim(), role: bag[i], alive: true })),
      day: 0, queue: [], cursor: 0, actions: {}, phase: 'deal', results: {}, lastGuard: null,
      execution: null, event: '', events: [], tally: null, tied: [], winner: null, reason: null, revealed: false };
    prepareInitial(g, pick); startQueue(g, 'deal'); return g;
  }
  function current(g) { return QUEUES.includes(g.phase) ? player(g, g.queue[g.cursor]) : null; }
  function verdict(g, id) { return player(g, id).role === 'wolf' ? '人狼' : '人狼ではない'; }
  function actionFor(g) {
    const p = current(g);
    if (!p) return null;
    if (g.phase === 'night' && g.actions[p.id]?.kind === 'divine') return { kind: 'result', title: '占い結果を確認してください', note: '確認してから、自分で次の人へ進んでください。', candidates: [] };
    let candidates = alive(g).filter(q => q.id !== p.id), kind = 'suspect', title = '怪しいと思う人を選んでください', note = '夜の疑い投票は非公開です。処刑や能力の結果には影響しません。';
    if (g.phase === 'vote' || g.phase === 'runoff') {
      if (g.phase === 'runoff') candidates = candidates.filter(q => g.tied.includes(q.id));
      return { kind: 'vote', title: '処刑したい人を選んでください', note: '自分には投票できません。完了するまで選び直せます。', candidates };
    }
    if (g.phase === 'night') {
      if (p.role === 'wolf') { kind = 'attack'; title = '襲撃する人を選んでください'; note = '今夜の対象と襲撃の強さを選びます。その夜の合計ptが最高の1人を襲撃し、同点なら候補からランダムに選びます。前夜のptは持ち越しません。'; candidates = candidates.filter(q => q.role !== 'wolf'); }
      if (p.role === 'seer') { kind = 'divine'; title = '占う人を選んでください'; note = '確定後に占い結果を表示します。結果を確認するまで、次の人には進みません。'; }
      if (p.role === 'knight') {
        kind = 'guard'; title = '護衛する人を選んでください'; note = g.settings.repeatGuard ? '自分への護衛は禁止。連続護衛は可能です。' : '自分への護衛と、前夜と同じ人の護衛は禁止です。';
        if (!g.settings.repeatGuard) candidates = candidates.filter(q => q.id !== g.lastGuard);
        if (!candidates.length) { kind = 'suspect'; title = '怪しいと思う人を選んでください'; note = '今夜は護衛できる対象がいません。代わりに非公開の疑い投票を行います。'; candidates = alive(g).filter(q => q.id !== p.id); }
      }
    }
    return { kind, title, note, candidates };
  }
  function checkVictory(g) {
    const living = alive(g), wolves = living.filter(p => p.role === 'wolf').length;
    const side = wolves === 0 ? '市民側' : wolves >= living.length - wolves ? '人狼側' : null;
    if (side) { g.phase = 'ended'; g.winner = side; g.reason = 'victory'; g.revealed = true; g.queue = []; g.actions = {}; }
    return side;
  }
  function publicEvent(g, text) { g.event = text; g.events.push({ day: g.day, text }); }
  function tallyChoices(ids) { const counts = {}; ids.forEach(id => { counts[id] = (counts[id] || 0) + 1; }); return counts; }
  function top(counts) { const max = Math.max(...Object.values(counts)); return Object.keys(counts).filter(id => counts[id] === max); }
  function resolveNight(g, pick) {
    const entries = Object.entries(g.actions), guards = entries.filter(([, a]) => a.kind === 'guard');
    const scores = {}; // This night's actions only; never carry points across nights.
    entries.filter(([, a]) => a.kind === 'attack').forEach(([, a]) => { scores[a.target] = (scores[a.target] || 0) + (a.points ?? 2); });
    const choices = top(scores).sort();
    const target = choices[pick(choices.length)];
    const guarded = guards.some(([, a]) => a.target === target);
    g.results = {};
    entries.filter(([, a]) => a.kind === 'divine').forEach(([id, a]) => { g.results[id] = { target: a.target, verdict: verdict(g, a.target), seen: true }; });
    g.lastGuard = guards.length ? guards[0][1].target : null;
    if (!guarded) { const victim = player(g, target); victim.alive = false; victim.deathDay = g.day + 1; victim.deathReason = 'attack'; }
    g.day++;
    publicEvent(g, guarded ? '昨夜の犠牲者はいません。' : '昨夜、' + player(g, target).name + 'さんが亡くなりました。');
    g.actions = {}; g.queue = []; g.phase = 'morning'; checkVictory(g);
  }
  function resolveVotes(g, pick) {
    const runoff = g.phase === 'runoff';
    g.lastVoteType = runoff ? 'runoff' : 'vote';
    g.tally = tallyChoices(Object.values(g.actions).map(a => a.target));
    const tied = top(g.tally);
    g.actions = {}; g.queue = []; g.phase = 'voteResult';
    const tieRule = g.settings.voteTie ?? 'runoff';
    if (tied.length > 1 && !runoff) {
      g.execution = null;
      g.tied = tied; g.voteOutcome = 'runoff'; publicEvent(g, '最多票が同数でした。決選投票を行います。'); return;
    }
    if (tied.length > 1 && tieRule === 'manual') {
      g.execution = null; g.tied = tied.sort(); g.voteOutcome = 'manual';
      publicEvent(g, '決選投票も同票でした。同票候補から処刑者を選んでください。'); return;
    }
    g.tied = []; g.voteOutcome = 'night';
    g.execution = tied.length === 1 ? tied[0] : tieRule === 'random' ? tied.sort()[pick(tied.length)] : null;
    if (g.execution) {
      const victim = player(g, g.execution); victim.alive = false; victim.deathDay = g.day; victim.deathReason = 'execution';
      publicEvent(g, victim.name + 'さんが' + (tied.length > 1 ? '同票候補からランダムに選ばれ、' : '') + '処刑されました。');
    } else publicEvent(g, (runoff ? '決選投票も同票のため、' : '最多票が同数のため、') + '今日は処刑なしです。');
    checkVictory(g);
  }
  function complete(g, target, pick = randomIndex) {
    const p = current(g), action = actionFor(g);
    if (!p || (g.actions[p.id] && action.kind !== 'result')) throw new Error('この行動はすでに完了しています。');
    if (action.kind === 'divine') throw new Error('先に占いを確定し、結果を確認してください。');
    let points;
    if (action.kind === 'attack') {
      points = target && typeof target === 'object' ? target.points : null;
      target = target && typeof target === 'object' ? target.target : target;
      if (!Number.isInteger(points) || points < 1 || points > 3) throw new Error('襲撃の強さを1〜3ptから選んでください。');
    }
    if (!['confirm', 'result'].includes(action.kind) && !action.candidates.some(q => q.id === target)) throw new Error('有効な対象を選んでください。');
    if (action.kind === 'result') g.results[p.id].seen = true;
    else g.actions[p.id] = { kind: action.kind, target: action.kind === 'confirm' ? null : target };
    if (action.kind === 'attack') g.actions[p.id].points = points;
    if (['deal', 'firstNight'].includes(g.phase) && g.results[p.id]) g.results[p.id].seen = true;
    g.cursor++;
    if (g.cursor < g.queue.length) return;
    if (g.phase === 'deal') { g.day = 1; g.phase = 'morning'; g.queue = []; g.actions = {}; publicEvent(g, '役職確認と最初の疑い投票が終わりました。全員が生存しています。'); }
    else if (g.phase === 'firstNight') { g.day = 1; g.actions = {}; g.queue = []; g.phase = 'morning'; publicEvent(g, '最初の夜が明けました。全員が生存しています。'); }
    else if (g.phase === 'night') resolveNight(g, pick);
    else resolveVotes(g, pick);
  }
  function next(g, pick = randomIndex) {
    if (g.phase === 'dealDone') {
      startQueue(g, 'firstNight'); g.results = {};
      const seer = alive(g).find(p => p.role === 'seer');
      if (seer) { const candidates = alive(g).filter(p => p.id !== seer.id && p.role !== 'wolf'); const target = candidates[pick(candidates.length)]; g.results[seer.id] = { target: target.id, verdict: '人狼ではない', seen: false }; }
    } else if (g.phase === 'morning') {
      g.phase = 'discussion';
    } else if (g.phase === 'discussion') { g.tally = null; g.tied = []; startQueue(g, 'vote'); }
    else if (g.phase === 'voteResult') { if (g.voteOutcome === 'runoff') startQueue(g, 'runoff'); else if (g.voteOutcome === 'manual') g.phase = 'executionChoice'; else { g.results = {}; startQueue(g, 'night'); } }
    else throw new Error('この画面からは進めません。');
  }
  function transition(state, command, target, pick = randomIndex) {
    const g = clone(state);
    if (command === 'complete') complete(g, target, pick);
    else if (command === 'divine') {
      const p = current(g), action = actionFor(g);
      if (!p || action.kind !== 'divine') throw new Error('今は占いを確定できません。');
      if (!action.candidates.some(q => q.id === target)) throw new Error('有効な対象を選んでください。');
      g.actions[p.id] = { kind: 'divine', target };
      g.results[p.id] = { target, verdict: verdict(g, target), seen: false };
    }
    else if (command === 'execute') {
      if (g.phase !== 'executionChoice' || g.voteOutcome !== 'manual') throw new Error('今は処刑者を選べません。');
      const victim = player(g, target);
      if (!g.tied.includes(target) || !victim?.alive) throw new Error('決選投票で同票になった候補から選んでください。');
      g.execution = target; victim.alive = false; victim.deathDay = g.day; victim.deathReason = 'execution';
      g.tied = []; g.voteOutcome = 'night'; g.phase = 'voteResult';
      publicEvent(g, victim.name + 'さんが同票候補から選ばれ、処刑されました。');
      checkVictory(g);
    }
    else if (command === 'next') next(g, pick);
    else if (command === 'abort') { if (g.phase === 'ended') throw new Error('すでに終了しています。'); g.phase = 'ended'; g.winner = null; g.reason = 'abort'; g.revealed = false; g.queue = []; g.actions = {}; g.results = {}; }
    else if (command === 'reveal') { if (g.phase !== 'ended') throw new Error('ゲームはまだ終了していません。'); g.revealed = true; }
    else throw new Error('不明な操作です。');
    g.revision++; return g;
  }
  const API = { ROLES, DEFAULT_COUNTS, QUEUES, clone, resume, create, prepareInitial, validate, current, actionFor, alive, player, verdict, checkVictory, transition };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Werewolf = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
