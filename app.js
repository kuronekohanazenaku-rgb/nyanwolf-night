(() => {
  'use strict';
  const E = window.Werewolf, app = document.getElementById('app');
  const KEY = 'moonlight-werewolf-v1';
  const LABELS = { deal: '配役確認', dealDone: '配役確認が完了', firstNight: '最初の夜', night: '夜の行動', morning: '朝の発表', discussion: '議論', vote: '投票', runoff: '決選投票', voteResult: '投票結果', executionChoice: '処刑者の選択', ended: 'ゲーム終了' };
  let game = null, privateOpen = false, selected = null, selectedPoints = null, openedAt = 0, clock = null;
  let pending = null, storageFailed = false, notice = '', unreadableSave = false;
  const defaultSetup = () => ({ names: '', counts: { ...E.DEFAULT_COUNTS }, repeatGuard: false, minSeconds: 0, voteTie: 'random' });
  let setup = defaultSetup();
  const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const names = () => setup.names.split(/\r?\n/).map(n => n.trim()).filter(Boolean);
  const settings = () => ({ counts: { ...setup.counts }, repeatGuard: setup.repeatGuard, minSeconds: setup.minSeconds, voteTie: setup.voteTie });
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;
      const original = JSON.parse(raw);
      const parsed = E.resume(original);
      let migrated = original.phase !== parsed.phase;
      if (parsed.version !== 1 || !Array.isArray(parsed.players) || !parsed.players.length || !LABELS[parsed.phase] || !parsed.settings || !parsed.players.every(p => E.ROLES[p.role]) || !Array.isArray(parsed.queue)) throw new Error('invalid');
      if (E.QUEUES.includes(parsed.phase) && !E.current(parsed)) throw new Error('invalid');
      game = parsed;
      setup = { names: game.players.map(p => p.name).join('\n'), ...E.clone(game.settings), voteTie: ['none', 'manual'].includes(game.settings.voteTie) ? game.settings.voteTie : 'random' };
      if (parsed.phase === 'deal' && !parsed.initialPrepared) {
        E.prepareInitial(parsed);
        if (parsed.cursor > 0) { parsed.cursor = 0; parsed.actions = {}; notice = '0日目の確認を新しい流れで全員分やり直します。配役はそのままです。'; }
        parsed.revision++;
        migrated = true;
      }
      if (migrated) { try { localStorage.setItem(KEY, JSON.stringify(parsed)); } catch { pending = parsed; game = null; storageFailed = true; } }
    } catch { unreadableSave = true; notice = '保存データを読み込めませんでした。削除して準備からやり直せます。'; }
  }
  function commit(next) {
    privateOpen = false; selected = null;
    pending = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      game = next; pending = null; storageFailed = false; notice = ''; unreadableSave = false;
    } catch { storageFailed = true; }
    render();
  }
  function run(command, target) {
    try {
      const resultOwner = command === 'divine' ? E.current(game).id : null;
      commit(E.transition(game, command, target));
      if (resultOwner && !storageFailed && E.current(game)?.id === resultOwner) {
        privateOpen = true; selected = null; openedAt = Date.now(); render();
      }
    }
    catch (error) { privateOpen = false; selected = null; notice = error.message; render(); }
  }
  function button(text, id, kind = '') { return `<button id="${id}" class="${kind}">${text}</button>`; }
  function rules() {
    return `<details class="rules"><summary>遊び方と基本ルール</summary>
      <p>本人の名前を確認してから開き、周りに見られない状態で操作します。「完了」で画面を隠し、次の人に渡してください。</p>
      <ul><li>0日目の配役確認で、占い師にランダムな人間1人の結果を知らせます。全員が同じ画面で疑う相手を選び、完了したら1日目の朝へ進みます。0日目の襲撃はありません。</li><li>占い師は夜に対象を確定した後、結果を読んでから次の人に渡します。朝は公開結果を発表し、そのまま議論に進みます。</li><li>騎士は自分を護衛できません。連続護衛は設定によります。</li><li>人狼は対象と襲撃の強さを選びます。「なんとなく襲う」1pt、「襲う」2pt、「積極的に襲う」3pt。その夜の対象ごとの合計点が最高の人を襲い、最高点が同点なら候補からランダムに選びます。点数は毎夜リセットし、前夜からの持ち越しはありません。</li><li>昼は自分以外に投票。同票なら、その同票候補だけを対象に決選投票を1回行います。まだ同票なら設定に応じて「ランダム処刑」「処刑者を選ぶ」「処刑なし」で処理します。抽選・手動選択の対象は決選投票の最終同票候補だけです。集計後の得票数は公開し、投票者の名前は公開しません。</li><li>夜の疑い投票は非公開で、処刑・襲撃・勝敗に影響しません。</li><li>人狼全滅で市民側の勝利。人狼が人間と同数以上になれば人狼側の勝利。狂人は人間として数えます。</li><li>死亡者は発言・投票・夜行動に参加しません。死亡時は役職を公開せず、勝敗が決まった時に公開します。</li></ul>
      <div class="roles-guide">${Object.values(E.ROLES).map(r => `<p><strong>${r.name}</strong> · ${r.side}<br>${r.description}</p>`).join('')}</div>
      <p style="margin-top:16px">進行はこの端末に自動保存します。別の端末とは同期しません。本人確認は対面での受け渡しに任せています。</p></details>`;
  }
  function setupScreen() {
    app.className = '';
    app.innerHTML = `<section class="hero cat-hero"><div><span class="pill">GMレス · 対面プレイ</span><p class="eyebrow">NYANWOLF NIGHT</p><h1>今夜は、<br>誰が化けている？</h1><p class="lede">黒にゃんこと、秘密の人狼会。<br>配役も、夜も、投票も。この1台が進行します。</p></div><img class="hero-cat" src="cat.svg" alt="月の下で金色の目を光らせる黒猫"></section>
      ${notice ? `<div class="notice error" role="alert">${html(notice)}</div>` : ''}
      ${unreadableSave ? button('保存データを削除', 'erase', 'secondary') : ''}
      <div class="setup-grid"><section class="panel"><div class="panel-header"><h2><span class="step">01</span>参加者</h2><span class="pill" id="name-count"></span></div>
      <label for="names">名前を1行に1人ずつ<span class="label-note">上から順番に端末を回します。名前は30文字まで。</span></label>
      <textarea id="names" placeholder="あかり&#10;はる&#10;ゆう" spellcheck="false">${html(setup.names)}</textarea>
      <button class="text-button" id="sample">9人のサンプルを入力</button></section>
      <section class="panel"><div class="panel-header"><h2><span class="step">02</span>配役</h2><span class="pill" id="role-count"></span></div>
      ${Object.entries(E.ROLES).map(([id, r]) => `<div class="role-row"><img class="role-image" src="icons/${id}.svg" alt=""><label class="role-label" for="count-${id}">${r.name}<small>${r.side}</small></label><input id="count-${id}" data-role="${id}" aria-label="${r.name}の人数" type="number" inputmode="numeric" min="0" max="${['knight', 'seer', 'medium'].includes(id) ? 1 : 50}" value="${setup.counts[id]}"></div>`).join('')}
      </section></div>
      <section class="panel settings"><label for="repeat-guard"><span class="setting-line"><span>連続護衛</span><select id="repeat-guard"><option value="no" ${!setup.repeatGuard ? 'selected' : ''}>なし</option><option value="yes" ${setup.repeatGuard ? 'selected' : ''}>あり</option></select></span><span class="hint">同じ相手を続けて守れるかを選びます。</span></label>
      <label for="vote-tie"><span class="setting-line"><span>決選投票も同票なら</span><select id="vote-tie"><option value="random" ${setup.voteTie === 'random' ? 'selected' : ''}>ランダム処刑</option><option value="manual" ${setup.voteTie === 'manual' ? 'selected' : ''}>処刑者を選ぶ</option><option value="none" ${setup.voteTie === 'none' ? 'selected' : ''}>処刑なし</option></select></span><span class="hint">同票候補だけで決選投票を1回行い、まだ同票ならこの方法で処理します。</span></label>
      <label for="min-seconds"><span class="setting-line"><span>秘密画面の最低表示時間</span><span><input id="min-seconds" type="number" inputmode="numeric" min="0" max="120" value="${setup.minSeconds}"> 秒</span></span><span class="hint">操作時間からの推測を減らす補助。0秒で制限なし。</span></label></section>
      <div class="start-bar"><div id="balance" class="balance" aria-live="polite"></div><div id="validation"></div>${button('配役してゲームをはじめる', 'start', 'full')}</div>${rules()}`;
    app.querySelector('#names').addEventListener('input', e => { setup.names = e.target.value; validateSetup(); });
    app.querySelectorAll('[data-role]').forEach(input => input.addEventListener('input', e => { setup.counts[e.target.dataset.role] = Number(e.target.value); validateSetup(); }));
    bind('repeat-guard', 'change', e => { setup.repeatGuard = e.target.value === 'yes'; });
    bind('vote-tie', 'change', e => { setup.voteTie = e.target.value; });
    bind('min-seconds', 'input', e => { setup.minSeconds = Number(e.target.value); validateSetup(); });
    bind('sample', 'click', () => {
      const fill = () => { setup.names = ['あかり', 'はる', 'ゆう', 'そら', 'なつ', 'れん', 'みお', 'りつ', 'ひなた'].join('\n'); setup.counts = { ...E.DEFAULT_COUNTS }; render(); };
      if (setup.names.trim()) ask('サンプルを入力しますか？', '参加者名と配役人数を9人のサンプルに置き換えます。', '置き換える', fill, 'キャンセル'); else fill();
    });
    bind('start', 'click', () => { try { commit(E.create(names(), settings())); } catch (error) { notice = error.message; render(); } });
    bind('erase', 'click', erase);
    validateSetup();
  }
  function validateSetup() {
    const list = names(), total = Object.values(setup.counts).reduce((a, b) => a + b, 0), errors = E.validate(list, settings());
    document.getElementById('name-count').textContent = list.length + '人';
    document.getElementById('role-count').textContent = total + '人';
    const balance = document.getElementById('balance');
    balance.textContent = list.length ? `参加者 ${list.length}人 / 配役 ${total}人${errors.length ? ' — 設定を確認してください' : ' — 準備が整いました'}` : '参加者の名前を入力すると、ゲームを開始できます。';
    balance.className = 'balance' + (!errors.length ? ' good' : '');
    document.getElementById('start').disabled = !!errors.length || unreadableSave;
    document.getElementById('validation').innerHTML = list.length && errors.length ? `<div class="errors"><ul>${errors.map(e => `<li>${html(e)}</li>`).join('')}</ul></div>` : '';
  }
  function status() {
    const part = E.QUEUES.includes(game.phase) ? `${game.cursor + 1} / ${game.queue.length} 人` : `生存 ${E.alive(game).length} / ${game.players.length} 人`;
    return `<div class="status-row"><span class="phase-tag">${game.day}日目 · ${LABELS[game.phase]}</span><span class="pill">${part}</span></div>`;
  }
  function toolbar() { return `<div class="toolbar">${game.phase !== 'ended' ? button('ゲームを途中終了', 'abort', 'text-button subtle-danger') : ''}${button('保存データを削除', 'erase', 'text-button')}</div>`; }
  function handoff() {
    const p = E.current(game);
    app.innerHTML = `${status()}<div class="progress" aria-label="完了 ${game.cursor} / ${game.queue.length} 人"><span style="width:${game.cursor / game.queue.length * 100}%"></span></div>
      ${notice ? `<p class="notice error" role="alert">${html(notice)}</p>` : ''}
      <section class="panel handoff"><img class="handoff-cat" src="cat.svg" alt=""><p class="eyebrow">PASS THE PHONE</p><h1 class="name">${html(p.name)}<span style="font-size:.65em">さん</span></h1><p class="lede" style="margin-inline:auto">この方に端末を渡してください。</p><div class="notice">周りの人に画面が見えない状態で<br>本人だけが開いてください。</div>${button('確認・行動を始める', 'open')}<p class="pass-note">秘密をしまって、次の人へ。</p></section>${toolbar()}`;
    bind('open', 'click', () => { privateOpen = true; selected = null; selectedPoints = null; openedAt = Date.now(); render(); });
  }
  function privateInfo(p) {
    let content = '';
    if (!['vote', 'runoff'].includes(game.phase)) {
      const r = E.ROLES[p.role];
      content += `<div class="private-role"><img class="role-image" src="icons/${p.role}.svg" alt=""><div><h2>${r.name}</h2><p>${r.side}</p></div></div>`;
      if (game.phase === 'deal') content += `<p class="hint">${r.description}</p>`;
      if (p.role === 'wolf' && ['deal', 'night'].includes(game.phase)) {
        const allies = game.players.filter(q => q.role === 'wolf' && q.id !== p.id);
        content += `<div class="secret-result"><p class="hint">仲間の人狼</p><p>${allies.length ? allies.map(q => html(q.name) + (q.alive ? '' : '（脱落）')).join('、') : 'あなた1人です。'}</p></div>`;
      }
      if (game.phase === 'deal' && p.role === 'knight') content += `<p class="hint">このゲームの連続護衛：${game.settings.repeatGuard ? 'あり' : 'なし'}</p>`;
      const result = game.results[p.id];
      if ((['deal', 'firstNight'].includes(game.phase) || (game.phase === 'night' && p.role === 'seer' && E.actionFor(game).kind === 'result')) && result) content += `<div class="secret-result"><p class="hint">${['deal', 'firstNight'].includes(game.phase) ? '初日の占い結果' : '今夜の占い結果'}</p><p><strong>${html(E.player(game, result.target).name)}さん</strong>は<br><strong>${result.verdict}</strong>です。</p></div>`;
      if (game.phase === 'night' && p.role === 'medium') content += `<div class="secret-result"><p class="hint">霊能結果</p><p>${game.execution ? `<strong>${html(E.player(game, game.execution).name)}さん</strong>は<br><strong>${E.verdict(game, game.execution)}</strong>です。` : '本日の処刑者はいません。'}</p></div>`;
    }
    return content;
  }
  function secret() {
    const p = E.current(game), action = E.actionFor(game);
    app.innerHTML = `${status()}<section class="panel"><div class="private-heading"><h1>${html(p.name)}さん</h1><span class="pill">本人だけの画面</span></div>${privateInfo(p)}
      ${!['confirm', 'result'].includes(action.kind) ? `<h2 style="margin-top:22px">${action.title}</h2><p class="hint">${action.note}</p><div class="target-grid" role="group" aria-label="対象の選択">${action.candidates.map(q => `<button class="target" data-target="${q.id}" aria-pressed="false"><span class="dot" aria-hidden="true"></span>${html(q.name)}</button>`).join('')}</div>` : ''}
      ${action.kind === 'attack' ? `<h2>襲撃の強さを選んでください</h2><div class="intensity-options" role="group" aria-label="襲撃の強さ">${[[1, 'なんとなく襲う'], [2, '襲う'], [3, '積極的に襲う']].map(([points, label]) => `<button class="target intensity" data-points="${points}" aria-pressed="false"><span class="dot" aria-hidden="true"></span><span>${label}<small>${points}pt</small></span></button>`).join('')}</div>` : ''}
      ${button(action.kind === 'divine' ? '占いを確定して結果を見る' : action.kind === 'result' ? '結果を確認して次の人へ' : '完了して次の人へ', 'complete', 'full')}<p class="complete-note" id="complete-note"></p></section>`;
    app.querySelectorAll('[data-target]').forEach(b => b.addEventListener('click', () => {
      selected = b.dataset.target;
      app.querySelectorAll('[data-target]').forEach(other => { const active = other.dataset.target === selected; other.classList.toggle('selected', active); other.setAttribute('aria-pressed', String(active)); });
      updateComplete();
    }));
    app.querySelectorAll('[data-points]').forEach(b => b.addEventListener('click', () => {
      selectedPoints = Number(b.dataset.points);
      app.querySelectorAll('[data-points]').forEach(other => { const active = Number(other.dataset.points) === selectedPoints; other.classList.toggle('selected', active); other.setAttribute('aria-pressed', String(active)); });
      updateComplete();
    }));
    bind('complete', 'click', () => { if (!document.getElementById('complete').disabled) run(action.kind === 'divine' ? 'divine' : 'complete', action.kind === 'attack' ? { target: selected, points: selectedPoints } : selected); });
    updateComplete(); clock = setInterval(updateComplete, 250);
  }
  function updateComplete() {
    const b = document.getElementById('complete'); if (!b || !privateOpen) return;
    const minimum = Math.max(game.settings.minSeconds, E.actionFor(game).kind === 'result' ? 2 : 0);
    const remaining = Math.max(0, Math.ceil(minimum - (Date.now() - openedAt) / 1000));
    const requires = !['confirm', 'result'].includes(E.actionFor(game).kind);
    const requiresPoints = E.actionFor(game).kind === 'attack';
    b.disabled = remaining > 0 || (requires && !selected) || (requiresPoints && !selectedPoints);
    document.getElementById('complete-note').textContent = remaining ? `あと${remaining}秒で完了できます。` : requires && !selected ? '対象を1人選んでください。' : requiresPoints && !selectedPoints ? '襲撃の強さを選んでください。' : E.actionFor(game).kind === 'divine' ? '確定後は対象を変更できません。結果は次の画面で確認します。' : E.actionFor(game).kind === 'result' ? '結果を読み終えてから押してください。自動で次の人には進みません。' : '完了すると、この画面には戻れません。';
  }
  function roster() { return `<p class="roster-heading">参加者</p><div class="roster">${game.players.map(p => `<span class="${p.alive ? '' : 'dead'}">${html(p.name)}</span>`).join('')}</div>`; }
  function tally() { return game.tally ? `<table class="tally"><caption class="hint">投票結果 · 投票者の名前は非公開</caption><thead><tr><th scope="col">名前</th><th scope="col">得票数</th></tr></thead><tbody>${Object.entries(game.tally).sort((a, b) => b[1] - a[1]).map(([id, count]) => `<tr><td>${html(E.player(game, id).name)}</td><td>${count}票</td></tr>`).join('')}</tbody></table>` : ''; }
  function publicScreen() {
    let title, text, nextText;
    if (game.phase === 'dealDone') { title = '全員の役職確認が終わりました'; text = '最初の夜に進みます。襲撃はありません。全員が順番に端末を操作してください。'; nextText = '最初の夜を始める'; }
    if (game.phase === 'morning') { title = `${game.day}日目の朝`; text = game.event; nextText = '議論を始める'; }
    if (game.phase === 'discussion') { title = '誰が、人狼だろう。'; text = '全員で話し合いましょう。議論が終わったら、端末を回して投票します。'; nextText = '投票を始める'; }
    if (game.phase === 'voteResult') { title = game.lastVoteType === 'runoff' ? '決選投票が終わりました' : '投票が終わりました'; text = game.event; nextText = game.voteOutcome === 'runoff' ? '決選投票を始める' : game.voteOutcome === 'manual' ? '処刑者の選択へ進む' : '夜の行動を始める'; }
    app.innerHTML = `${status()}${notice ? `<p class="notice error" role="alert">${html(notice)}</p>` : ''}<section class="panel public"><div class="seal" aria-hidden="true">${game.phase === 'morning' ? '☀' : '☾'}</div><h1>${title}</h1><p class="event">${html(text)}</p>${game.phase === 'voteResult' ? tally() : ''}${roster()}${button(nextText, 'next', 'full')}</section>${toolbar()}
      <details class="history"><summary>公開された進行履歴</summary><ul>${game.events.map(e => `<li>${e.day}日目：${html(e.text)}</li>`).join('') || '<li>まだ公開結果はありません。</li>'}</ul></details>${rules()}`;
    bind('next', 'click', () => run('next'));
  }
  function executionChoiceScreen() {
    const candidates = game.tied.map(id => E.player(game, id));
    app.innerHTML = `${status()}${notice ? `<p class="notice error" role="alert">${html(notice)}</p>` : ''}<section class="panel public"><h1>処刑者を選んでください</h1><p class="hint">決選投票で最多票になった同票候補だけから選びます。全員で確認し、進行役が操作してください。</p>${tally()}<div class="target-grid" role="group" aria-label="処刑者の選択">${candidates.map(p => `<button class="target" data-execute="${p.id}" aria-pressed="false"><span class="dot" aria-hidden="true"></span>${html(p.name)}</button>`).join('')}</div>${button('選んだ人を処刑する', 'execute', 'danger full')}<p class="complete-note">選択後、確認画面で確定するまで処刑されません。</p></section>${toolbar()}`;
    document.getElementById('execute').disabled = true;
    app.querySelectorAll('[data-execute]').forEach(b => b.addEventListener('click', () => {
      selected = b.dataset.execute;
      app.querySelectorAll('[data-execute]').forEach(other => { const active = other.dataset.execute === selected; other.classList.toggle('selected', active); other.setAttribute('aria-pressed', String(active)); });
      document.getElementById('execute').disabled = false;
    }));
    bind('execute', 'click', () => {
      const chosen = candidates.find(p => p.id === selected); if (!chosen) return;
      ask(chosen.name + 'さんを処刑しますか？', '決選投票の同票候補から、この人を処刑します。確定後は取り消せません。', '処刑する', () => run('execute', chosen.id), '選び直す');
    });
  }
  function ended() {
    const abort = game.reason === 'abort';
    app.innerHTML = `${status()}<section class="panel public"><div class="seal" aria-hidden="true">☾</div><p class="eyebrow">${abort ? 'GAME STOPPED' : 'GAME OVER'}</p><h1>${abort ? 'ゲームを途中終了しました' : game.winner + 'の勝利'}</h1><p class="lede" style="margin-inline:auto">${abort ? 'このゲームに勝敗はつきません。' : 'おつかれさまでした。全員の役職を公開します。'}</p>
      ${!abort && game.event ? `<p class="event">${html(game.event)}</p>${game.event.includes('処刑') ? tally() : ''}` : ''}
      ${game.revealed ? `<div class="end-list">${game.players.map(p => `<div class="end-player"><img class="role-image" src="icons/${p.role}.svg" alt=""><span class="end-name">${html(p.name)}<br><small>${p.alive ? '生存' : p.deathReason === 'execution' ? '処刑' : '襲撃で死亡'}</small></span><span class="role-label">${E.ROLES[p.role].name}<br><small>${E.ROLES[p.role].side}</small></span></div>`).join('')}</div>` : '<div class="notice">役職はまだ公開していません。<br>公開せずに次のゲームへ進むこともできます。</div>'}
      <div class="end-actions">${!game.revealed ? button('全員の役職を公開する', 'reveal', 'secondary') : ''}${button('同じ参加者で新しいゲームを準備', 'restart', 'full')}${button('新しいゲームをセット', 'fresh-game', 'secondary full')}<p class="hint">「新しいゲームをセット」は、参加者名を空にして準備し直します。</p></div></section>${toolbar()}`;
    bind('reveal', 'click', () => ask('全員の役職を公開しますか？', '公開後は、このゲームの役職を全員が確認できる状態になります。', '公開する', () => run('reveal'), 'キャンセル'));
    bind('restart', 'click', () => prepareNewGame(true));
    bind('fresh-game', 'click', () => prepareNewGame(false));
  }
  function prepareNewGame(keepPlayers) {
    const nextSetup = keepPlayers ? { names: game.players.map(p => p.name).join('\n'), ...E.clone(game.settings), voteTie: ['none', 'manual'].includes(game.settings.voteTie) ? game.settings.voteTie : 'random' } : defaultSetup();
    try { localStorage.removeItem(KEY); setup = nextSetup; game = null; notice = ''; privateOpen = false; selected = null; selectedPoints = null; window.scrollTo({ top: 0 }); render(); }
    catch { notice = '保存データを削除できませんでした。もう一度お試しください。'; render(); }
  }
  function ask(title, description, accept, callback, cancel = '続ける') {
    const dialog = document.getElementById('confirm-dialog');
    document.getElementById('dialog-title').textContent = title;
    document.getElementById('dialog-description').textContent = description;
    document.getElementById('dialog-accept').textContent = accept;
    document.getElementById('dialog-cancel').textContent = cancel;
    document.getElementById('dialog-accept').onclick = () => { dialog.close(); callback(); };
    document.getElementById('dialog-cancel').onclick = () => dialog.close();
    dialog.showModal(); document.getElementById('dialog-cancel').focus();
  }
  function erase() {
    ask('保存データを削除しますか？', '現在のゲームを削除し、準備画面に戻ります。この操作は取り消せません。', '削除する', () => {
      try { localStorage.removeItem(KEY); game = null; pending = null; storageFailed = false; unreadableSave = false; privateOpen = false; notice = ''; render(); }
      catch { notice = '保存データを削除できませんでした。ブラウザの保存設定を確認してください。'; render(); }
    }, 'キャンセル');
  }
  function bind(id, event, fn) { const el = document.getElementById(id); if (el) el.addEventListener(event, fn); }
  function render() {
    clearInterval(clock); clock = null;
    if (game) window.scrollTo({ top: 0, behavior: 'instant' });
    app.className = game || storageFailed ? 'game-layout' : '';
    if (storageFailed) {
      app.innerHTML = `<section class="panel save-error"><div class="seal" aria-hidden="true">!</div><h1>進行を保存できませんでした</h1><p class="lede">秘密の画面は隠しています。ブラウザの保存設定や空き容量を確認して、再試行してください。保存が成功するまで次の人には進みません。</p>${button('保存を再試行する', 'retry', 'full')}${button('未保存の操作を取り消す', 'undo', 'secondary full')}</section>`;
      bind('retry', 'click', () => commit(pending));
      bind('undo', 'click', () => { pending = null; storageFailed = false; notice = '未保存の操作を取り消しました。もう一度操作してください。'; render(); });
    } else if (!game) setupScreen();
    else if (game.phase === 'ended') ended();
    else if (game.phase === 'executionChoice') executionChoiceScreen();
    else if (E.current(game)) privateOpen ? secret() : handoff();
    else publicScreen();
    bind('abort', 'click', () => ask('ゲームを途中終了しますか？', '勝敗はつきません。終了後に、全員の役職を公開するか選べます。', '終了する', () => run('abort')));
    bind('erase', 'click', erase);
  }
  function conceal() { if (privateOpen) { privateOpen = false; selected = null; render(); } }
  document.addEventListener('visibilitychange', () => { if (document.hidden) conceal(); });
  window.addEventListener('blur', conceal);
  window.addEventListener('pagehide', conceal);
  window.addEventListener('pageshow', conceal);
  window.addEventListener('popstate', conceal);
  document.getElementById('brand').addEventListener('click', e => { e.preventDefault(); conceal(); window.scrollTo({ top: 0 }); });
  window.addEventListener('storage', e => {
    if (e.key !== KEY) return;
    document.getElementById('confirm-dialog').close();
    privateOpen = false; selected = null; pending = null; storageFailed = false; game = null;
    load(); notice = '別の画面で進行が更新されました。このゲームは1つのタブで操作してください。'; render();
  });
  load(); render();
})();
