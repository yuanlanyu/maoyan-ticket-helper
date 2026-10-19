# 猫眼演出 抢票助手（iPhone / Safari）

油猴脚本（Userscripts 用）。**实测版 v2.1**：详情页 → 立即购票 → 选票档 → 确认页，
全程约 6 秒，停在支付页**不自动付款**（`autoPay` 默认 `false`）。

## 下载（iPhone 点这个链接）

**https://github.com/yuanlanyu/maoyan-ticket-helper/releases/latest/download/maoyan-ticket-helper.user.js**

Safari 会直接下载成文件 → 存到「文件」App → 移到 Userscripts 文件夹。

## 安装（不需要 aA 图标）

1. App Store 装 `Userscripts`（Justin Wasack），打开一次
2. 点上面下载链接 → 下载完成
3. 「文件」App → 我的 iPhone → 下载 → 长按刚下的文件 → 移动 → 选 Userscripts 文件夹
4. 设置 → Safari 浏览器 → 扩展 → Userscripts → 打开 + 允许
5. Safari 打开猫眼演出页 → 右下角绿色面板 = 成功

## 开抢前

编辑该文件，把 `startAt: ''` 改成开票时间（如 `'19:30:00'`）。
留空也行：到点手动打开页面，脚本立即开抢。

## 说明

只做基础反检测加固。不破解验证码，不绕实名限购。无任何脚本能保证成功率。
