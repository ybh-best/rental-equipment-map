/* ============================================================
 * 每日访问密码（访问者页 / 管理员页共用）
 * 规则：6 位数字 = FNV-1a(密钥 + 当天日期YYYYMMDD)，每天自动轮换。
 * 说明：纯静态网站无法做真正鉴权——此密码只挡住普通访客，
 *       技术人员若知道 data/result.json 的直链仍可看到数据。
 * ============================================================ */
(function (w) {
  const SALT = 'hb-rental:2026:z7Q2';

  function ymd(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  }

  function codeOf(day) {
    const raw = SALT + '#' + day;
    let h = 0x811c9dc5;
    for (let i = 0; i < raw.length; i++) {
      h ^= raw.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return String((h >>> 0) % 1000000).padStart(6, '0');
  }

  w.RentalAccess = {
    codeOf,
    ymd,
    today: () => codeOf(ymd(new Date())),
    AUTH_KEY: 'rental_view_access_v1',
  };
})(window);
