/* QA 테스트: 데이터 무결성 · API 핸들러 · 계산기 */
'use strict';
const assert = require('assert');
const path = require('path');
let pass = 0; let fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass += 1; console.log(`  ✓ ${name}`); } catch (e) { fail += 1; console.log(`  ✗ ${name}\n    ${e.message}`); }
};

(async () => {
  global.window = {};
  require(path.join(__dirname, '../assets/data.js'));
  const D = window.HR_DATA;
  const C = require(path.join(__dirname, '../assets/calc.js'));

  console.log('\n[1] 데이터 무결성');
  const refRe = /^[^|]+\|\d+(-\d+)?$/;
  const allRefs = [];
  await t('모든 항목에 필수 필드·처벌규정 존재', () => {
    const ids = new Set();
    for (const it of D.ITEMS) {
      assert(it.id && !ids.has(it.id), `중복/누락 id: ${it.id}`); ids.add(it.id);
      assert(D.CATEGORIES.some((c) => c.id === it.cat), `${it.id}: 잘못된 cat`);
      assert(it.title && it.summary.length >= 1 && it.refs.length >= 1, `${it.id}: 필드 누락`);
      assert(it.penalty && it.penalty.text && it.penalty.refs.length >= 1, `${it.id}: 처벌규정 누락`);
      assert(['crime', 'fine', 'civil', 'none'].includes(it.penalty.type), `${it.id}: penalty.type`);
      assert([true, false, null].includes(it.under5), `${it.id}: under5`);
      assert(/^\d{4}-\d{2}-\d{2}$/.test(it.updated), `${it.id}: updated 형식`);
      allRefs.push(...it.refs, ...it.penalty.refs);
    }
  });
  await t('모든 조문 참조 형식·법령키 유효', () => {
    D.DEADLINES.forEach((d) => allRefs.push(d.ref));
    D.CHANGES.forEach((c) => { if (c.ref) allRefs.push(c.ref); assert(D.LAWS[c.law], `CHANGES law ${c.law}`); });
    for (const r of allRefs) { assert(refRe.test(r), `형식 오류 ${r}`); assert(D.LAWS[r.split('|')[0]], `법령키 없음 ${r}`); }
  });
  await t('개정 일정 시행일 순 정렬·날짜 형식', () => {
    for (let i = 1; i < D.CHANGES.length; i += 1) assert(D.CHANGES[i - 1].date <= D.CHANGES[i].date, `순서 ${D.CHANGES[i].date}`);
  });
  await t('법정기한 스펙 유효', () => { for (const d of D.DEADLINES) assert(d.days || d.months || d.years, d.title); });
  await t('검증된 처벌규정 반영(2026.10.8 임금체불 5년/5천, 퇴직금 제43조)', () => {
    const wage = D.ITEMS.find((i) => i.id === 'wage-payment');
    assert(/5년 이하 징역 또는 5천만원/.test(wage.penalty.text) && wage.penalty.refs.includes('근기|107'));
    const sev = D.ITEMS.find((i) => i.id === 'severance');
    assert(sev.penalty.refs.includes('퇴직|43') && /5년/.test(sev.penalty.text));
    assert(!allRefs.includes('근기|109') || D.ITEMS.find((i) => i.id === 'bullying').penalty.refs.includes('근기|109'));
  });

  console.log('\n[2] 계산기');
  await t('연차: 1년 미만 월 1일, 최대 11일', () => {
    assert.strictEqual(C.annualLeave('2026-01-01', '2026-06-15').days, 5);
    assert.strictEqual(C.annualLeave('2025-11-14', '2026-11-13').days, 11);
  });
  await t('연차: 1년 15일 / 3년 16일 / 21년 이상 25일', () => {
    assert.strictEqual(C.annualLeave('2025-11-13', '2026-11-13').days, 15);
    assert.strictEqual(C.annualLeave('2023-11-13', '2026-11-13').days, 16);
    assert.strictEqual(C.annualLeave('2004-01-01', '2026-11-13').days, 25);
  });
  await t('연차: 말일 입사 개월 계산(1/31 → 2/28은 1개월)', () => {
    assert.strictEqual(C.completedMonths(C.toDate('2026-01-31'), C.toDate('2026-02-28')), 1);
    assert.strictEqual(C.completedMonths(C.toDate('2026-01-31'), C.toDate('2026-02-27')), 0);
  });
  await t('연차: 잘못된 입력 처리', () => { assert(C.annualLeave('', '2026-01-01').error); assert(C.annualLeave('2026-05-01', '2026-01-01').error); });
  await t('퇴직금: 5년 근속 예시값', () => {
    const r = C.severance({ hire: '2021-01-01', last: '2025-12-31', wage3m: 9000000, bonusYear: 0, leavePayYear: 0 });
    assert.strictEqual(r.retireDate, '2026-01-01');
    assert.strictEqual(r.serviceDays, 1826);
    assert.strictEqual(r.days3, 92); // 10/1~12/31
    const expect = Math.floor(9000000 / 92 * 30 * 1826 / 365);
    assert.strictEqual(r.amount, expect);
    assert.strictEqual(r.dueDate, '2026-01-15');
  });
  await t('퇴직금: 1년 미만·주15시간 미만 미지급', () => {
    assert.strictEqual(C.severance({ hire: '2026-01-01', last: '2026-11-30', wage3m: 9e6 }).eligible, false);
    assert.strictEqual(C.severance({ hire: '2020-01-01', last: '2026-11-30', wage3m: 9e6, weeklyHours: 14 }).eligible, false);
    assert.strictEqual(C.severance({ hire: '2025-01-01', last: '2025-12-31', wage3m: 9e6 }).eligible, true);
  });
  await t('주휴수당: 40h→8h, 20h→4h, 14h→0, 52h→8h 상한', () => {
    assert.strictEqual(C.weeklyHoliday(40, 10700).amount, 85600);
    assert.strictEqual(C.weeklyHoliday(20, 10700).amount, 42800);
    assert.strictEqual(C.weeklyHoliday(14, 10700).amount, 0);
    assert.strictEqual(C.weeklyHoliday(52, 10000).hours, 8);
  });
  await t('최저임금: 2027년 209h 필요 월급 2,236,300원', () => {
    const r = C.minWageCheck(2236300, 209, 10700); assert.strictEqual(r.required, 2236300); assert(r.ok);
    assert.strictEqual(C.minWageCheck(2156880, 209, 10320).ok, true);
    assert.strictEqual(C.minWageCheck(2100000, 209, 10320).ok, false);
  });
  await t('가산수당: 5인 이상/미만', () => {
    const a = C.overtimePay({ hourly: 10000, ext: 10, night: 2, hol8: 8, holOver: 2 });
    assert.strictEqual(a.total, 150000 + 10000 + 120000 + 40000);
    const b = C.overtimePay({ hourly: 10000, ext: 10, night: 2, hol8: 8, holOver: 2, under5: true });
    assert.strictEqual(b.total, 100000 + 0 + 80000 + 20000);
  });
  await t('해고예고수당 / 기한 계산', () => {
    assert.strictEqual(C.noticePay(10700, 8).amount, 2568000);
    assert.strictEqual(C.deadline('2026-11-13', { days: 14 }), '2026-11-27');
    assert.strictEqual(C.deadline('2026-12-31', { days: -30 }), '2026-12-01');
    assert.strictEqual(C.deadline('2026-11-30', { months: 3 }), '2027-02-28');
    assert.strictEqual(C.deadline('2024-02-29', { years: 1 }), '2025-02-28');
  });

  console.log('\n[3] API 핸들러 (법제처 응답 목업)');
  require('./mock-drf').install();
  const handler = require('../api/law');
  const call = (query) => new Promise((resolve) => {
    const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { resolve({ status: this.statusCode, headers: this.headers, body: JSON.parse(b) }); } };
    handler({ method: 'GET', query }, res);
  });
  await t('status', async () => { const r = await call({ action: 'status' }); assert.strictEqual(r.status, 200); assert(r.body.ok); });
  await t('article: 근로기준법 제56조 (항·호 구조)', async () => {
    const r = await call({ action: 'article', law: '근로기준법', jo: '56' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.article.label, '제56조');
    assert(r.body.article.lines.some((l) => l.level === 2 && /8시간 이내/.test(l.text)));
    assert(/s-maxage=43200/.test(r.headers['cache-control']));
    assert(/law\.go\.kr/.test(r.body.link));
  });
  await t('article: 가지조문 제76조의2 (전문 단위 제외)', async () => {
    const r = await call({ action: 'article', law: '근로기준법', jo: '76', br: '2' });
    assert.strictEqual(r.body.article.label, '제76조의2');
    assert.strictEqual(r.body.article.title, '직장 내 괴롭힘의 금지');
  });
  await t('article: 단일 조문/단일 항 객체 응답 처리', async () => {
    const r = await call({ action: 'article', law: '최저임금법', jo: '28' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert(r.body.article.lines.some((l) => /단일 항/.test(l.text)));
  });
  await t('full: 전문 + 장 구분', async () => {
    const r = await call({ action: 'full', law: '근로기준법' });
    assert(r.body.articles.some((a) => a.chapter) && r.body.articles.some((a) => a.label === '제76조의2'));
    assert.strictEqual(r.body.law.effective, '20261008');
  });
  await t('info: 일부 실패 허용', async () => {
    const r = await call({ action: 'info', laws: '근로기준법,없는법률' });
    assert.strictEqual(r.body.laws[0].ok, true); assert.strictEqual(r.body.laws[1].ok, false);
  });
  await t('search: 단일 결과 객체 → 배열 정규화', async () => {
    const r = await call({ action: 'search', query: '최저임금법' });
    assert.strictEqual(r.body.items.length, 1); assert.strictEqual(r.body.items[0].mst, '218303');
  });
  await t('오류: 잘못된 파라미터/없는 법령/인증 실패/알 수 없는 action', async () => {
    assert.strictEqual((await call({ action: 'article', law: '근로기준법', jo: 'abc' })).status, 400);
    assert.strictEqual((await call({ action: 'article', law: '가나다법', jo: '1' })).status, 404);
    const bad = await call({ action: 'search', query: '근로기준법', oc: 'bad' });
    assert.strictEqual(bad.status, 401); assert.strictEqual(bad.headers['cache-control'], 'no-store');
    assert.strictEqual((await call({ action: 'nope' })).status, 400);
    assert.strictEqual((await call({ action: 'search', query: '' })).status, 400);
  });
  await t('보안: oc 파라미터 형식 검증(주입 차단)', async () => {
    let seen;
    const prev = global.fetch;
    global.fetch = async (u) => { seen = new URL(u).searchParams.get('OC'); return prev(u); };
    await call({ action: 'search', query: '근로기준법', oc: 'x&target=evil' });
    global.fetch = prev;
    assert.strictEqual(seen, 'gasil1980');
  });

  console.log(`\n결과: ${pass} 통과, ${fail} 실패\n`);
  process.exit(fail ? 1 : 0);
})();
