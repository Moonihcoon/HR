/* 실무 계산기 — 순수 함수(브라우저·Node 공용) */
(function (root) {
  const DAY = 86400000;
  const toDate = (s) => {
    if (s instanceof Date) return new Date(Date.UTC(s.getFullYear(), s.getMonth(), s.getDate()));
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  };
  const fmtDate = (d) => (d ? d.toISOString().slice(0, 10) : '');
  const daysBetween = (a, b) => Math.round((b - a) / DAY);
  const addDays = (d, n) => new Date(d.getTime() + n * DAY);
  function addMonths(d, n) {
    const y = d.getUTCFullYear(); const m = d.getUTCMonth() + n; const day = d.getUTCDate();
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(day, last)));
  }
  // 기준일까지 채운 개월 수 / 연 수
  function completedMonths(from, to) {
    let n = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
    if (addMonths(from, n) > to) n -= 1;
    return Math.max(n, 0);
  }

  /** 연차유급휴가 (근기법 제60조) — 출근율 80% 이상 가정 */
  function annualLeave(hireStr, baseStr) {
    const hire = toDate(hireStr); const base = toDate(baseStr);
    if (!hire || !base) return { error: '날짜를 입력하세요.' };
    if (base < hire) return { error: '기준일이 입사일보다 빠릅니다.' };
    const months = completedMonths(hire, base);
    const years = Math.floor(months / 12);
    if (years < 1) {
      return { years, months, days: Math.min(months, 11), basis: '1년 미만: 1개월 개근 시 1일 (최대 11일)' };
    }
    const days = Math.min(15 + Math.floor((years - 1) / 2), 25);
    return { years, months, days, basis: `${years}년차 완료: 15일 + 가산 ${days - 15}일 (최대 25일)` };
  }

  /** 퇴직금 (퇴직급여법 제8조) */
  function severance({ hire, last, wage3m, bonusYear = 0, leavePayYear = 0, weeklyHours = 40 }) {
    const h = toDate(hire); const l = toDate(last);
    if (!h || !l) return { error: '입사일과 마지막 근무일을 입력하세요.' };
    if (l < h) return { error: '마지막 근무일이 입사일보다 빠릅니다.' };
    const retire = addDays(l, 1); // 퇴직일(지급사유 발생일) = 마지막 근무일 다음 날
    const serviceDays = daysBetween(h, retire);
    const from3 = addMonths(retire, -3);
    const days3 = daysBetween(from3, retire);
    const wages = Number(wage3m) || 0;
    const total3 = wages + (Number(bonusYear) || 0) * 3 / 12 + (Number(leavePayYear) || 0) * 3 / 12;
    const avgDaily = days3 > 0 ? total3 / days3 : 0;
    const eligible = serviceDays >= 365 && Number(weeklyHours) >= 15;
    const amount = eligible ? Math.floor(avgDaily * 30 * serviceDays / 365) : 0;
    return { retireDate: fmtDate(retire), serviceDays, days3, total3: Math.round(total3), avgDaily: Math.round(avgDaily * 100) / 100, eligible, amount,
      dueDate: fmtDate(addDays(retire, 14)) };
  }

  /** 주휴수당 (근기법 제55조, 시행령 제30조) */
  function weeklyHoliday(weeklyHours, hourly) {
    const h = Number(weeklyHours) || 0; const w = Number(hourly) || 0;
    if (h < 15) return { hours: 0, amount: 0, note: '1주 소정근로 15시간 미만은 주휴 미적용' };
    const hours = Math.min(h, 40) / 40 * 8;
    return { hours: Math.round(hours * 100) / 100, amount: Math.round(hours * w), note: '1주 소정근로일 개근 시' };
  }

  /** 최저임금 충족 여부 */
  function minWageCheck(monthlyPay, monthlyHours, minHourly) {
    const pay = Number(monthlyPay) || 0; const hrs = Number(monthlyHours) || 0; const min = Number(minHourly) || 0;
    if (!pay || !hrs) return { error: '월 급여와 월 소정근로시간을 입력하세요.' };
    const hourly = pay / hrs;
    const required = Math.ceil(min * hrs);
    return { hourly: Math.round(hourly * 100) / 100, required, ok: hourly >= min, shortfall: Math.max(required - pay, 0) };
  }

  /** 연장·야간·휴일 가산수당 (근기법 제56조) */
  function overtimePay({ hourly, ext = 0, night = 0, hol8 = 0, holOver = 0, under5 = false }) {
    const w = Number(hourly) || 0;
    const r = under5
      ? { ext: 1, night: 0, hol8: 1, holOver: 1 }
      : { ext: 1.5, night: 0.5, hol8: 1.5, holOver: 2 };
    const rows = [
      { key: 'ext', label: '연장근로', hours: +ext || 0, rate: r.ext },
      { key: 'night', label: '야간근로 가산(22~06시)', hours: +night || 0, rate: r.night },
      { key: 'hol8', label: '휴일근로(8시간 이내)', hours: +hol8 || 0, rate: r.hol8 },
      { key: 'holOver', label: '휴일근로(8시간 초과)', hours: +holOver || 0, rate: r.holOver },
    ].map((x) => ({ ...x, amount: Math.round(x.hours * w * x.rate) }));
    return { rows, total: rows.reduce((s, x) => s + x.amount, 0) };
  }

  /** 해고예고수당 (근기법 제26조) */
  function noticePay(hourly, dailyHours) {
    const amount = Math.round((Number(hourly) || 0) * (Number(dailyHours) || 0) * 30);
    return { amount };
  }

  /** 법정 기한 계산 (민법 초일불산입: 기준일 + n) */
  function deadline(baseStr, spec) {
    const b = toDate(baseStr);
    if (!b) return null;
    let d = b;
    if (spec.days) d = addDays(b, spec.days);
    else if (spec.months) d = addMonths(b, spec.months);
    else if (spec.years) d = addMonths(b, spec.years * 12);
    return fmtDate(d);
  }

  const api = { toDate, fmtDate, addDays, addMonths, daysBetween, completedMonths, annualLeave, severance, weeklyHoliday, minWageCheck, overtimePay, noticePay, deadline };
  root.HRCalc = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
