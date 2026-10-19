// ==UserScript==
// @name         ① 诊断面板 (先装这个)
// @namespace    https://github.com/yuanlanyu/maoyan-ticket-helper
// @version      1.0
// @description  诊断用：这个绿色面板在任何网页都该出现。出现=扩展正常；不出现=扩展没生效
// @author       本地自用
// @match        *://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
 * 【这个脚本是干嘛的】
 *
 * 你装完 Userscripts 但猫眼页面上没看到抢票面板。
 * 有两种可能，这个脚本能把它们分开：
 *
 *   装完这个脚本后，随便打开一个网站（比如 baidu.com）：
 *     ✔ 出现绿色方块  →  扩展工作正常！问题在猫眼站的权限 → 去开猫眼站权限
 *     ✘ 什么都不出现  →  扩展根本没生效 → 回设置里重新开扩展
 *
 * 【怎么装】和主脚本完全一样：下载 → 移动进 Userscripts 文件夹 → 刷新页面
 * 下载地址：
 *   https://github.com/yuanlanyu/maoyan-ticket-helper/releases/latest/download/test-panel.user.js
 * 【装完记得删掉】，它只是用来诊断的。
 */

(function () {
  'use strict';
  if (window.__RK_TEST_PANEL__) return;
  window.__RK_TEST_PANEL__ = true;

  const host = location.hostname;
  const isMaoyan = /maoyan\.com$/.test(host);

  const d = document.createElement('div');
  d.style.cssText = [
    'position:fixed', 'left:8px', 'top:64px', 'z-index:2147483647',
    'background:' + (isMaoyan ? '#07c160' : '#1479ff'),
    'color:#fff', 'font:14px/1.6 -apple-system,"PingFang SC",sans-serif',
    'padding:13px 15px', 'border-radius:11px', 'max-width:80vw',
    'box-shadow:0 4px 18px rgba(0,0,0,.45)', 'white-space:pre-wrap',
  ].join(';');

  d.textContent =
    '✅ Userscripts 扩展正常工作\n' +
    '当前网站: ' + host + '\n' +
    (isMaoyan
      ? '—— 这是猫眼站，主脚本也该生效了'
      : '—— 扩展没问题。说明问题在猫眼站的权限');

  (document.body || document.documentElement).appendChild(d);

  // 页面标题也加上标记，便于在标签页列表一眼看到
  try { if (!/^✅/.test(document.title)) document.title = '✅ ' + document.title; } catch (e) {}
})();