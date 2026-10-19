// ==UserScript==
// @name         猫眼演出 抢票助手 (iPhone / Safari · 可切换演出 · 手机内改设置)
// @namespace    https://show.maoyan.com/
// @version      2.2
// @description  卡点抢票：详情页→票档→确认页全自动；「前方拥堵」自动刷新重试；到支付页停下等你手动付。手机上点右下角⚙就能改票价/开抢时间/换演出，不需要脚本编辑器。
// @author       本地自用
// @match        https://show.maoyan.com/*
// @match        https://passport.maoyan.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * ─────────── 使用说明（iPhone）───────────
 * 1. App Store 装「Userscripts」(免费开源, Safari 扩展)
 * 2. 设置 > Safari > 扩展 > Userscripts → 打开，「允许所有网站」
 *    若用「个人资料」或「私密浏览」，记得在该处也把扩展打开
 * 3. 把本文件导入 Userscripts（见 README）
 * 4. Safari 打开任意演出详情页 → 右下角出现绿色日志面板 + ⚙ 按钮
 * 5. 点 ⚙ 改设置（票价 / 开抢时间 / 换演出 ID）→ 保存，下次打开照样生效
 *
 * ⚠ 抢票流程会新开标签页（猫眼 _blank=true）。新标签页脚本同样生效。
 * ⚠ 最后一步「立即支付」默认不自动点（autoPay=false），由你自己确认付款。
 * ⚠ 本脚本不绑定任何具体演出：@match 覆盖整个 show.maoyan.com，换演出直接换页面即可。
 * ─────────────────────────────────────
 *
 * 【实测 DOM 备忘】(2026-10, 猫眼 H5)
 *   详情页     : 点 .detail-normal-button 内「立即购票」
 *   票档页     : hash #/ticket-level ；票档行 .wrap-item（含¥）；缺货 .wrap-item.outOfStock
 *                场次行也是 .wrap-item，但文字是日期、不含 ¥  → 靠 ¥ 区分
 *                选完档后底部 .buttom-block .button = 「确认」
 *   确认页     : 路径 /qqw/confirm (独立页, 非 hash)
 *                观演人 .wrapper__item (选中态 .wrapper__item--selected)
 *                支付   button.primary-btn-md (父 .submit-right)
 */

(function () {
  'use strict';
  if (window.__MAOYAN_RK__) return;      // 防重复注入
  window.__MAOYAN_RK__ = true;

  const LS_KEY = 'maoyanRkCfg_v22';

  const DEFAULTS = {
    // 开抢时间 'HH:MM:SS'（本地时区），如 '19:30:00'。留空 = 打开页面就开始
    startAt: '',
    // 票档偏好：按票价选。填 258 = 抢 258 元档；留空 = 选第一个有货的
    priceWanted: '',
    // 重复尝试间隔（ms）。60~200 稳；太小会被风控
    interval: 150,
    // true = 自动点「立即支付」。默认 false，停在支付页让你自己付
    // ⚠ 有风险：开票瞬间可能误买错档/多买，建议保持 false
    autoPay: false,
    // 自动选观演人：true = 页面默认已选就沿用，没选则点第一个
    autoPickBuyer: true,
    // 最长尝试（分钟）
    maxMinutes: 15,
  };

  const CFG = Object.assign({}, DEFAULTS);
  function loadCfg() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) Object.assign(CFG, JSON.parse(raw));
    } catch (e) { /* 忽略 */ }
  }
  function saveCfg(patch) {
    Object.assign(CFG, patch);
    try { localStorage.setItem(LS_KEY, JSON.stringify(CFG)); } catch (e) { /* 忽略 */ }
  }
  loadCfg();

  // ══════════ 日志面板 ══════════
  const P = document.createElement('div');
  P.style.cssText = [
    'position:fixed', 'right:8px', 'bottom:84px', 'z-index:2147483646',
    'width:200px', 'max-height:34vh', 'overflow:auto',
    'background:rgba(0,0,0,.85)', 'color:#0f0', 'font:11px/1.5 monospace',
    'padding:8px', 'border-radius:8px', 'white-space:pre-wrap',
    'pointer-events:none', 'box-shadow:0 2px 10px rgba(0,0,0,.5)',
  ].join(';');
  (document.body || document.documentElement).appendChild(P);

  const log = (m) => {
    const t = new Date().toTimeString().slice(0, 8);
    P.textContent = `[${t}] ${m}\n` + P.textContent.slice(0, 1500);
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ══════════ ⚙ 设置按钮（可点） ══════════
  const G = document.createElement('div');
  G.id = '__rk_gear';
  G.textContent = '⚙';
  G.style.cssText = [
    'position:fixed', 'right:8px', 'bottom:40px', 'z-index:2147483647',
    'width:38px', 'height:38px', 'line-height:38px', 'text-align:center',
    'background:rgba(0,0,0,.85)', 'color:#0f0', 'font-size:19px',
    'border-radius:50%', 'box-shadow:0 2px 10px rgba(0,0,0,.5)',
    'pointer-events:auto', 'cursor:pointer', 'user-select:none',
  ].join(';');
  G.addEventListener('click', (e) => { e.stopPropagation(); openSettings(); });
  (document.body || document.documentElement).appendChild(G);
  // 清理多余实例（防重复注入留下多个按钮/面板）
  document.querySelectorAll('#__rk_gear').forEach((el, i) => { if (i > 0) el.remove(); });

  // ══════════ 设置面板 ══════════
  const IN = 'width:100%;box-sizing:border-box;padding:9px;border-radius:9px;border:1px solid #3a3a3c;background:#2c2c2e;color:#fff;font-size:15px;-webkit-appearance:none;margin:2px 0 10px';
  const LB = 'display:block;font-size:12px;color:#8e8e93;margin-top:4px';

  // 从当前 URL 里提取演出 ID（详情页 #/detail/492913 或票档页 #/ticket-level?id=495550）
  function currentProjectId() {
    const h = location.hash || '';
    const m = h.match(/detail\/(\d+)/) || h.match(/[?&]id=(\d+)/) || location.search.match(/[?&](?:projectId|id)=(\d+)/);
    return m ? m[1] : '';
  }

  function openSettings() {
    if (document.getElementById('__rk_set')) return;
    const w = document.createElement('div');
    w.id = '__rk_set';
    w.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.75);display:flex;align-items:center;justify-content:center;padding:14px;box-sizing:border-box;-webkit-overflow-scrolling:touch;overflow:auto';
    const curId = currentProjectId();

    w.innerHTML =
      '<div style="background:#1c1c1e;color:#fff;border-radius:16px;padding:16px;width:100%;max-width:380px;box-sizing:border-box;font:14px -apple-system,sans-serif;max-height:90vh;overflow:auto">' +
        '<div style="font-size:17px;font-weight:600;margin-bottom:14px">抢票助手设置</div>' +

        '<label style="' + LB + '">票价（元）· 空 = 有货就抢</label>' +
        '<input id="__rk_price" inputmode="numeric" placeholder="如 258，留空=第一个有货" style="' + IN + '" value="' + (CFG.priceWanted || '') + '">' +

        '<label style="' + LB + '">开抢时间 HH:MM:SS · 空 = 立即开始</label>' +
        '<input id="__rk_start" inputmode="numeric" placeholder="如 19:30:00" style="' + IN + '" value="' + (CFG.startAt || '') + '">' +

        '<label style="' + LB + '">尝试间隔（毫秒）60~200</label>' +
        '<input id="__rk_int" inputmode="numeric" style="' + IN + '" value="' + CFG.interval + '">' +

        '<label style="' + LB + '">换演出：粘贴演出 ID 或完整链接</label>' +
        '<input id="__rk_jump" placeholder="如 495550" style="' + IN + '" value="' + curId + '">' +

        '<label style="display:flex;align-items:center;justify-content:space-between;background:#2c2c2e;border-radius:9px;padding:11px;margin-bottom:8px">' +
          '<span>自动点「立即支付」</span>' +
          '<input id="__rk_pay" type="checkbox" style="width:22px;height:22px"' + (CFG.autoPay ? ' checked' : '') + '>' +
        '</label>' +
        '<div style="font-size:11px;color:#ff9f0a;margin:-4px 0 12px">⚠ 建议关着：停在支付页由你手动付，防止误买错档/多买</div>' +

        '<div style="display:flex;gap:8px;margin-top:4px">' +
          '<button id="__rk_save" style="flex:1;padding:12px;border:0;border-radius:10px;background:#0a84ff;color:#fff;font-size:15px;font-weight:600">保存</button>' +
          '<button id="__rk_go" style="flex:1;padding:12px;border:0;border-radius:10px;background:#30d158;color:#000;font-size:15px;font-weight:600">保存并前往</button>' +
        '</div>' +
        '<button id="__rk_close" style="width:100%;padding:11px;margin-top:8px;border:0;border-radius:10px;background:#3a3a3c;color:#fff;font-size:14px">关闭</button>' +
        '<div style="font-size:11px;color:#636366;margin-top:10px;line-height:1.6">设置按站点保存（每个浏览器「个人资料」各自独立）。<br>开抢时间改完需刷新页面才生效。</div>' +
      '</div>';
    document.body.appendChild(w);

    const $ = (id) => document.getElementById(id);
    const readForm = () => {
      const price = ($('__rk_price').value || '').trim().replace(/[^\d]/g, '');
      const start = ($('__rk_start').value || '').trim();
      const itv = parseInt(($('__rk_int').value || '').replace(/[^\d]/g, ''), 10);
      return {
        priceWanted: price,
        startAt: /^\d{1,2}:\d{2}(:\d{2})?$/.test(start) ? (start.split(':').length === 2 ? start + ':00' : start) : '',
        interval: (itv >= 60 && itv <= 2000) ? itv : DEFAULTS.interval,
        autoPay: !!$('__rk_pay').checked,
      };
    };
    const doJump = () => {
      const v = ($('__rk_jump').value || '').trim();
      if (!v) return;
      const m = v.match(/(\d{5,})/);
      if (!m) { log('⚠ 链接里没找到演出 ID'); return; }
      location.href = 'https://show.maoyan.com/qqw#/detail/' + m[1];
    };

    $('__rk_save').addEventListener('click', () => {
      const c = readForm();
      saveCfg(c);
      log('⚙ 已保存: 票价' + (c.priceWanted || '任意') + ' / ' + (c.startAt ? '卡点' + c.startAt : '立即') + ' / ' + c.interval + 'ms / 自动付' + (c.autoPay ? '开' : '关'));
      w.remove();
      if (c.startAt) log('ℹ 开抢时间已存，刷新页面后生效');
    });
    $('__rk_go').addEventListener('click', () => { saveCfg(readForm()); doJump(); });
    $('__rk_close').addEventListener('click', () => w.remove());
    w.addEventListener('click', (e) => { if (e.target === w) w.remove(); });
  }

  // ══════════ 通用点击 ══════════
  function clickEl(el) {
    try {
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) => {
        const ev = t.startsWith('pointer')
          ? new PointerEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, isPrimary: true })
          : new MouseEvent(t, { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window });
        el.dispatchEvent(ev);
      });
      return true;
    } catch (e) { log('点击异常: ' + e.message); return false; }
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  }

  // 按文字找元素（取最内层）
  function findByText(re) {
    const out = [];
    for (const el of document.querySelectorAll('div,span,button,a,li')) {
      if (el.children.length > 2) continue;
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 24) continue;
      const hit = re instanceof RegExp ? re.test(t) : t === re;
      if (!hit || !visible(el)) continue;
      out.push(el);
    }
    out.sort((a, b) => a.querySelectorAll('*').length - b.querySelectorAll('*').length);
    return out;
  }

  // ══════════ 各步骤 ══════════

  // ① 详情页 → 进购票
  const BUY_RX = /^(立即购票|去抢票|立即预订|立即购买|选座购票|马上抢|去预约)$/;
  function stepEnterBuy() {
    const c = findByText(BUY_RX);
    if (c.length) { log('→ 点「' + c[0].innerText.trim() + '」'); clickEl(c[0]); return true; }
    // 兜底：详情页底部按钮
    const fb = document.querySelector('.detail-normal-button');
    if (fb && /购票|抢票|预约|购买/.test(fb.innerText || '')) {
      log('→ 点(兜底)「' + fb.innerText.trim() + '」'); clickEl(fb); return true;
    }
    return false;
  }

  // ② 拥堵自愈
  function stepCongestion() {
    const c = findByText(/^(刷新|刷新重试|重新加载|重试|知道了|确定)$/);
    if (c.length) { log('⚠ 拥堵 → 点「' + c[0].innerText.trim() + '」'); clickEl(c[0]); return true; }
    const body = document.body ? document.body.innerText : '';
    if (/前方拥堵|请刷新重试|系统繁忙|网络异常|稍后重试/.test(body)) {
      log('⚠ 拥堵文案 → 刷新页面'); location.reload(); return true;
    }
    return false;
  }

  // ③ 票档页：选票档（.wrap-item，含¥，排除 outOfStock）
  function stepPickPrice() {
    if (!/ticket-level/.test(location.hash) && !document.querySelector('.wrap-item')) return false;
    // 必须含 ¥ 才是票档 —— 场次行是 "2026-10-25 周日 19:30"，只有数字没有 ¥
    const items = [...document.querySelectorAll('.wrap-item')]
      .filter((el) => /[¥￥]/.test(el.innerText || ''))
      .filter((el) => !/outOfStock|disabled|soldout/i.test((el.className || '').toString()))
      .filter(visible);
    if (!items.length) return false;

    let target = items[0];
    if (CFG.priceWanted) {
      const want = String(CFG.priceWanted);
      const hit = items.find((el) => (el.innerText || '').includes(want));
      if (!hit) { if (!window.__rkWarned) { window.__rkWarned = 1; log('⚠ 没有 ' + want + ' 元档，改选有货的'); } }
      else target = hit;
    }
    if (target.dataset.rkPicked) return true;
    target.dataset.rkPicked = '1';
    log('→ 选票档: ' + (target.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 26));
    clickEl(target);
    return true;
  }

  // ④ 票档页：点「确认」进确认页
  function stepTicketConfirm() {
    const btn = document.querySelector('.buttom-block .button');
    if (btn && visible(btn) && /确认|确定/.test(btn.innerText || '')) {
      if (btn.dataset.rkDone) return true;
      btn.dataset.rkDone = '1';
      log('→ 点「' + btn.innerText.trim() + '」');
      clickEl(btn);
      return true;
    }
    return false;
  }

  // ⑤ 确认页：选观演人
  function stepPickBuyer() {
    if (!CFG.autoPickBuyer) return false;
    const items = [...document.querySelectorAll('.wrapper__item')].filter(visible);
    if (!items.length) return false;
    const selected = items.filter((el) => /selected/.test((el.className || '').toString()));
    if (selected.length) return true;                 // 已默认选中，不动
    log('→ 选观演人: ' + (items[0].innerText || '').replace(/\s+/g, ' ').trim().slice(0, 20));
    clickEl(items[0]);
    return true;
  }

  // ⑥ 确认页：支付
  function stepPay() {
    const btn = document.querySelector('.submit-right button, button.primary-btn-md');
    if (!btn || !visible(btn)) return false;
    if (!CFG.autoPay) {
      if (!window.__rkTold) { window.__rkTold = 1; log('✅ 已到支付页 —— 请手动点「立即支付」付款'); }
      return 'manual';
    }
    if (btn.dataset.rkPaid) return true;
    btn.dataset.rkPaid = '1';
    log('→ 提交支付');
    clickEl(btn);
    return true;
  }

  // ══════════ 主循环 ══════════
  let started = false;

  async function run() {
    if (started) return;
    started = true;
    const deadline = Date.now() + CFG.maxMinutes * 60 * 1000;
    log('抢票助手 v2.2 启动 (间隔' + CFG.interval + 'ms' + (CFG.startAt ? ' / 卡点 ' + CFG.startAt : ' / 立即') + (CFG.priceWanted ? ' / ' + CFG.priceWanted + '元' : '') + ')');

    // 卡点
    if (CFG.startAt) {
      const [h, m, s] = CFG.startAt.split(':').map(Number);
      const t = new Date(); t.setHours(h, m, s || 0, 0);
      let wait = t.getTime() - Date.now();
      if (wait < -120000) wait = 0;                   // 已过点 2 分钟以上 → 直接开
      if (wait > 0) {
        log('等待开抢: ' + CFG.startAt);
        while (wait > 2000) { await sleep(Math.min(1500, wait - 2000)); wait = t.getTime() - Date.now(); }
        while (Date.now() < t.getTime()) { /* 自旋抢精度 */ }
        log('★ 开抢！');
      }
    }

    while (Date.now() < deadline) {
      try {
        if (stepCongestion()) { await sleep(CFG.interval * 3); continue; }
        if (stepPay() === 'manual') return;
        stepPickBuyer();
        if (!stepTicketConfirm()) {
          stepPickPrice();
          stepEnterBuy();
        }
      } catch (e) { log('异常: ' + e.message); }
      await sleep(CFG.interval);
    }
    log('⏹ 超时停止');
  }

  // SPA 路由变化提示
  let last = location.href;
  setInterval(() => {
    if (location.href !== last) { last = location.href; log('路由: ' + (location.hash || location.pathname)); }
  }, 400);

  // 双击面板切换显示
  window.addEventListener('dblclick', () => { P.style.display = P.style.display === 'none' ? 'block' : 'none'; });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();