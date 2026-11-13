/* MoonHR 노무 대시보드 — app */
(function () {
  'use strict';
  const D = window.HR_DATA;
  const C = window.HRCalc;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won2 = (n) => `${(Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원`;
  const won = (n) => `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`;
  const ymd = (s) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}` : s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.replace(/-/g, '.') : s || '-');
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage unavailable */ } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* noop */ } },
  };
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const dday = (dateStr) => C.daysBetween(C.toDate(todayStr()), C.toDate(dateStr));

  const NAV = [
    { id: 'dashboard', label: '대시보드', short: '홈', ico: '🏠' },
    { id: 'search', label: '조문 찾기', short: '조문', ico: '🔎' },
    { id: 'law', label: '법령 전문·검색', short: '법령', ico: '📚' },
    { id: 'calc', label: '실무 계산기', short: '계산기', ico: '🧮' },
    { id: 'deadlines', label: '법정 기한', short: '기한', ico: '⏳' },
    { id: 'changes', label: '개정·시행 일정', short: '개정', ico: '📅' },
    { id: 'settings', label: 'API 설정', short: '설정', ico: '⚙️', mobileHidden: true },
  ];

  const state = {
    q: '', cat: 'all', under5: false, sort: 'rel', expandAll: false, expanded: new Set(),
    changeTag: 'all', law: null, size: (() => { const v = store.get('hr.size', null); return Number.isInteger(v) && v >= 0 ? v : null; })(), showNA: false, lawFilter: '', apiOk: null, info: null,
  };

  // ── 조문 참조 파싱
  function parseRef(ref) {
    const [key, art] = String(ref).split('|');
    const law = D.LAWS[key] || { name: key, short: key };
    const [no, br] = String(art || '').split('-').map((x) => parseInt(x, 10));
    return { key, law: law.name, short: law.short, no, br: br || 0, label: `제${no}조${br ? `의${br}` : ''}` };
  }
  const lawLink = (name, label) => `https://www.law.go.kr/${encodeURIComponent('법령')}/${encodeURIComponent(name)}${label ? `/${encodeURIComponent(label)}` : ''}`;
  const refChip = (ref, withLaw = true) => {
    const r = parseRef(ref);
    return `<button type="button" class="chip law" data-ref="${esc(ref)}" title="${esc(r.law)} ${r.label} 원문 보기">${withLaw ? `${esc(r.short)} ` : ''}${r.label}</button>`;
  };

  // ── API
  const oc = () => store.get('hr.oc', '');
  async function api(params) {
    const qs = new URLSearchParams(params);
    if (oc()) qs.set('oc', oc());
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(`/api/law?${qs}`, { signal: ctrl.signal });
      let body;
      try { body = await res.json(); } catch (_) { throw new Error('API 응답을 해석할 수 없습니다(배포 환경에서만 동작합니다).'); }
      if (!res.ok || !body.ok) throw new Error(body.error || `요청 실패 (HTTP ${res.status})`);
      return body;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error('응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요.');
      throw e;
    } finally { clearTimeout(timer); }
  }
  const memo = new Map();
  function cachedApi(params, ttlMs = 6 * 3600e3) {
    const key = 'hr.c2.' + JSON.stringify(params);
    if (memo.has(key)) return memo.get(key);
    const hit = store.get(key, null);
    if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.body);
    const p = api(params).then((body) => {
      const allFailed = Array.isArray(body.laws) && !body.laws.some((l) => l.ok);
      if (!allFailed && JSON.stringify(body).length < 400000) store.set(key, { at: Date.now(), body });
      if (allFailed) memo.delete(key);
      return body;
    });
    memo.set(key, p);
    p.catch(() => memo.delete(key));
    return p;
  }

  function setApiPill(status, text) {
    ['#apiPillSide', '#apiPillTop'].forEach((s) => {
      const el = $(s); if (!el) return;
      el.classList.toggle('ok', status === 'ok');
      el.classList.toggle('err', status === 'err');
      const label = $('.label', el);
      if (label) label.textContent = s === '#apiPillTop' ? (status === 'ok' ? '연동' : status === 'err' ? '오류' : 'API') : text;
      el.title = text;
    });
  }

  async function refreshInfo(force) {
    const names = D.TRACKED.map((k) => D.LAWS[k].name);
    try {
      const body = force ? await api({ action: 'info', laws: names.join(',') }) : await cachedApi({ action: 'info', laws: names.join(',') }, 3 * 3600e3);
      const okCount = body.laws.filter((l) => l.ok).length;
      state.apiOk = okCount > 0;
      state.info = body;
      
      setApiPill(okCount ? 'ok' : 'err', okCount ? `법제처 API 연동 · ${okCount}개 법령 최신화` : '법제처 API 응답 오류');
    } catch (e) {
      state.apiOk = false;
      state.apiError = e.message;
      setApiPill('err', `법제처 API 연결 실패 — ${e.message}`);
    }
    if (currentRoute() === 'dashboard') renderLawStatus();
  }

  // ── 조문 원문 모달
  const modal = { el: null, lastFocus: null };
  function openModal({ kicker, title, body, foot }) {
    modal.el = $('#modal');
    modal.lastFocus = document.activeElement;
    $('#modalKicker').textContent = kicker || '';
    $('#modalTitle').textContent = title || '';
    $('#modalBody').innerHTML = body || '';
    $('#modalFoot').innerHTML = foot || '';
    modal.el.hidden = false;
    document.body.style.overflow = 'hidden';
    $('.modal-panel .icon-btn', modal.el).focus();
  }
  function closeModal() {
    if (!modal.el || modal.el.hidden) return;
    modal.el.hidden = true;
    document.body.style.overflow = '';
    if (modal.lastFocus && modal.lastFocus.focus) modal.lastFocus.focus();
  }
  const articleHtml = (a) => `<div class="article"><h4><span class="lbl">${esc(a.label)}</span>${a.title ? `<span>${esc(a.title)}</span>` : ''}</h4>${
    (a.lines || []).map((l) => `<p class="l${l.level}">${esc(l.text)}</p>`).join('') || '<p class="muted">(내용 없음)</p>'}</div>`;

  let modalSeq = 0;
  async function showArticle(ref) {
    const r = parseRef(ref);
    const seq = ++modalSeq;
    const link = lawLink(r.law, r.label);
    const related = D.ITEMS.filter((it) => it.refs.includes(ref) || it.penalty.refs.includes(ref));
    const relHtml = related.length ? `<div class="notice info" style="margin-top:14px"><strong>관련 항목</strong> · ${related.map((it) => `<a href="#search?item=${esc(it.id)}" data-close>${esc(it.title)}</a>`).join(' · ')}</div>` : '';
    openModal({
      kicker: r.law, title: `${r.label} 원문`,
      body: '<div class="skeleton" style="width:40%"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton" style="width:80%"></div>',
      foot: `<span>법제처 국가법령정보센터에서 불러오는 중…</span><span class="spacer"></span><a class="btn sm" href="${link}" target="_blank" rel="noopener">국가법령정보센터 ↗</a>`,
    });
    try {
      const body = await cachedApi({ action: 'article', law: r.law, jo: r.no, br: r.br });
      if (seq !== modalSeq) return;
      const a = body.article;
      $('#modalTitle').textContent = `${a.label}${a.title ? ` (${a.title})` : ''}`;
      $('#modalBody').innerHTML = articleHtml(a) + relHtml;
      $('#modalFoot').innerHTML = `<span>시행 ${esc(ymd(body.law.effective))} · 공포 ${esc(ymd(body.law.promulgated))}${a.effective ? ` · 조문시행 ${esc(ymd(a.effective))}` : ''} · 출처 법제처</span><span class="spacer"></span><button class="btn sm" type="button" data-copy>복사</button><a class="btn sm primary" href="${esc(body.link || link)}" target="_blank" rel="noopener">국가법령정보센터 ↗</a>`;
      $('#modalFoot [data-copy]').addEventListener('click', () => copyText(`${body.law.name} ${a.label}${a.title ? `(${a.title})` : ''}\n${a.lines.map((l) => l.text).join('\n')}`));
    } catch (e) {
      if (seq !== modalSeq) return;
      $('#modalBody').innerHTML = `<div class="notice err"><strong>원문을 불러오지 못했습니다.</strong><br>${esc(e.message)}</div>
        <p class="small muted" style="margin-top:12px">아래 버튼으로 국가법령정보센터에서 바로 확인할 수 있습니다.</p>${relHtml}`;
      $('#modalFoot').innerHTML = `<span class="spacer"></span><button class="btn sm" type="button" data-retry>다시 시도</button><a class="btn sm primary" href="${link}" target="_blank" rel="noopener">국가법령정보센터에서 보기 ↗</a>`;
      $('#modalFoot [data-retry]').addEventListener('click', () => showArticle(ref));
    }
  }
  function copyText(t) {
    const done = () => toast('복사했습니다.');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, () => toast('복사에 실패했습니다.'));
    else toast('이 브라우저는 복사를 지원하지 않습니다.');
  }
  let toastTimer;
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  // ── 항목 카드
  const PTYPE = { crime: '형사처벌', fine: '과태료', civil: '민사·효력', none: '직접 벌칙 없음' };
  const catOf = (id) => D.CATEGORIES.find((c) => c.id === id) || { name: id, icon: '•' };
  const hasSize = () => state.size != null;
  const applies = (it) => (hasSize() ? state.size >= it.minSize : null);
  const sizeNotesFor = (it) => (hasSize() ? it.sizeNotes.filter((x) => (x.min == null || state.size >= x.min) && (x.max == null || state.size <= x.max)) : []);
  function sizeBadge(it) {
    if (!hasSize()) return under5Badge(it.under5);
    return applies(it)
      ? `<span class="badge green" title="상시 ${state.size}명 사업장에 적용">✅ 우리 회사 적용</span>`
      : `<span class="badge gray" title="상시 ${it.minSize}명 이상부터 적용">⛔ 미적용 (${it.minSize}명 이상)</span>`;
  }
  function under5Badge(v) {
    if (v === true) return '<span class="badge green" title="상시 5인 미만 사업장에도 적용">5인 미만 적용</span>';
    if (v === false) return '<span class="badge gray" title="상시 5인 미만 사업장 적용 제외">5인 미만 제외</span>';
    return '<span class="badge blue">규모별 상이</span>';
  }
  function itemCard(it) {
    const open = state.expandAll || state.expanded.has(it.id);
    const cat = catOf(it.cat);
    const recent = it.updated && dday(it.updated) > -120;
    const sum = open ? it.summary : it.summary.slice(0, 2);
    const p = it.penalty;
    const ap = applies(it);
    const notes = sizeNotesFor(it);
    return `<article class="card item ${ap === false ? 'na' : ''}" id="item-${esc(it.id)}">
      <div class="item-body">
        <div class="item-head"><h3>${esc(it.title)}</h3>${it.hot ? '<span class="badge hot">개정</span>' : ''}</div>
        <div class="item-meta"><span class="badge blue">${cat.icon} ${esc(cat.name)}</span>${sizeBadge(it)}${recent ? `<span class="badge red">${dday(it.updated) > 0 ? '시행 예정' : '최근 개정'} ${esc(ymd(it.updated))}</span>` : ''}</div>
        <div class="chips">${it.refs.map((r) => refChip(r)).join('')}</div>
        <ul style="margin-top:10px">${sum.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        ${ap === false ? `<div class="size-note na">👥 상시 ${state.size}명 사업장에는 적용되지 않습니다(상시 ${it.minSize}명 이상부터 적용).</div>` : ''}
        ${notes.map((x) => `<div class="size-note">👥 ${esc(x.text)}</div>`).join('')}
        ${open && it.tip ? `<div class="tip">💡 ${esc(it.tip)}</div>` : ''}
        ${(it.summary.length > 2 || it.tip) && !state.expandAll ? `<button class="more-btn" type="button" data-toggle="${esc(it.id)}">${open ? '접기 ▲' : '자세히 ▼'}</button>` : ''}
      </div>
      <div class="penalty t-${esc(p.type)}" role="button" tabindex="0" data-ref="${esc(p.refs[0])}" aria-label="위반 시 처벌: ${esc(p.text)} — 클릭하면 법문 보기">
        <div class="p-head">⚖ 위반 시 처벌 <span class="badge ${p.type === 'crime' ? 'red' : p.type === 'fine' ? 'amber' : 'gray'}">${PTYPE[p.type] || ''}</span></div>
        <div class="p-text">${esc(p.text)}</div>
        <div class="p-refs">${p.refs.map((r) => refChip(r)).join('')}<span class="p-go">법문 보기 →</span></div>
      </div>
    </article>`;
  }

  // ── 검색
  function scoreItem(it, q) {
    if (!q) return 1;
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const refText = it.refs.concat(it.penalty.refs).map((r) => { const p = parseRef(r); return `${p.short} ${p.law} ${p.label} ${p.no}조`; }).join(' ');
    const fields = [
      [it.title, 6], [it.keywords.join(' '), 4], [refText, 3], [catOf(it.cat).name, 2], [it.summary.join(' '), 1], [it.penalty.text, 1], [it.tip, 1],
    ].map(([t, w]) => [String(t || '').toLowerCase(), w]);
    let score = 0;
    for (const t of terms) {
      let s = 0;
      for (const [f, w] of fields) if (f.includes(t)) s += w;
      if (!s) return 0;
      score += s;
    }
    return score;
  }
  function filteredItems() {
    const q = state.q.trim();
    let list = D.ITEMS.map((it) => ({ it, s: scoreItem(it, q) })).filter((x) => x.s > 0);
    if (state.cat !== 'all') list = list.filter((x) => x.it.cat === state.cat);
    if (hasSize()) { if (!state.showNA) list = list.filter((x) => applies(x.it)); else list.sort((a, b) => Number(applies(b.it)) - Number(applies(a.it))); }
    else if (state.under5) list = list.filter((x) => x.it.under5 === true);
    if (state.sort === 'rel') list.sort((a, b) => b.s - a.s);
    else if (state.sort === 'law') list.sort((a, b) => { const A = parseRef(a.it.refs[0]); const B = parseRef(b.it.refs[0]); return A.law.localeCompare(B.law, 'ko') || A.no - B.no || A.br - B.br; });
    else if (state.sort === 'recent') list.sort((a, b) => String(b.it.updated).localeCompare(String(a.it.updated)));
    if (hasSize() && state.showNA) list = list.filter((x) => applies(x.it)).concat(list.filter((x) => !applies(x.it)));
    return list.map((x) => x.it);
  }

  // ── 라우팅
  function currentRoute() { return (location.hash.replace(/^#/, '').split('?')[0]) || 'dashboard'; }
  function routeParams() { const q = location.hash.split('?')[1] || ''; return new URLSearchParams(q); }
  function go(route, params) {
    const hash = `#${route}${params ? `?${new URLSearchParams(params)}` : ''}`;
    if (location.hash === hash) render(); else location.hash = hash;
  }

  function renderNav() {
    const r = currentRoute();
    $('#sideNav').innerHTML = NAV.map((n) => `<a href="#${n.id}" class="${r === n.id ? 'active' : ''}" ${r === n.id ? 'aria-current="page"' : ''}><span class="ico">${n.ico}</span>${n.label}</a>`).join('');
    $('#bottomNav').innerHTML = NAV.filter((n) => !n.mobileHidden).map((n) => `<a href="#${n.id}" class="${r === n.id ? 'active' : ''}" ${r === n.id ? 'aria-current="page"' : ''}><span class="ico">${n.ico}</span>${n.short}</a>`).join('');
  }

  // ── 대시보드
  function renderDashboard() {
    const today = todayStr();
    const upcoming = D.CHANGES.filter((c) => c.date >= today).slice(0, 5);
    const recent = D.CHANGES.filter((c) => c.date < today).slice(-3).reverse();
    const crimes = D.ITEMS.filter((i) => i.penalty.type === 'crime').length;
    const fines = D.ITEMS.filter((i) => i.penalty.type === 'fine').length;
    const nextC = upcoming[0];
    const hot = D.ITEMS.filter((i) => i.hot && applies(i) !== false).slice(0, 8);
    const year = Number(today.slice(0, 4));
    const mw = D.MIN_WAGE[year] || D.MIN_WAGE[2026];
    const mwNext = D.MIN_WAGE[year + 1];
    return `
      <section class="hero">
        <p class="eyebrow" style="color:#bae6fd">HR LABOR LAW DASHBOARD</p>
        <h1>인사담당자가 자주 찾는 노동법 조문과<br>위반 시 처벌규정을 한곳에서</h1>
        <p>법제처 Open API로 조문 원문과 시행일을 실시간으로 불러옵니다.</p>
        <form id="heroSearch" role="search"><input id="heroInput" type="search" placeholder="예: 연차 계산, 해고예고, 임금체불 처벌, 육아휴직" aria-label="조문 검색" /><button class="btn" type="submit">검색</button></form>
        <div class="chips">${['연차', '퇴직금', '해고예고', '주휴수당', '최저임금', '직장 내 괴롭힘', '육아휴직', '임금체불'].map((k) => `<button class="chip" type="button" data-q="${k}">${k}</button>`).join('')}</div>
      </section>

      <section class="grid g-4" style="margin-bottom:18px">
        ${hasSize() ? `<div class="card kpi"><span class="k-label">👥 상시 ${state.size.toLocaleString()}명 적용</span><span class="k-value">${D.ITEMS.filter((i) => applies(i)).length}<small>/ ${D.ITEMS.length}개</small></span><span class="k-sub">미적용 ${D.ITEMS.filter((i) => !applies(i)).length}개 주제</span></div>` : `<div class="card kpi"><span class="k-label">📌 수록 주제</span><span class="k-value">${D.ITEMS.length}<small>개</small></span><span class="k-sub">${D.CATEGORIES.length}개 분야 · ${Object.keys(D.LAWS).length}개 법령</span></div>`}
        <div class="card kpi"><span class="k-label">⚖ 처벌규정</span><span class="k-value">${crimes}<small>형사</small> · ${fines}<small>과태료</small></span><span class="k-sub">모든 항목 하단에 표기</span></div>
        <div class="card kpi"><span class="k-label">💰 ${year}년 최저시급</span><span class="k-value">${mw.toLocaleString()}<small>원</small></span><span class="k-sub">${mwNext ? `${year + 1}년 ${mwNext.toLocaleString()}원 (+${((mwNext / mw - 1) * 100).toFixed(1)}%)` : `월 ${(mw * 209).toLocaleString()}원 (209h)`}</span></div>
        <div class="card kpi"><span class="k-label">📅 다음 시행</span><span class="k-value">${nextC ? `D-${dday(nextC.date)}` : '-'}</span><span class="k-sub">${nextC ? esc(nextC.title) : '예정 일정 없음'}</span></div>
      </section>

      ${sizeSection()}

      <section class="grid g-2" style="margin-bottom:18px">
        <div class="card"><h2 class="section">📅 다가오는 개정·시행 <a class="more" href="#changes">전체 보기 →</a></h2>
          <ul class="tl">${upcoming.map(changeLi).join('') || '<li class="muted">예정된 일정이 없습니다.</li>'}</ul>
          ${recent.length ? `<h2 class="section" style="margin-top:16px;font-size:14px">최근 시행</h2><ul class="tl">${recent.map(changeLi).join('')}</ul>` : ''}
        </div>
        <div class="card"><h2 class="section">🔄 법령 최신 현황 <span class="badge blue">법제처 자동 업데이트</span><button class="btn sm ghost more" type="button" id="refreshInfo">새로고침</button></h2>
          <div id="lawStatus"></div>
        </div>
      </section>

      <section style="margin-bottom:18px"><h2 class="section">🗂 분야별 핵심 조문</h2>
        <div class="grid g-4">${D.CATEGORIES.map((c) => `<a class="card cat-tile" href="#search?cat=${c.id}"><span class="ico">${c.icon}</span><span><strong>${esc(c.name)}</strong><span>${D.ITEMS.filter((i) => i.cat === c.id).length}개 주제</span></span></a>`).join('')}</div>
      </section>

      <section><h2 class="section">🔥 최근 개정·주요 항목 <a class="more" href="#search?sort=recent">최근 개정순 →</a></h2>
        <div class="items">${hot.map(itemCard).join('')}</div>
      </section>`;
  }
  function sizeSection() {
    const th = D.THRESHOLDS.map((t) => {
      const on = hasSize() && state.size >= t.min;
      return `<li class="${hasSize() ? (on ? 'on' : 'off') : ''}"><span class="th-ico">${hasSize() ? (on ? '✅' : '⬜') : '•'}</span><span class="th-title">${esc(t.title)}</span><span>${esc(t.text)}${t.ref ? ` ${refChip(t.ref)}` : ''}</span></li>`;
    }).join('');
    const na = hasSize() ? D.ITEMS.filter((i) => !applies(i)) : [];
    const notes = hasSize() ? D.ITEMS.filter((i) => applies(i)).flatMap((i) => sizeNotesFor(i).map((x) => ({ it: i, x }))) : [];
    return `<section class="grid g-2" style="margin-bottom:18px">
      <div class="card"><h2 class="section">🏢 ${hasSize() ? `우리 회사(상시 ${state.size.toLocaleString()}명) 규모별 의무` : '규모별 주요 의무'} <a class="more" href="#search">${hasSize() ? '적용 조문 보기 →' : ''}</a></h2>
        ${hasSize() ? '' : '<p class="small muted" style="margin-top:-6px">상단에 상시근로자 수를 입력하면 해당되는 의무에 ✅ 표시가 됩니다.</p>'}
        <ul class="th-list">${th}</ul></div>
      <div class="card"><h2 class="section">👥 ${hasSize() ? '적용 제외·유의사항' : '인원 입력'}</h2>
        ${hasSize() ? `${na.length ? `<p class="small" style="margin:0 0 8px"><strong>적용되지 않는 주제 ${na.length}개</strong></p><div class="chips">${na.map((i) => `<a class="chip" href="#search?item=${esc(i.id)}" title="${i.minSize}명 이상 적용">${esc(i.title)} <span class="muted">(${i.minSize}명~)</span></a>`).join('')}</div>` : '<p class="small">수록된 모든 주제가 적용됩니다.</p>'}
          ${notes.length ? `<p class="small" style="margin:14px 0 6px"><strong>우리 회사 규모 유의사항</strong></p>${notes.map(({ it, x }) => `<div class="size-note" style="margin-top:6px"><a href="#search?item=${esc(it.id)}">${esc(it.title)}</a> — ${esc(x.text)}</div>`).join('')}` : ''}`
        : `<p class="small muted" style="margin-top:-6px">상시근로자 수에 따라 근로기준법 적용 범위가 달라집니다(5인·10인·30인·50인 등). 아래에서 고르거나 상단 입력칸에 직접 입력하세요.</p><div class="size-quick">${[3, 5, 10, 30, 50, 100, 300].map((k) => `<button type="button" class="chip" data-size="${k}">${k}명</button>`).join('')}</div>
          <p class="small muted" style="margin-top:12px">상시근로자 수 = 산정기간(1개월) 동안 사용한 근로자 연인원 ÷ 가동일수 ${refChip('근기령|7-2')}</p>`}
      </div></section>`;
  }
  const changeLi = (c) => {
    const d = dday(c.date);
    return `<li><span class="date">${esc(ymd(c.date))}<br>${d > 0 ? `<span class="badge amber">D-${d}</span>` : d === 0 ? '<span class="badge red">오늘 시행</span>' : '<span class="badge green">시행 중</span>'}</span>
      <div><div class="t-title">${esc(c.title)}</div><div class="t-detail">${esc(D.LAWS[c.law].short)} · ${esc(c.detail)}</div>${c.ref ? `<div class="chips" style="margin-top:6px">${refChip(c.ref)}</div>` : ''}</div></li>`;
  };
  function renderLawStatus() {
    const el = $('#lawStatus'); if (!el) return;
    const info = state.info;
    if (!info) {
      el.innerHTML = state.apiOk === false
        ? `<div class="notice err">법제처 API에 연결하지 못했습니다.<br><span class="small">${esc(state.apiError || '')}</span></div><p class="small muted">수록된 요약·처벌규정은 그대로 이용할 수 있습니다. <a href="#settings">API 설정 →</a></p>`
        : '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton" style="width:70%"></div>';
      return;
    }
    const rows = info.laws.map((l) => {
      if (!l.ok) return `<tr><td>${esc(l.name)}</td><td class="small muted">조회 실패</td><td class="hide-sm"></td></tr>`;
      const eff = l.effective ? `${l.effective.slice(0, 4)}-${l.effective.slice(4, 6)}-${l.effective.slice(6, 8)}` : '';
      const d = eff ? dday(eff) : null;
      const flag = d != null && d > 0 ? `<span class="badge amber">시행 예정 D-${d}</span>` : d != null && d >= -60 ? '<span class="badge red">NEW</span>' : '';
      const short = (Object.values(D.LAWS).find((x) => x.name.replace(/[\s·ㆍ]/g, '') === String(l.name).replace(/[\s·ㆍ]/g, '')) || {}).short || l.name;
      return `<tr><td><button class="chip" type="button" data-open-law="${esc(l.name)}" title="${esc(l.name)} 전문 보기">${esc(short)}</button></td><td class="num">${esc(ymd(l.effective))} ${flag}</td><td class="small muted hide-sm">${esc(l.revision || '')} · 공포 ${esc(ymd(l.promulgated))}</td></tr>`;
    }).join('');
    el.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>법령</th><th>현행 시행일</th><th class="hide-sm">개정 정보</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="small muted" style="margin:8px 0 0">확인 ${esc(new Date(info.checkedAt).toLocaleString('ko-KR'))} · 법제처 데이터가 바뀌면 자동으로 갱신됩니다.</p>`;
  }

  const countText = (list) => (hasSize() ? `상시 ${state.size}명 적용 ${list.filter((it) => applies(it)).length}건${state.showNA ? ` · 미적용 ${list.filter((it) => !applies(it)).length}건` : ''}` : `수록 주제 ${list.length}건`);
  function sizeBanner() {
    if (!hasSize()) return `<div class="size-banner">👥 <span>상단 <strong>상시근로자 수</strong>를 입력하면 우리 회사에 적용되는 법 내용만 골라 보여 드립니다.</span><span class="size-quick">${[3, 5, 10, 30, 50, 100, 300].map((k) => `<button type="button" class="chip" data-size="${k}">${k}명</button>`).join('')}</span></div>`;
    const ap = D.ITEMS.filter((it) => applies(it)).length;
    return `<div class="size-banner">👥 <span><strong>상시근로자 ${state.size.toLocaleString()}명</strong> 기준 · 수록 ${D.ITEMS.length}개 주제 중 <strong>${ap}개 적용</strong>, ${D.ITEMS.length - ap}개 미적용</span><span class="small muted">상시근로자 수 산정 ${refChip('근기령|7-2')}</span><button type="button" class="btn sm ghost" data-size-clear>기준 해제</button></div>`;
  }

  // ── 조문 찾기
  function renderSearch() {
    const p = routeParams();
    if (p.has('q')) state.q = p.get('q');
    if (p.has('cat')) state.cat = p.get('cat');
    if (p.has('sort')) state.sort = p.get('sort');
    const focusItem = p.get('item');
    if (focusItem) { state.q = ''; state.cat = 'all'; state.expanded.add(focusItem); }
    const list = filteredItems();
    return `
      <div class="page-head"><div><p class="eyebrow">ARTICLE SEARCH</p><h1>조문 찾기</h1><p>주제·키워드·조문번호(예: 56조)로 검색하세요. 각 항목 하단에 위반 시 처벌규정이 있으며, 클릭하면 법문을 볼 수 있습니다.</p></div></div>
      ${sizeBanner()}
      <div class="card" style="margin-bottom:14px">
        <form class="search-row" id="searchForm" role="search"><input id="searchInput" type="search" value="${esc(state.q)}" placeholder="예: 연차, 해고예고, 76조의2, 과태료" aria-label="검색어" /><button class="btn primary" type="submit">검색</button></form>
        <div class="cat-bar" style="margin-top:12px">${[{ id: 'all', name: '전체', icon: '✨' }].concat(D.CATEGORIES).map((c) => `<button type="button" class="chip ${state.cat === c.id ? 'on' : ''}" data-cat="${c.id}">${c.icon} ${esc(c.name)}</button>`).join('')}</div>
        <div class="toolbar" style="margin:4px 0 0">
          <span class="count">${countText(list)}</span>
          ${hasSize() ? `<label class="toggle"><input type="checkbox" id="showNA" ${state.showNA ? 'checked' : ''}/> 미적용 항목도 보기</label>` : `<label class="toggle"><input type="checkbox" id="under5" ${state.under5 ? 'checked' : ''}/> 5인 미만 적용만</label>`}
          <label class="toggle"><input type="checkbox" id="expandAll" ${state.expandAll ? 'checked' : ''}/> 모두 펼치기</label>
          <select class="select" id="sortSel" aria-label="정렬"><option value="rel" ${state.sort === 'rel' ? 'selected' : ''}>관련도순</option><option value="law" ${state.sort === 'law' ? 'selected' : ''}>법령·조문순</option><option value="recent" ${state.sort === 'recent' ? 'selected' : ''}>최근 개정순</option></select>
        </div>
      </div>
      <div class="items" id="itemList">${list.map(itemCard).join('') || `<div class="card empty" style="grid-column:1/-1">'${esc(state.q)}'에 해당하는 수록 주제가 없습니다.</div>`}</div>
      ${state.q.trim() ? `<div class="card" style="margin-top:16px"><h2 class="section">📚 법제처 법령 본문 검색</h2><p class="small muted" style="margin-top:-6px">수록 주제 밖의 내용은 법제처 전체 법령에서 '${esc(state.q)}'이(가) 들어간 법령을 찾습니다.</p><button class="btn" type="button" id="drfSearch">법제처에서 '${esc(state.q)}' 검색</button><div id="drfResult" style="margin-top:12px"></div></div>` : ''}`;
  }
  async function runDrfSearch(query, target, mode) {
    const box = $(target); if (!box) return;
    box.innerHTML = '<div class="skeleton"></div><div class="skeleton" style="width:60%"></div>';
    try {
      const body = await cachedApi({ action: 'search', query, search: mode || '2', display: 30 });
      if (!body.items.length) { box.innerHTML = '<p class="muted small">검색 결과가 없습니다.</p>'; return; }
      box.innerHTML = `<p class="small muted">총 ${body.total.toLocaleString()}건 중 ${body.items.length}건</p><div class="table-wrap"><table class="table"><thead><tr><th>법령명</th><th>구분</th><th>시행일</th></tr></thead><tbody>${
        body.items.map((x) => `<tr><td><button class="chip" type="button" data-open-law="${esc(x.name)}">${esc(x.name)}</button></td><td class="small">${esc(x.kind)}${x.ministry ? ` · ${esc(x.ministry)}` : ''}</td><td class="num">${esc(ymd(x.effective))}</td></tr>`).join('')}</tbody></table></div>`;
    } catch (e) {
      box.innerHTML = `<div class="notice err">${esc(e.message)}</div>`;
    }
  }

  // ── 법령 전문·검색
  function renderLaw() {
    const p = routeParams();
    if (p.get('name')) state.law = p.get('name');
    const tracked = D.TRACKED.map((k) => D.LAWS[k]);
    if (!state.law) state.law = tracked[0].name;
    const isTracked = tracked.some((l) => l.name === state.law);
    return `
      <div class="page-head"><div><p class="eyebrow">FULL TEXT</p><h1>법령 전문·검색</h1><p>국가법령정보센터(법제처) 공식 원문을 실시간으로 불러옵니다.</p></div></div>
      <div class="law-layout">
        <div class="stack">
          <div class="card"><h2 class="section">📚 주요 노동법령</h2>
            <div class="law-list">${tracked.map((l) => `<button type="button" data-open-law="${esc(l.name)}" class="${l.name === state.law ? 'on' : ''}">${esc(l.short)}<small>${esc(l.name)}</small></button>`).join('')}
            ${!isTracked ? `<button type="button" class="on">${esc(state.law)}<small>검색한 법령</small></button>` : ''}</div>
          </div>
          <div class="card"><h2 class="section">🔍 법제처 법령 검색</h2>
            <form class="search-row" id="lawSearchForm"><input id="lawSearchInput" type="search" placeholder="법령명 (예: 고용보험법)" aria-label="법령명 검색" /><button class="btn primary" type="submit">검색</button></form>
            <div id="lawSearchResult" style="margin-top:10px"></div>
          </div>
        </div>
        <div class="card" id="lawView">
          <div class="page-head" style="margin-bottom:10px"><div><h2 style="margin:0;font-size:19px">${esc(state.law)}</h2><p class="small muted" id="lawMeta">불러오는 중…</p></div>
            <a class="btn sm" href="${lawLink(state.law)}" target="_blank" rel="noopener">국가법령정보센터 ↗</a></div>
          <div class="search-row" style="margin-bottom:8px"><input id="lawFilter" type="search" placeholder="조문 내 검색 (예: 휴게, 제60조)" value="${esc(state.lawFilter)}" aria-label="조문 내 검색" /></div>
          <div id="lawArticles"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton" style="width:70%"></div><div class="skeleton"></div></div>
        </div>
      </div>`;
  }
  let lawData = null;
  async function loadLawFull() {
    const name = state.law;
    try {
      const body = await cachedApi({ action: 'full', law: name });
      if (state.law !== name || currentRoute() !== 'law') return;
      lawData = body;
      const meta = $('#lawMeta');
      if (meta) meta.textContent = `시행 ${ymd(body.law.effective)} · 공포 ${ymd(body.law.promulgated)} · ${body.law.revision || ''} · ${body.law.ministry || ''} · 조문 ${body.articles.filter((a) => !a.chapter).length}개`;
      drawLawArticles();
    } catch (e) {
      const box = $('#lawArticles');
      if (box) box.innerHTML = `<div class="notice err"><strong>원문을 불러오지 못했습니다.</strong><br>${esc(e.message)}</div><p class="small"><a href="${lawLink(name)}" target="_blank" rel="noopener">국가법령정보센터에서 보기 ↗</a></p>`;
      const meta = $('#lawMeta'); if (meta) meta.textContent = '불러오기 실패';
    }
  }
  function drawLawArticles() {
    const box = $('#lawArticles'); if (!box || !lawData) return;
    const f = state.lawFilter.trim().replace(/\s+/g, '');
    const norm = (s) => String(s).replace(/\s+/g, '');
    let html = '';
    let count = 0;
    for (const a of lawData.articles) {
      if (a.chapter) { if (!f) html += `<div class="chapter">${esc(a.title)}</div>`; continue; }
      if (f && !norm(`${a.label}${a.title}${a.lines.map((l) => l.text).join('')}`).includes(f)) continue;
      count += 1;
      html += articleHtml(a);
      if (count > 400) break;
    }
    box.innerHTML = html || '<p class="muted">일치하는 조문이 없습니다.</p>';
  }

  // ── 계산기
  function renderCalc() {
    const year = Number(todayStr().slice(0, 4));
    const yrs = Object.keys(D.MIN_WAGE).map(Number).sort((a, b) => b - a);
    const curMW = D.MIN_WAGE[year] || D.MIN_WAGE[2026];
    const f = (id, label, type, val, attrs = '') => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${esc(val)}" ${type === 'number' ? 'inputmode="decimal" min="0"' : ''} ${attrs}/></div>`;
    return `
      <div class="page-head"><div><p class="eyebrow">CALCULATORS</p><h1>실무 계산기</h1><p>입력값을 바꾸면 바로 계산됩니다. 결과는 참고용입니다.</p></div></div>
      <div class="calc-grid">
        <section class="card calc calc-wide" data-calc="sal"><h3>🧾 연봉 → 월 급여 구성 변환</h3><p class="desc">최종 연봉을 입력하면 월 급여를 <strong>기본급 + 고정 연장근로수당 + 식대</strong>로 자동 분배합니다. (연봉에 퇴직금 미포함 기준)</p>
          <div class="fields sal-fields">
            <div class="field"><label for="sal_annual">최종 연봉(원)</label><input id="sal_annual" type="text" inputmode="numeric" value="40,000,000" autocomplete="off" /><span class="small muted" id="sal_annual_hint"></span></div>
            ${f('sal_ot', '월 고정 연장근로시간', 'number', 26, 'step="0.5"')}
            ${f('sal_meal', '식대(원/월)', 'number', 200000, 'step="10000"')}
            <div class="field"><label for="sal_year">최저임금 비교 연도</label><select id="sal_year">${yrs.map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}년 · ${D.MIN_WAGE[y].toLocaleString()}원</option>`).join('')}</select></div>
            <div class="field"><label for="sal_meal_inc">식대의 통상임금 포함</label><select id="sal_meal_inc"><option value="1">포함 (정기·일률 지급, 권장)</option><option value="0">제외</option></select></div>
            <div class="field"><label for="sal_rate">연장근로 가산율</label><select id="sal_rate"><option value="1.5" ${hasSize() && state.size < 5 ? '' : 'selected'}>150% (상시 5인 이상)</option><option value="1" ${hasSize() && state.size < 5 ? 'selected' : ''}>100% (5인 미만)</option></select></div>
          </div>
          <div class="result" id="sal_out"></div>
          <div class="ref-line">근거 ${refChip('근기|56')}${refChip('근기령|6')}${refChip('최임|6')}${refChip('근기|53')} <button type="button" class="btn sm" id="salCopy" style="margin-left:auto">결과 복사</button></div></section>

        <section class="card calc" data-calc="leave"><h3>📆 연차유급휴가 일수</h3><p class="desc">출근율 80% 이상 기준 · 5인 이상 사업장</p>
          <div class="fields">${f('lv_hire', '입사일', 'date', `${year - 3}-03-02`)}${f('lv_base', '기준일', 'date', todayStr())}</div>
          <div class="result" id="lv_out"></div><div class="ref-line">근거 ${refChip('근기|60')}${refChip('근기|61')}</div></section>

        <section class="card calc" data-calc="sev"><h3>💼 퇴직금</h3><p class="desc">평균임금 × 30일 × 재직일수/365 · 1년 이상, 주 15시간 이상</p>
          <div class="fields">${f('sv_hire', '입사일', 'date', `${year - 5}-01-02`)}${f('sv_last', '마지막 근무일', 'date', todayStr())}
            ${f('sv_wage', '퇴직 전 3개월 임금총액(원)', 'number', 10500000)}${f('sv_bonus', '연간 상여금(원)', 'number', 3000000)}
            ${f('sv_leave', '연차수당(원, 직전 1년)', 'number', 0)}${f('sv_hours', '1주 소정근로시간', 'number', 40)}</div>
          <div class="result" id="sv_out"></div><div class="ref-line">근거 ${refChip('퇴직|8')}${refChip('퇴직|9')}${refChip('근기|2')}</div></section>

        <section class="card calc" data-calc="wh"><h3>🗓 주휴수당</h3><p class="desc">(1주 소정근로시간 ÷ 40) × 8 × 시급 · 15시간 미만 미적용</p>
          <div class="fields">${f('wh_hours', '1주 소정근로시간', 'number', 20)}${f('wh_wage', '시급(원)', 'number', curMW)}</div>
          <div class="result" id="wh_out"></div><div class="ref-line">근거 ${refChip('근기|55')}${refChip('근기령|30')}</div></section>

        <section class="card calc" data-calc="mw"><h3>💰 최저임금 충족 확인</h3><p class="desc">월 급여(산입 임금) ÷ 월 소정근로시간(유급주휴 포함)</p>
          <div class="fields"><div class="field"><label for="mw_year">적용 연도</label><select id="mw_year">${yrs.map((y) => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}년 · ${D.MIN_WAGE[y].toLocaleString()}원</option>`).join('')}</select></div>
            ${f('mw_hours', '월 소정근로시간', 'number', 209)}${f('mw_pay', '월 급여(원)', 'number', 2200000, 'class="full"')}</div>
          <div class="result" id="mw_out"></div><div class="ref-line">근거 ${refChip('최임|6')}${refChip('최임|28')}</div></section>

        <section class="card calc" data-calc="ot"><h3>⏱ 연장·야간·휴일 가산수당</h3><p class="desc">통상시급 기준 · 야간은 가산분(50%)만 계산</p>
          <div class="fields">${f('ot_wage', '통상시급(원)', 'number', curMW)}${f('ot_ext', '연장근로(시간)', 'number', 10)}${f('ot_night', '야간근로(시간)', 'number', 4)}${f('ot_h8', '휴일근로 8시간 이내(시간)', 'number', 8)}${f('ot_hx', '휴일근로 8시간 초과(시간)', 'number', 0)}
            <div class="field"><label for="ot_u5">사업장 규모</label><select id="ot_u5"><option value="0">상시 5인 이상</option><option value="1" ${hasSize() && state.size < 5 ? 'selected' : ''}>5인 미만(가산 미적용)</option></select></div></div>
          <div class="result" id="ot_out"></div><div class="ref-line">근거 ${refChip('근기|56')}</div></section>

        <section class="card calc" data-calc="np"><h3>🚪 해고예고수당</h3><p class="desc">30일 전 예고하지 않은 경우 통상임금 30일분 이상</p>
          <div class="fields">${f('np_wage', '통상시급(원)', 'number', curMW)}${f('np_hours', '1일 소정근로시간', 'number', 8)}</div>
          <div class="result" id="np_out"></div><div class="ref-line">근거 ${refChip('근기|26')}</div></section>
      </div>`;
  }
  const v = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  const n = (id) => Number(v(id)) || 0;
  const setOut = (id, html, cls = '') => { const el = document.getElementById(id); if (el) { el.className = `result ${cls}`; el.innerHTML = html; } };
  let salText = '';
  function runSalary() {
    const raw = v('sal_annual').replace(/[^0-9]/g, '');
    const annual = Number(raw);
    const hint = document.getElementById('sal_annual_hint');
    if (hint) hint.textContent = annual ? `${(annual / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만원 · 월 ${won(Math.floor(annual / 12))}` : '';
    const y = Number(v('sal_year'));
    const r = C.salaryBreakdown({ annual, otHours: n('sal_ot'), meal: n('sal_meal'), mealInOrdinary: v('sal_meal_inc') === '1', rate: Number(v('sal_rate')), minHourly: D.MIN_WAGE[y] });
    if (r.error) { setOut('sal_out', esc(r.error), 'err'); salText = ''; return; }
    const rows = [
      ['기본급', r.base, '209시간분(유급주휴 포함)'],
      [`고정 연장근로수당 (${r.otHours}시간)`, r.ot, `통상시급 ${won2(r.ordinaryHourly)} × ${r.otHours}h × ${r.rate}`],
      ['식대', r.meal, r.meal <= 200000 ? '월 20만원까지 비과세' : `비과세 20만원 / 과세 ${won(r.meal - 200000)}`],
    ];
    const weekly = r.otHours / 4.345;
    const warns = [];
    if (r.minWageOk === false) warns.push(`⚠ 최저임금 미달: 산입 시간급 ${won(r.minWageHourly)} < ${y}년 ${won(D.MIN_WAGE[y])} (기본급+식대 ÷ 209h 기준)`);
    if (weekly > 12) warns.push(`⚠ 월 ${r.otHours}시간은 주 평균 약 ${weekly.toFixed(1)}시간으로 연장근로 한도(주 12시간)를 넘을 수 있습니다.`);
    if (r.rate === 1 && !(hasSize() && state.size < 5)) warns.push('ℹ 5인 이상 사업장은 연장근로 가산(50%)이 의무입니다.');
    setOut('sal_out', `<div class="r-main">월 급여 ${won(r.monthly)}</div>
      <div class="table-wrap" style="margin-top:8px"><table class="table"><thead><tr><th>항목</th><th class="num">월</th><th class="num">연간</th><th>산정 근거</th></tr></thead><tbody>
      ${rows.map(([k, val, note]) => `<tr><td><strong>${esc(k)}</strong></td><td class="num">${won(val)}</td><td class="num">${won(val * 12)}</td><td class="small">${esc(note)}</td></tr>`).join('')}
      <tr><td><strong>합계</strong></td><td class="num"><strong>${won(r.monthly)}</strong></td><td class="num"><strong>${won(r.monthly * 12)}</strong></td><td class="small">${r.annualRemainder ? `연봉 ÷ 12 원 단위 절사(연 ${won(r.annualRemainder)} 차이)` : ''}</td></tr></tbody></table></div>
      <div class="r-sub">통상시급 ${won2(r.ordinaryHourly)} · 최저임금 산입 시간급 ${won2(r.minWageHourly)} ${r.minWageOk ? `(✅ ${y}년 최저임금 충족)` : ''}</div>
      ${warns.map((w) => `<div class="r-sub" style="color:var(--red);font-weight:600">${esc(w)}</div>`).join('')}`, r.minWageOk === false ? 'warn' : '');
    salText = [`연봉 ${won(annual)} → 월 ${won(r.monthly)}`, ...rows.map(([k, val]) => `${k}: ${won(val)}`), `통상시급: ${won2(r.ordinaryHourly)}`].join('\n');
  }
  function runCalcs() {
    runSalary();
    const lv = C.annualLeave(v('lv_hire'), v('lv_base'));
    if (lv.error) setOut('lv_out', esc(lv.error), 'err');
    else if (hasSize() && state.size < 5) setOut('lv_out', `<div class="r-main">적용 제외</div><div class="r-sub">상시 ${state.size}명(5인 미만) 사업장은 연차유급휴가 규정이 적용되지 않습니다. (참고: 5인 이상이라면 ${lv.days}일)</div>`, 'warn');
    else setOut('lv_out', `<div class="r-main">${lv.days}일</div><div class="r-sub">근속 ${Math.floor(lv.months / 12)}년 ${lv.months % 12}개월 · ${esc(lv.basis)}</div>`);

    const sv = C.severance({ hire: v('sv_hire'), last: v('sv_last'), wage3m: n('sv_wage'), bonusYear: n('sv_bonus'), leavePayYear: n('sv_leave'), weeklyHours: n('sv_hours') });
    if (sv.error) setOut('sv_out', esc(sv.error), 'err');
    else if (!sv.eligible) setOut('sv_out', `<div class="r-main">지급 대상 아님</div><div class="r-sub">재직 ${sv.serviceDays.toLocaleString()}일 · 계속근로 1년 이상 및 1주 15시간 이상이어야 합니다.</div>`, 'warn');
    else setOut('sv_out', `<div class="r-main">${won(sv.amount)}</div><div class="r-sub">1일 평균임금 ${won(sv.avgDaily)} (3개월 ${sv.days3}일, 산정 임금 ${won(sv.total3)}) · 재직 ${sv.serviceDays.toLocaleString()}일<br>퇴직일 ${ymd(sv.retireDate)} → <strong>지급기한 ${ymd(sv.dueDate)}</strong>(14일 이내)</div>`);

    const wh = C.weeklyHoliday(n('wh_hours'), n('wh_wage'));
    setOut('wh_out', `<div class="r-main">주 ${won(wh.amount)}</div><div class="r-sub">주휴시간 ${wh.hours}시간 · 월 환산 약 ${won(wh.amount * 4.345)} · ${esc(wh.note)}</div>`, wh.amount ? '' : 'warn');

    const mwY = Number(v('mw_year')); const mw = C.minWageCheck(n('mw_pay'), n('mw_hours'), D.MIN_WAGE[mwY]);
    if (mw.error) setOut('mw_out', esc(mw.error), 'err');
    else setOut('mw_out', `<div class="r-main">${mw.ok ? '✅ 충족' : '⚠ 미달'} · 시간급 ${won(mw.hourly)}</div><div class="r-sub">${mwY}년 최저시급 ${won(D.MIN_WAGE[mwY])} · 필요 월급 ${won(mw.required)}${mw.ok ? '' : ` · 부족액 ${won(mw.shortfall)}`}</div>`, mw.ok ? '' : 'warn');

    const ot = C.overtimePay({ hourly: n('ot_wage'), ext: n('ot_ext'), night: n('ot_night'), hol8: n('ot_h8'), holOver: n('ot_hx'), under5: v('ot_u5') === '1' });
    setOut('ot_out', `<div class="r-main">${won(ot.total)}</div><div class="r-sub">${ot.rows.filter((r) => r.hours).map((r) => `${esc(r.label)} ${r.hours}h × ${r.rate} = ${won(r.amount)}`).join('<br>') || '입력된 근로시간이 없습니다.'}</div>`);

    const np = C.noticePay(n('np_wage'), n('np_hours'));
    setOut('np_out', `<div class="r-main">${won(np.amount)}</div><div class="r-sub">1일 통상임금 ${won(n('np_wage') * n('np_hours'))} × 30일 · 계속근로 3개월 미만 등은 예외</div>`);
  }

  // ── 법정 기한
  function renderDeadlines() {
    return `
      <div class="page-head"><div><p class="eyebrow">DEADLINES</p><h1>법정 기한</h1><p>기준일을 입력하면 기한 날짜를 계산합니다(민법 초일불산입 기준).</p></div></div>
      <div class="card" style="margin-bottom:16px">
        <div class="fields" style="grid-template-columns:2fr 1fr"><div class="field"><label for="dl_sel">기한 항목</label><select id="dl_sel">${D.DEADLINES.map((d, i) => `<option value="${i}">${esc(d.title)} — ${esc(d.period)}</option>`).join('')}</select></div>
          <div class="field"><label for="dl_base">기준일</label><input id="dl_base" type="date" value="${todayStr()}" /></div></div>
        <div class="result" id="dl_out"></div>
      </div>
      <div class="card"><h2 class="section">⏳ 주요 법정 기한 한눈에</h2>
        <div class="table-wrap"><table class="table"><thead><tr><th>항목</th><th>기한</th><th>기준</th><th>근거</th></tr></thead><tbody>${
          D.DEADLINES.map((d) => `<tr><td><strong>${esc(d.title)}</strong>${d.note ? `<div class="small muted">${esc(d.note)}</div>` : ''}</td><td>${esc(d.period)}</td><td class="small">${esc(d.base)}</td><td>${refChip(d.ref)}</td></tr>`).join('')}</tbody></table></div>
      </div>`;
  }
  function runDeadline() {
    const d = D.DEADLINES[Number(v('dl_sel'))]; if (!d) return;
    const out = C.deadline(v('dl_base'), d);
    if (!out) { setOut('dl_out', '기준일을 입력하세요.', 'err'); return; }
    const dd = dday(out);
    const ddTxt = dd > 0 ? `D-${dd}` : dd === 0 ? 'D-DAY' : `${-dd}일 지남`;
    const periodic = /마다|매년/.test(d.period);
    setOut('dl_out', `<div class="r-main">${ymd(out)} <span class="badge ${dd < 0 ? 'red' : 'amber'}">${ddTxt}</span></div><div class="r-sub">${esc(d.base)} ${ymd(v('dl_base'))} 기준 · ${esc(d.period)}${periodic ? ' (다음 주기)' : ''} · ${refChip(d.ref)}</div>`, dd < 0 && !periodic ? 'warn' : '');
  }

  // ── 개정·시행 일정
  function renderChanges() {
    const tags = ['all', ...new Set(D.CHANGES.map((c) => c.tag))];
    const today = todayStr();
    const list = D.CHANGES.filter((c) => state.changeTag === 'all' || c.tag === state.changeTag);
    return `
      <div class="page-head"><div><p class="eyebrow">AMENDMENTS</p><h1>개정·시행 일정</h1><p>2026~2028년 인사노무 관련 주요 개정사항을 시행일 순으로 정리했습니다. 오늘 ${ymd(today)} 기준으로 상태가 자동 표시됩니다.</p></div></div>
      <div class="cat-bar">${tags.map((t) => `<button type="button" class="chip ${state.changeTag === t ? 'on' : ''}" data-ctag="${esc(t)}">${t === 'all' ? '전체' : esc(t)}</button>`).join('')}</div>
      <div class="change-list">${list.map((c) => {
        const d = dday(c.date);
        return `<article class="card change ${d < 0 ? 'past' : ''}"><div class="c-date">${esc(ymd(c.date))}<br>${d > 0 ? `<span class="badge amber">D-${d}</span>` : d === 0 ? '<span class="badge red">오늘 시행</span>' : '<span class="badge green">시행 중</span>'}</div>
          <div><h3>${esc(c.title)}</h3><p>${esc(c.detail)}</p><div class="chips"><span class="badge blue">${esc(c.tag)}</span><span class="badge gray">${esc(D.LAWS[c.law].short)}</span>${c.ref ? refChip(c.ref) : ''}</div></div></article>`;
      }).join('')}</div>
      <p class="small muted" style="margin-top:14px">※ 시행령 등 하위법령이 확정되지 않은 항목은 내용이 바뀔 수 있습니다. 최신 원문은 법령 전문 메뉴(법제처 실시간)에서 확인하세요.</p>`;
  }

  // ── 설정
  function renderSettings() {
    return `
      <div class="page-head"><div><p class="eyebrow">SETTINGS</p><h1>법제처 API 설정</h1><p>국가법령정보센터 Open API(DRF) 연동 상태를 확인하고 인증키(OC)를 관리합니다.</p></div></div>
      <div class="grid g-2">
        <div class="card"><h2 class="section">🔌 연동 상태</h2><div id="apiStatusBox"><div class="skeleton"></div></div>
          <button class="btn" type="button" id="apiTest" style="margin-top:12px">연결 테스트</button></div>
        <div class="card"><h2 class="section">🔑 OC(인증키) 직접 입력 <span class="badge gray">선택</span></h2>
          <p class="small muted" style="margin-top:-6px">서버에 기본 OC가 설정되어 있어 입력하지 않아도 됩니다. 다른 OC를 쓰려면 입력하세요(이 브라우저에만 저장).</p>
          <form class="search-row" id="ocForm"><input id="ocInput" type="text" value="${esc(oc())}" placeholder="open.law.go.kr 가입 ID" autocomplete="off" pattern="[A-Za-z0-9._\\-]{1,64}" /><button class="btn primary" type="submit">저장</button></form>
          <button class="btn sm ghost" type="button" id="ocClear" style="margin-top:8px">초기화</button>
          <div class="notice info small" style="margin-top:14px">자동 업데이트: 조문·시행일 응답은 서버(CDN)에 12시간 캐시되고 이후 자동 재검증됩니다. 법령이 개정되면 별도 배포 없이 반영됩니다.</div>
          <button class="btn sm" type="button" id="cacheClear" style="margin-top:10px">이 브라우저 캐시 비우기</button>
        </div>
      </div>`;
  }
  async function testApi() {
    const box = $('#apiStatusBox'); if (!box) return;
    box.innerHTML = '<div class="skeleton"></div>';
    try {
      const s = await api({ action: 'status' });
      const t0 = performance.now();
      const r = await api({ action: 'article', law: '근로기준법', jo: 60, br: 0 });
      const ms = Math.round(performance.now() - t0);
      box.innerHTML = `<div class="notice info">✅ 정상 연결 (${ms}ms)<br><span class="small">OC: ${s.ocSource === 'env' ? '서버 환경변수(LAW_OC)' : oc() ? '직접 입력값' : '서버 기본값'} · 테스트: ${esc(r.law.name)} ${esc(r.article.label)} (시행 ${esc(ymd(r.law.effective))})</span></div>`;
      setApiPill('ok', '법제처 API 연동 정상');
    } catch (e) {
      box.innerHTML = `<div class="notice err">❌ 연결 실패<br><span class="small">${esc(e.message)}</span></div>`;
      setApiPill('err', `법제처 API 연결 실패 — ${e.message}`);
    }
  }

  // ── 렌더
  function render() {
    const r = currentRoute();
    const known = NAV.some((x) => x.id === r);
    const route = known ? r : 'dashboard';
    renderNav();
    const main = $('#main');
    const views = { dashboard: renderDashboard, search: renderSearch, law: renderLaw, calc: renderCalc, deadlines: renderDeadlines, changes: renderChanges, settings: renderSettings };
    main.innerHTML = views[route]();
    document.title = `${NAV.find((x) => x.id === route).label} · MoonHR 노무 대시보드`;
    if (route === 'dashboard') renderLawStatus();
    if (route === 'calc') runCalcs();
    if (route === 'deadlines') runDeadline();
    if (route === 'law') { lawData = null; loadLawFull(); }
    if (route === 'settings') testApi();
    if (route === 'search') {
      const fi = routeParams().get('item');
      if (fi) { const el = document.getElementById(`item-${fi}`); if (el) { el.scrollIntoView({ block: 'start' }); el.style.boxShadow = '0 0 0 3px rgba(14,165,233,.6), var(--shadow-lg)'; } }
    }
    const ti = $('#topSearchInput'); if (ti && route !== 'search') ti.value = '';
  }
  function rerenderSearchList() {
    const list = filteredItems();
    const box = $('#itemList'); if (!box) return;
    box.innerHTML = list.map(itemCard).join('') || `<div class="card empty" style="grid-column:1/-1">'${esc(state.q)}'에 해당하는 수록 주제가 없습니다.</div>`;
    const cnt = $('.toolbar .count'); if (cnt) cnt.textContent = countText(list);
  }
  const doSearch = (q) => { state.q = q.trim(); state.cat = 'all'; go('search', state.q ? { q: state.q } : null); };

  // ── 이벤트 (위임)
  document.addEventListener('click', (e) => {
    const t = e.target;
    const close = t.closest('[data-close]');
    if (close) { closeModal(); if (close.tagName !== 'A') return; }
    const refEl = t.closest('[data-ref]');
    if (refEl) { e.preventDefault(); e.stopPropagation(); showArticle(refEl.getAttribute('data-ref')); return; }
    const qEl = t.closest('[data-q]');
    if (qEl) { doSearch(qEl.getAttribute('data-q')); return; }
    const tg = t.closest('[data-toggle]');
    if (tg) { const id = tg.getAttribute('data-toggle'); if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id); const card = document.getElementById(`item-${id}`); const it = D.ITEMS.find((x) => x.id === id); if (card && it) card.outerHTML = itemCard(it); return; }
    const cat = t.closest('[data-cat]');
    if (cat) { state.cat = cat.getAttribute('data-cat'); document.querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('on', b.getAttribute('data-cat') === state.cat)); rerenderSearchList(); return; }
    const ct = t.closest('[data-ctag]');
    if (ct) { state.changeTag = ct.getAttribute('data-ctag'); render(); return; }
    const ol = t.closest('[data-open-law]');
    if (ol) { state.law = ol.getAttribute('data-open-law'); state.lawFilter = ''; go('law', { name: state.law }); window.scrollTo(0, 0); return; }
    const sz = t.closest('[data-size]');
    if (sz) { setSize(Number(sz.getAttribute('data-size'))); return; }
    if (t.closest('#sizeClear') || t.closest('[data-size-clear]')) { setSize(null); return; }
    if (t.closest('#salCopy')) { if (salText) copyText(salText); return; }
    if (t.closest('#refreshInfo')) { state.info = null; renderLawStatus(); refreshInfo(true); return; }
    if (t.closest('#drfSearch')) { runDrfSearch(state.q, '#drfResult', '2'); return; }
    if (t.closest('#apiTest')) { testApi(); return; }
    if (t.closest('#ocClear')) { store.del('hr.oc'); clearCache(); render(); toast('OC를 초기화했습니다.'); refreshInfo(true); return; }
    if (t.closest('#cacheClear')) { clearCache(); toast('캐시를 비웠습니다.'); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.penalty[role="button"]')) { e.preventDefault(); showArticle(e.target.getAttribute('data-ref')); }
    if (e.key === 'Tab' && modal.el && !modal.el.hidden) {
      const f = [...modal.el.querySelectorAll('button, a[href], input, [tabindex="0"]')].filter((x) => x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $('#topSearchInput').focus(); }
  });
  document.addEventListener('submit', (e) => {
    const f = e.target; e.preventDefault();
    if (f.id === 'topSearch') doSearch($('#topSearchInput').value);
    else if (f.id === 'heroSearch') doSearch($('#heroInput').value);
    else if (f.id === 'searchForm') doSearch($('#searchInput').value);
    else if (f.id === 'lawSearchForm') { const q = $('#lawSearchInput').value.trim(); if (q) runDrfSearch(q, '#lawSearchResult', '1'); }
    else if (f.id === 'ocForm') {
      const val = $('#ocInput').value.trim();
      if (val && !/^[A-Za-z0-9._-]{1,64}$/.test(val)) { toast('OC는 영문·숫자·._- 만 입력할 수 있습니다.'); return; }
      if (val) store.set('hr.oc', val); else store.del('hr.oc');
      clearCache(); toast('저장했습니다.'); testApi(); refreshInfo(true);
    }
  });
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.closest('[data-calc]')) runCalcs();
    if (t.id === 'dl_sel' || t.id === 'dl_base') runDeadline();
    if (t.id === 'lawFilter') { state.lawFilter = t.value; drawLawArticles(); }
    if (t.id === 'searchInput') { state.q = t.value; rerenderSearchList(); }
    if (t.id === 'sizeInput') { clearTimeout(sizeTimer); sizeTimer = setTimeout(() => { const raw = t.value.trim(); const num = Math.floor(Number(raw)); setSize(raw === '' || !Number.isFinite(num) || num < 0 ? null : Math.min(num, 999999), true); }, 350); }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'sal_annual') { const num = Number(t.value.replace(/[^0-9]/g, '')); t.value = num ? num.toLocaleString('ko-KR') : ''; }
    if (t.closest('[data-calc]')) runCalcs();
    if (t.id === 'dl_sel') runDeadline();
    if (t.id === 'under5') { state.under5 = t.checked; rerenderSearchList(); }
    if (t.id === 'showNA') { state.showNA = t.checked; rerenderSearchList(); }
    if (t.id === 'expandAll') { state.expandAll = t.checked; rerenderSearchList(); }
    if (t.id === 'sortSel') { state.sort = t.value; rerenderSearchList(); }
  });
  let sizeTimer;
  function syncSizeBox() {
    const inp = $('#sizeInput'); const box = $('#sizeBox'); const clr = $('#sizeClear');
    if (inp && document.activeElement !== inp) inp.value = hasSize() ? String(state.size) : '';
    if (box) box.classList.toggle('set', hasSize());
    if (clr) clr.hidden = !hasSize();
  }
  function setSize(v, fromInput) {
    const next = v == null || !Number.isFinite(v) || v < 0 ? null : Math.floor(v);
    if (next === state.size) { syncSizeBox(); return; }
    state.size = next;
    if (next == null) store.del('hr.size'); else store.set('hr.size', next);
    if (!fromInput) { const inp = $('#sizeInput'); if (inp) inp.value = next == null ? '' : String(next); }
    syncSizeBox();
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    toast(next == null ? '상시근로자 수 기준을 해제했습니다.' : `상시근로자 ${next.toLocaleString()}명 기준으로 표시합니다.`);
  }
  function clearCache() {
    memo.clear();
    try { Object.keys(localStorage).filter((k) => k.startsWith('hr.c') || k === 'hr.info').forEach((k) => localStorage.removeItem(k)); } catch (_) { /* noop */ }
  }
  window.addEventListener('hashchange', () => { closeModal(); render(); if (!routeParams().get('item')) window.scrollTo(0, 0); });

  syncSizeBox();
  render();
  refreshInfo(false);
  window.HRApp = { parseRef, scoreItem, filteredItems, state, render, setSize, applies };
})();
