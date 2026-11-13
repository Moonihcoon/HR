/* 법제처 DRF 응답 목업 — 실제 응답 구조(2026-11-13 확인)를 본뜸 */
'use strict';
const LAWS = {
  근로기준법: { mst: '285279', id: '001872', eff: '20261008', pro: '20260407' },
  최저임금법: { mst: '218303', id: '001777', eff: '20200526', pro: '20200526' },
};
function searchBody(query) {
  const hits = Object.entries(LAWS).filter(([n]) => n.includes(query) || query.includes(n));
  const law = hits.map(([n, x], i) => ({ id: String(i + 1), 법령명한글: n, 법령일련번호: x.mst, 법령ID: x.id, 공포일자: x.pro, 시행일자: x.eff, 제개정구분명: '일부개정', 소관부처명: '고용노동부', 법령구분명: '법률', 현행연혁코드: '현행' }));
  return { LawSearch: { totalCnt: String(law.length), page: '1', law: law.length === 1 ? law[0] : law } };
}
function unit(no, br, title, body) {
  return { 조문번호: String(no), ...(br ? { 조문가지번호: String(br) } : {}), 조문여부: '조문', 조문제목: title, 조문시행일자: '20261008', 조문변경여부: 'N', ...body };
}
const ARTS = {
  '005600': [unit(56, 0, '연장ㆍ야간 및 휴일 근로', { 조문내용: '제56조(연장ㆍ야간 및 휴일 근로)', 항: [{ 항번호: '①', 항내용: '① 사용자는 연장근로에 대하여는 통상임금의 100분의 50 이상을 가산하여 근로자에게 지급하여야 한다.' }, { 항번호: '②', 항내용: '② 휴일근로에 대하여는 다음 각 호의 기준에 따른 금액 이상을 가산하여 지급하여야 한다.', 호: [{ 호번호: '1.', 호내용: '1. 8시간 이내의 휴일근로: 통상임금의 100분의 50' }, { 호번호: '2.', 호내용: '2. 8시간을 초과한 휴일근로: 통상임금의 100분의 100' }] }] })],
  '007602': [{ 조문번호: '76', 조문가지번호: '2', 조문여부: '전문', 조문내용: '제6장의2 직장 내 괴롭힘의 금지' }, unit(76, 2, '직장 내 괴롭힘의 금지', { 조문내용: '제76조의2(직장 내 괴롭힘의 금지) 사용자 또는 근로자는 직장에서의 지위 또는 관계 등의 우위를 이용하여 ...' })],
};
function serviceBody(mst, jo) {
  const name = Object.keys(LAWS).find((n) => LAWS[n].mst === mst);
  if (!name) return { Law: '일치하는 법령이 없습니다.' };
  const x = LAWS[name];
  let units;
  if (jo) units = ARTS[jo] || [unit(Number(jo.slice(0, 4)), Number(jo.slice(4)), '목업 조문', { 조문내용: `제${Number(jo.slice(0, 4))}조(목업) 내용`, 항: { 항번호: '①', 항내용: '① 단일 항 객체 형태' } })];
  else units = [{ 조문번호: '1', 조문여부: '전문', 조문내용: '제1장 총칙' }, unit(1, 0, '목적', { 조문내용: '제1조(목적) 이 법은 ...' }), ...ARTS['005600'], ...ARTS['007602']];
  return { 법령: { 기본정보: { 법령명_한글: name, 법령ID: x.id, 공포일자: x.pro, 시행일자: x.eff, 제개정구분: '일부개정', 소관부처: { content: '고용노동부' } }, 조문: { 조문단위: units.length === 1 ? units[0] : units } } };
}
function install() {
  global.fetch = async (url) => {
    const u = new URL(url);
    const oc = u.searchParams.get('OC');
    let body;
    if (oc === 'bad') body = { result: '사용자 정보 검증에 실패하였습니다.', msg: 'OC 확인' };
    else if (u.pathname.endsWith('lawSearch.do')) body = searchBody(u.searchParams.get('query') || '');
    else body = serviceBody(u.searchParams.get('MST'), u.searchParams.get('JO'));
    const text = JSON.stringify(body);
    return { ok: true, status: 200, text: async () => text };
  };
}
module.exports = { install };
