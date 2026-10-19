// ==UserScript==
// @name         猫眼演出 抢票助手 (iPhone / Safari · 实测版)
// @namespace    https://show.maoyan.com/
// @version      2.1
// @description  卡点抢票：详情页→票档→确认页全自动；「前方拥堵」自动刷新重试；到支付页停下等你手动付
// @author       本地自用
// @match        https://show.maoyan.com/*
// @match        https://passport.maoyan.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * ─────────── 使用说明（iPhone）───────────
 * 1. App Store 装「Userscripts」(免费开源, Safari 扩展)
 * 2. 设置 > Safari > 扩展 > Userscripts → 打开，"允许所有网站"
 * 3. 把本文件导入 Userscripts（见 README_猫眼iOS抢票.md）
 * 4. Safari 打开演出详情页 → 右下角出现绿色日志面板
 * 5. 改好下面 CFG → 到点自动开抢
 *
 * ⚠ 抢票流程会新开一个标签页（猫眼 _blank=true）。新标签页脚本同样生效。
 * ⚠ 最后一步「立即支付」默认不自动点（autoPay=false），由你自己确认付款。
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

  const CFG = {
    // 开抢时间 'HH:MM:SS'（本地时区），如 '19:30:00'。留空 = 打开页面就开始
    startAt: '',

    // 票档偏好：按票价选。填 258 = 抢 258 元档；留空 = 选第一个有货的
    priceWanted: '',

    // 购买数量（1 张最稳，抢到再说）
    qty: 1,

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

  // ══════════ 日志面板 ══════════
  const P = document.createElement('div');
  P.style.cssText = [
    'position:fixed', 'right:8px', 'bottom:80px', 'z-index:2147483647',
    'width:200px', 'max-height:38vh', 'overflow:auto',
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
    // 底部 .buttom-block 里的 .button
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
  const deadline = Date.now() + CFG.maxMinutes * 60 * 1000;
  let started = false;

  async function run() {
    if (started) return;
    started = true;
    log('抢票助手启动 v2.1 (间隔' + CFG.interval + 'ms' + (CFG.startAt ? ' / 卡点 ' + CFG.startAt : '') + ')');

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

  // 双击切换面板
  window.addEventListener('dblclick', () => { P.style.display = P.style.display === 'none' ? 'block' : 'none'; });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();