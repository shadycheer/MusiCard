# MusiCard

> 链接人类的，我希望不是链接。

<!-- 把你最得意的一张生成图贴这里。建议尺寸 1920px，或者两张卡（Spotify + Apple Music）拼一张。 -->
![Hero](https://placehold.co/1280x640?text=Drop+a+screenshot+here)

把 Spotify / Apple Music 单曲变成一张能直接发出去的图 — 国内聊天软件里分享一首歌，不再只是丢一串 URL 这么生硬。

[**▶ 在线体验**](https://musi-card-two.vercel.app) &nbsp;·&nbsp; 自托管见 [部署](#自己部署)

---

## 为什么做这个

在国内分享歌曲是一件特别尴尬的事：

- **Spotify 链接发到微信，是一条赤裸裸的 URL** — 别人不会点
- **Apple Music 自带的分享卡，国内看不到封面图** — Apple 自己的 CDN 在国内并不稳定
- 即便对方愿意打开，也得经历 *跳转 → 加载 → 等待* —— 这中间已经失去了大部分兴趣

MusiCard 把"分享一首歌"压缩成**一张图**：聊天里一眼就能看到歌名、艺人、封面、你想突出的几句歌词、还有扫码直达的二维码。**不需要别人下载任何 app，不需要点开任何链接。**

---

## 长这样

<!-- 三张图横排：Spotify 卡 / Apple Music 卡 / 编辑界面 -->
<table>
  <tr>
    <td><img src="https://placehold.co/400x600?text=Spotify+Card" alt="Spotify Card"/></td>
    <td><img src="https://placehold.co/400x600?text=Apple+Music+Card" alt="Apple Music Card"/></td>
    <td><img src="https://placehold.co/400x600?text=Lyrics+Picker" alt="Editor"/></td>
  </tr>
</table>

每个平台有**完全不同的视觉语言**：

- **Spotify 卡**：纯黑底 + Manrope 字体 + 绿色 accent 条 + 官方 lockup logo，致敬 Spotify 自家的 Now Playing 美学
- **Apple Music 卡**：从封面提取主色生成径向渐变背景 + Inter 字体 + Spatial Lyrics 风格的歌词聚焦 fade + 官方 wordmark

---

## 怎么用

1. 打开 [musi-card-two.vercel.app](https://musi-card-two.vercel.app)
2. 把 Spotify 或 Apple Music 的单曲链接粘进输入框
3. 卡片自动生成，从自动获取的歌词里**最多选 4 句**（找不到的话可以手动粘）
4. 点 **下载图片** → 1920px 高清 PNG 落地，直接转发到聊天群、朋友圈、Twitter

支持的链接格式：

```
https://open.spotify.com/track/<id>
https://open.spotify.com/intl-zh/track/<id>?si=...
https://music.apple.com/cn/album/<slug>/<album-id>?i=<track-id>
https://music.apple.com/us/song/<slug>/<id>
```

---

## 特性

- 🎨 **平台原生设计** — 不做"通用模板换个色"，每个平台是独立的视觉系统
- 🌏 **国内访问无障碍** — 封面图全部走自家服务端代理，不依赖 Spotify CDN（国内屏蔽）
- 📦 **像素级 1920px PNG** — Canvas 手画，跟浏览器预览完全一致（不是 html2canvas 那种妥协方案）
- 🔤 **字体自托管** — Manrope + Inter 通过 `next/font` 编译时下载到本地，Windows / Linux 也能看到完整字体
- 🎤 **自动歌词** — 从 [LRCLIB](https://lrclib.net) 自动获取，找不到收录的可以手动粘贴
- 💾 **三层缓存** — 浏览器 localStorage (7d TTL) → Neon Postgres → 上游 API，热门曲目秒出
- 📊 **轻量分析** — IP 哈希后做 PV / UV 统计，每首歌的命中次数自动累加

---

## 自己部署

### 你需要

- [Spotify Developer App](https://developer.spotify.com/dashboard)（取 `client_id` 和 `client_secret`）
- [Neon Postgres](https://neon.tech) 项目（免费 0.5GB 足够 10w MAU）
- 一台能跑 Node 的地方（推荐 [Vercel](https://vercel.com) 免费 tier）

### 三步走

```bash
# 1. 克隆 + 安装
git clone https://github.com/shadycheer/MusiCard.git
cd MusiCard
npm install

# 2. 配置环境变量
cp .env.local.example .env.local
# 填入 SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET / DATABASE_URL / IP_SALT

# 3. 跑迁移 + 启动
node scripts/migrate.mjs   # 在 Neon 里建表
npm run dev                 # http://localhost:3000
```

### 部署到 Vercel

把仓库 import 到 Vercel，在 Settings → Environment Variables 里把上面四个变量贴进去，点 Deploy。完事。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端框架 | Next.js 16 (App Router) + React 19 |
| 类型 | TypeScript 6 |
| 字体 | Manrope (Spotify 卡) + Inter (Apple Music 卡)，`next/font` 自托管 |
| 数据库 | Neon Serverless Postgres |
| 缓存 | Browser localStorage + Neon + Vercel edge CDN |
| 渲染 | Canvas 2D API（不用 html2canvas / dom-to-image，自己手画追求像素一致）|
| 色彩提取 | 自实现的 9-bit 量化分桶算法（用于 Apple Music 渐变背景）|

---

## 致谢

- [Spotify Web API](https://developer.spotify.com/documentation/web-api) — 曲目元数据
- [iTunes Lookup API](https://itunes.apple.com/lookup) — Apple Music 曲目元数据
- [LRCLIB](https://lrclib.net) — 开源歌词数据库
- Apple Music 和 Spotify 的官方 lockup SVG（用于品牌识别，所有商标归各自所有方）

## License

MIT
