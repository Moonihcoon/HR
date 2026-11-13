/**
 * 법제처(국가법령정보센터) Open API 프록시 — Vercel Serverless Function
 *
 * 엔드포인트: /api/law?action=...
 *   status                              API 설정 여부
 *   search  &query=근로기준법[&search=2][&display=20][&page=1]   법령 검색(search=2: 본문검색)
 *   article &law=근로기준법&jo=56[&br=2]                        특정 조문 원문
 *   full    &law=근로기준법                                     법령 전문(조문 목록)
 *   info    &laws=근로기준법,최저임금법                          법령 현황(공포·시행일) — 자동 업데이트용
 *
 * 인증키(OC): Vercel 환경변수 LAW_OC (open.law.go.kr 에서 발급)
 *             미설정 시 요청 파라미터 oc 사용(설정 화면에서 입력)
 *
 * 자동 업데이트: 응답은 Vercel CDN에 12시간 캐시되고 이후 백그라운드 재검증(stale-while-revalidate)되어
 *               법령이 개정되면 별도 배포 없이 최신 원문·시행일이 반영됩니다.
 */
'use strict';

const BASE = 'https://www.law.go.kr/DRF';
const TIMEOUT_MS = 9000;
const CACHE_OK = 'public, max-age=300, s-maxage=43200, stale-while-revalidate=604800';

const mstCache = new Map(); // normalizedName -> { at, meta }
const MST_TTL = 6 * 60 * 60 * 1000;

const norm = (s) => String(s || '').replace(/[\s·ㆍ・‧∙]/g, '').trim();
const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

// 기본 OC(법제처 open.law.go.kr 가입 ID). 환경변수 LAW_OC가 있으면 우선 사용.
const DEFAULT_OC = 'gasil1980';

function getOC(req) {
  const q = String((req.query && req.query.oc) || '').trim();
  if (/^[A-Za-z0-9._-]{1,64}$/.test(q)) return q; // 설정 화면에서 직접 입력한 값
  const env = (process.env.LAW_OC || '').trim();
  return env || DEFAULT_OC;
}

class ApiError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code || 'ERROR';
  }
}

async function drf(path, params) {
  const url = new URL(`${BASE}/${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'User-Agent': 'moonhr-handbook/1.0' },
    });
  } catch (e) {
    throw new ApiError(504, e.name === 'AbortError' ? '법제처 응답 시간이 초과되었습니다.' : '법제처 서버에 연결할 수 없습니다.', 'UPSTREAM');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  if (!res.ok) throw new ApiError(502, `법제처 API 오류 (HTTP ${res.status})`, 'UPSTREAM');
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    // 인증 실패 등은 HTML/텍스트로 오는 경우가 있음
    if (/검증|인증|OC|등록/.test(text)) throw new ApiError(401, '법제처 API 인증(OC)에 실패했습니다. OC 값과 등록 도메인/IP를 확인하세요.', 'AUTH');
    throw new ApiError(502, '법제처 응답을 해석할 수 없습니다.', 'PARSE');
  }
  const msg = data && (data.result || data.msg || (data.Law && data.Law.result));
  if (msg && /실패|검증|인증|없습니다|오류/.test(String(msg)) && !data.LawSearch && !data['법령']) {
    throw new ApiError(/검증|인증/.test(String(msg)) ? 401 : 404, String(msg), /검증|인증/.test(String(msg)) ? 'AUTH' : 'NOT_FOUND');
  }
  return data;
}

function mapSearchItem(x) {
  return {
    name: x['법령명한글'] || x['법령명'] || '',
    mst: x['법령일련번호'] || '',
    id: x['법령ID'] || '',
    kind: x['법령구분명'] || '',
    promulgated: x['공포일자'] || '',
    promulgationNo: x['공포번호'] || '',
    effective: x['시행일자'] || '',
    revision: x['제개정구분명'] || '',
    ministry: x['소관부처명'] || '',
    status: x['현행연혁코드'] || '',
    link: lawLink(x['법령명한글'] || x['법령명'] || ''),
  };
}

async function searchLaws(oc, query, opts = {}) {
  const data = await drf('lawSearch.do', {
    OC: oc, target: 'law', type: 'JSON', query,
    search: opts.search || 1, display: opts.display || 20, page: opts.page || 1, sort: opts.sort,
  });
  const ls = data.LawSearch || {};
  return { total: Number(ls.totalCnt || 0), page: Number(ls.page || 1), items: arr(ls.law).map(mapSearchItem) };
}

async function resolveLaw(oc, name) {
  const key = norm(name);
  const hit = mstCache.get(key);
  if (hit && Date.now() - hit.at < MST_TTL) return hit.meta;
  const { items } = await searchLaws(oc, name, { display: 50 });
  const exact = items.filter((x) => norm(x.name) === key);
  const pick = exact.find((x) => !x.status || x.status === '현행') || exact[0];
  if (!pick) throw new ApiError(404, `'${name}' 법령을 찾을 수 없습니다.`, 'NOT_FOUND');
  mstCache.set(key, { at: Date.now(), meta: pick });
  return pick;
}

// ── 조문 텍스트 정규화
function flatText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(flatText).filter(Boolean).join('\n');
  if (typeof v === 'object') return Object.values(v).map(flatText).filter(Boolean).join('\n');
  return String(v).replace(/\r/g, '').trim();
}

function formatArticle(u) {
  const lines = [];
  const head = flatText(u['조문내용']);
  if (head) lines.push({ level: 0, text: head });
  arr(u['항']).forEach((h) => {
    const t = flatText(h['항내용']);
    if (t) lines.push({ level: 1, text: t });
    arr(h['호']).forEach((ho) => {
      const t2 = flatText(ho['호내용']);
      if (t2) lines.push({ level: 2, text: t2 });
      arr(ho['목']).forEach((mok) => {
        const t3 = flatText(mok['목내용']);
        if (t3) lines.push({ level: 3, text: t3 });
      });
    });
  });
  const no = Number(u['조문번호']);
  const br = Number(u['조문가지번호'] || 0);
  return {
    no, br,
    label: `제${no}조${br ? `의${br}` : ''}`,
    title: flatText(u['조문제목']),
    kind: u['조문여부'] || '',
    effective: u['조문시행일자'] || '',
    changed: u['조문변경여부'] === 'Y',
    lines,
  };
}

function lawLink(name, label) {
  return `https://www.law.go.kr/${encodeURIComponent('법령')}/${encodeURIComponent(name)}${label ? `/${encodeURIComponent(label)}` : ''}`;
}

function basicInfo(data, meta) {
  const b = (data['법령'] && data['법령']['기본정보']) || {};
  return {
    name: b['법령명_한글'] || meta.name,
    mst: meta.mst,
    id: b['법령ID'] || meta.id,
    promulgated: b['공포일자'] || meta.promulgated,
    effective: b['시행일자'] || meta.effective,
    revision: b['제개정구분'] || meta.revision,
    ministry: (b['소관부처'] && (b['소관부처'].content || b['소관부처']['소관부처명'])) || meta.ministry,
  };
}

async function loadLaw(oc, name, jo) {
  const meta = await resolveLaw(oc, name);
  const data = await drf('lawService.do', { OC: oc, target: 'law', type: 'JSON', MST: meta.mst, JO: jo });
  const units = arr(data['법령'] && data['법령']['조문'] && data['법령']['조문']['조문단위']);
  return { meta, data, units };
}

async function getArticle(oc, name, no, br) {
  const jo = String(no).padStart(4, '0') + String(br || 0).padStart(2, '0');
  const { meta, data, units } = await loadLaw(oc, name, jo);
  const arts = units.filter((u) => u['조문여부'] !== '전문').map(formatArticle);
  const found = arts.find((a) => a.no === Number(no) && a.br === Number(br || 0));
  if (!found) throw new ApiError(404, `${name} 제${no}조${br ? `의${br}` : ''}를 찾을 수 없습니다(삭제·이동되었을 수 있음).`, 'NOT_FOUND');
  return { law: basicInfo(data, meta), article: found, link: lawLink(meta.name, found.label) };
}

async function getFull(oc, name) {
  const { meta, data, units } = await loadLaw(oc, name);
  const items = units.map((u) => (u['조문여부'] === '전문'
    ? { chapter: true, title: flatText(u['조문내용']) }
    : formatArticle(u)));
  return { law: basicInfo(data, meta), articles: items, link: lawLink(meta.name) };
}

async function getInfo(oc, names) {
  const out = await Promise.all(names.slice(0, 15).map(async (n) => {
    try {
      const m = await resolveLaw(oc, n);
      return { ok: true, ...m };
    } catch (e) {
      return { ok: false, name: n, error: e.message };
    }
  }));
  return { checkedAt: new Date().toISOString(), laws: out };
}

function send(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache || 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(body));
}

async function handler(req, res) {
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  req.query = q;
  const action = String(q.action || 'status');
  try {
    if (req.method && req.method !== 'GET') throw new ApiError(405, 'GET만 지원합니다.', 'METHOD');
    if (action === 'status') {
      return send(res, 200, { ok: true, configured: true, ocSource: (process.env.LAW_OC || '').trim() ? 'env' : 'default', source: 'law.go.kr DRF' });
    }
    const oc = getOC(req);
    if (!oc) throw new ApiError(503, '법제처 API 인증키(OC)가 설정되지 않았습니다. Vercel 환경변수 LAW_OC를 설정하거나 설정 메뉴에서 OC를 입력하세요.', 'NO_OC');

    let body;
    if (action === 'search') {
      const query = String(q.query || '').trim().slice(0, 100);
      if (!query) throw new ApiError(400, '검색어를 입력하세요.', 'BAD_REQUEST');
      body = await searchLaws(oc, query, {
        search: q.search === '2' ? 2 : 1,
        display: Math.min(Math.max(parseInt(q.display, 10) || 20, 1), 100),
        page: Math.max(parseInt(q.page, 10) || 1, 1),
      });
    } else if (action === 'article') {
      const law = String(q.law || '').trim();
      const no = parseInt(q.jo, 10);
      const br = parseInt(q.br, 10) || 0;
      if (!law || !(no > 0) || no > 9999 || br < 0 || br > 99) throw new ApiError(400, 'law, jo 파라미터를 확인하세요.', 'BAD_REQUEST');
      body = await getArticle(oc, law, no, br);
    } else if (action === 'full') {
      const law = String(q.law || '').trim();
      if (!law) throw new ApiError(400, 'law 파라미터가 필요합니다.', 'BAD_REQUEST');
      body = await getFull(oc, law);
    } else if (action === 'info') {
      const names = String(q.laws || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!names.length) throw new ApiError(400, 'laws 파라미터가 필요합니다.', 'BAD_REQUEST');
      body = await getInfo(oc, names);
    } else {
      throw new ApiError(400, `알 수 없는 action: ${action}`, 'BAD_REQUEST');
    }
    return send(res, 200, { ok: true, fetchedAt: new Date().toISOString(), ...body }, CACHE_OK);
  } catch (e) {
    const status = e instanceof ApiError ? e.status : 500;
    return send(res, status, { ok: false, code: e.code || 'ERROR', error: e.message || '알 수 없는 오류' });
  }
}

module.exports = handler;
module.exports._internal = { norm, flatText, formatArticle, mapSearchItem, lawLink, mstCache };
