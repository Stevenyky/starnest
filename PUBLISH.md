# 公网发布记录

## 当前可用地址

手机热点下已建立可用的 Cloudflare Quick Tunnel：

```
https://useful-discount-breaks-cornwall.trycloudflare.com/
```

这是 **临时公网地址**，指向本机的 `http://127.0.0.1:8765/`。已实际验证：首页、开放岗位（31 个）、公司手册、巢盾安全、入职页和空工位都能从公网打开。

同一热点下也可用局域网地址：

```
http://192.168.43.19:8766/
```

`trycloudflare.com` 地址在隧道进程重启后会变化；电脑休眠、断网或关闭终端都会失效。当前热点网络比校园网稳定，但仍没有 uptime 保证。

## 本机需要同时运行两件事

### 1. 星巢静态服务器

公网隧道指向 `8765`：

```powershell
python serve.py 8765
```

如果还要在同一热点分享，另开一个终端：

```powershell
python serve.py 8766 --lan
```

### 2. 公网隧道

本次下载的 cloudflared 位于当前用户的临时目录，直接运行：

```powershell
$cf="$env:TEMP\starnest-cloudflared\cloudflared-windows-amd64.exe"
& $cf tunnel --url http://127.0.0.1:8765 --protocol http2 --retries 10 --no-autoupdate
```

必须加 `--protocol http2`：当前网络对 Cloudflare 的 QUIC（UDP 7844）连接会失败，但 TCP/HTTP2 可以通过。隧道启动后，终端会打印本次的 `trycloudflare.com` 地址；地址只对本次进程有效。

如果临时目录已清理，用 `winget install Cloudflare.cloudflared` 安装后把命令里的 `$cf` 换成 `cloudflared`。

## 验证

```powershell
curl.exe -I http://127.0.0.1:8765/
curl.exe -I http://192.168.43.19:8766/
curl.exe -I https://useful-discount-breaks-cornwall.trycloudflare.com/
```

浏览器中至少检查：

1. 首页首屏出现星巢标题与“立即入职”。
2. `#/careers` 显示 31 个岗位。
3. `#/join` 能填写并进入第二步。
4. 入职后 `#/workspace` 出现数字工牌。
5. 刷新后工位仍在（数据只在本机浏览器 localStorage）。

## 临时地址的限制

- **不是长期托管**：电脑休眠、断网、关闭终端都会失效。
- **没有 uptime 保证**：当前手机热点比校园网稳定，但 Cloudflare 免费快速隧道仍可能断连；出现 530 时重开隧道会得到新地址。
- **国内网络可能较慢**：首次加载需要下载约 300 KB 文本资源；`serve.py` 已启用 gzip，实测公网 `app.js` 约 0.8 秒。
- **Cloudflare 免费快速隧道没有 SLA**：不保证在线率，不适合正式收集用户数据。
- **每个访客的数据独立**：没有中心账号或数据库，A 的工牌不会出现在 B 的浏览器里。

## 部署到 GitHub Pages

> 注意：GitHub 头像菜单里的 **Settings → Pages** 是账号级的 **Verified domains**，不是仓库发布设置。必须进入**仓库自己的 Settings → Pages**，路径是 `https://github.com/用户名/仓库名/settings/pages`。

GitHub Pages 适合这个项目：它是纯静态站点，不需要构建、不需要数据库。免费账号需要把仓库设为 **Public**。

### 方式 A：网页上传（不装 Git）

1. 登录 GitHub，点右上角 **+ → New repository**。
2. 仓库名例如 `starnest`，选择 **Public**，不要勾选初始化 README，点 **Create repository**。
3. 在空仓库页面点 **uploading an existing file**。
4. 把项目里的 `index.html`、`assets` 文件夹拖进去；再点 **Add file → Create new file**，文件名填 `.nojekyll`，内容留空，提交。
5. 打开仓库 **Settings → Pages**，在 **Build and deployment** 选择 **Deploy from a branch**，分支选 `main`，目录选 `/ (root)`，保存。
6. 等 1–2 分钟，访问：

```
https://你的用户名.github.io/starnest/
```

### 方式 B：GitHub Desktop

1. 安装 GitHub Desktop，登录账号。
2. **File → Add local repository**，选择 `D:\软件\onedrive\Desktop\项目\dp1`。
3. 如果提示不是仓库，选择 **create a repository**，然后 **Publish repository**，取消勾选 “Keep this code private”。
4. 发布后到 GitHub 仓库的 **Settings → Pages**，按上面的分支方式开启。

### 方式 C：Git 命令行

先在 GitHub 建空仓库，然后在本目录执行：

```powershell
git init
git add index.html assets .nojekyll
git commit -m "deploy STARNEST to GitHub Pages"
git branch -M main
git remote add origin https://github.com/你的用户名/starnest.git
git push -u origin main
```

再到仓库 **Settings → Pages** 选择 `main` / `/ (root)`。

### 这个项目为什么能直接放子路径

所有资源都使用相对路径（`assets/...`），路由使用 `#/careers` 这种 hash 路由，因此放在 `https://用户名.github.io/starnest/` 这种子目录下也能正常工作，不需要改代码或配置重写规则。

### GitHub Pages 的限制

- GitHub Pages 不能运行 `serve.py`，所以没有自定义 CSP 响应头、限速和 `X-Frame-Options`；页面里的 meta CSP 仍然生效，HTTPS 由 GitHub 提供。
- 仓库里的 `screens/`、`tools/`、`README.md` 不会被首页引用；如果只想发布站点，可以只上传 `index.html`、`assets/` 和 `.nojekyll`。
- 更新站点：重新上传/推送文件，Pages 会自动重新发布。
- 它仍然只是前端演示：每个访客的数据在自己的浏览器 localStorage，不会汇总到“公司后台”。

## 其他静态托管

项目是纯静态站点，不需要构建。把以下内容上传到任意静态托管即可：

```
index.html
assets/
```

可选托管：Cloudflare Pages、GitHub Pages、Netlify、Vercel、对象存储静态网站。

Hash 路由（`#/careers`、`#/join`）不需要服务器重写规则。正式环境请在托管平台配置：

- `Content-Security-Policy`（与 `serve.py` 中的 CSP 一致）
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy`
- `Cross-Origin-Opener-Policy` / `Cross-Origin-Resource-Policy`

如果需要真正的“公司看到所有员工”、账号体系、管理员后台或审计数据库，必须增加后端、认证、数据库、权限与隐私合规设计；当前项目明确不伪造这些能力。
