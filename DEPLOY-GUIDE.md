# VOZEB PRO 本地构建与 Debian 12 部署指南

本文档供维护者和自动化 Agent 使用，覆盖以下固定拓扑：

1. 在 Windows + Docker Desktop 上从当前源码构建 Linux `amd64` 应用镜像。
2. 在本地准备固定版本的 PostgreSQL 运行镜像，并使用 `docker save` 把应用与 PostgreSQL 镜像一起导出，生成 SHA-256 校验文件后通过 SCP 上传。
3. 在 Debian 12 `amd64` 服务器上使用 Docker Compose 运行 PostgreSQL、App 和 Generation Worker。
4. Nginx 只代理宿主机的 `127.0.0.1:3000`，通过域名和 HTTPS 对外服务。
5. 后续更新先完整备份，再加载新镜像；数据库不兼容时不得只切换镜像。

> 本文命令分为“Windows PowerShell”和“Debian 服务器”两种环境。执行前先确认当前终端所在机器和目录。

> 本文是可执行操作手册，不等同于生产验收证明。项目当前仍把干净 Linux 服务器、正式域名 HTTPS、数据卷重启恢复和整库/媒体恢复演练列为待验收项；实际执行后必须保存第十六节的证据。

## 一、先理解镜像与数据的边界

本地构建的 VOZEB PRO 镜像包含：

- Next.js standalone 生产服务和静态资源。
- Generation Worker 脚本。
- FFmpeg、中文字体、PostgreSQL 客户端。
- Sharp 及对应 Linux amd64 原生运行库。
- 当前源码版本、变更记录和生产运行依赖。

镜像不包含 PostgreSQL 数据、媒体卷、生产 `.env` 或任何密钥。

`postgres:16.6-alpine` 是 Compose 使用的独立官方运行镜像，不是从本项目源码构建出来的。它需要在 Windows 构建机上获取一次，但会与本地构建的 VOZEB PRO 应用镜像一起写入交付 tar；按本文主流程部署时，Debian 服务器不再下载运行镜像。

| 内容 | 所在位置 | 替换应用镜像时是否保留 |
| --- | --- | --- |
| App 与 Worker 程序 | 不可变 Docker 镜像 | 使用新镜像替换 |
| 用户、设置、会话、任务、Canvas、短剧、订单 | PostgreSQL 数据卷 | 保留 |
| 本地图片、视频、音频和附件 | `vozeb-pro-data` 数据卷 | 保留 |
| 数据库密码、加密密钥和令牌 | 服务器 `.env` | 必须保留并限制权限 |
| Nginx 域名和证书 | Debian 宿主机 | 保留 |

标准 Compose 项目使用以下实际卷名：

```text
vozeb-pro_vozeb-pro-postgres
vozeb-pro_vozeb-pro-data
```

替换 App/Worker 容器不会主动清空这些卷，但“卷仍存在”不代表新旧数据库 Schema 一定兼容。每次升级必须先阅读 `CHANGELOG.md`、README 和版本说明。

项目明确规定：从 `0.0.2` 到 `0.0.6` 不支持沿用旧数据库或原地升级。其他版本也只有在对应版本说明允许时，才能执行本文的保留卷更新流程。

## 二、目录、变量与前置条件

### 2.1 Windows 本地环境

- Windows 10/11 与正常运行的 Docker Desktop。
- Docker Desktop 使用 Linux containers。
- Git、PowerShell 和可用的 `ssh`/`scp` 客户端。
- 当前项目目录示例：`F:\yaoaitest16\VOZEB-PRO`。
- 构建机与服务器均为 `amd64`；服务器核验结果应同时为 `amd64` 和 `x86_64`。

检查：

```powershell
docker version
docker buildx version
git status --short --branch
```

### 2.2 Debian 服务器

- Debian 12 `amd64`。
- 建议至少 2 核、4GB 内存和足够的镜像/媒体/备份磁盘空间。
- 域名已解析到服务器。
- 80/443 端口可被公网访问，Nginx 与 HTTPS 已准备好或可配置。
- 服务器能够访问模型、对象存储、SMTP、支付服务等实际业务上游。
- 部署目录固定为 `/root/mutangaigc/VOZEB-PRO`。

检查：

```bash
dpkg --print-architecture
uname -m
df -h
free -h
```

预期架构：

```text
amd64
x86_64
```

### 2.3 文档示例变量

以下值仅为示例，执行时替换为实际值：

```text
项目目录：F:\yaoaitest16\VOZEB-PRO
服务器 SSH 地址：root@203.0.113.10
生产域名：vozeb.example.com
部署目录：/root/mutangaigc/VOZEB-PRO
```

镜像标签由项目版本和 Git 短提交号生成，例如：

```text
vozeb-pro:v0.0.6-763fdd72203b
```

不要把示例标签当成实际构建结果。每次使用本次构建命令输出的 `$imageTag`。

## 三、Windows 本地构建 Linux amd64 镜像

### 3.1 核对源码

在 Windows PowerShell 执行：

```powershell
$projectRoot = 'F:\yaoaitest16\VOZEB-PRO'
Set-Location -LiteralPath $projectRoot

git status --short --branch
git log -1 --format='Commit=%H%nSubject=%s'
Get-Content -LiteralPath 'VERSION' -Raw -Encoding UTF8
```

构建前必须确认：

- 当前分支和提交就是计划发布的代码。
- `git status --short` 没有输出；如果存在计划发布的源码改动，应先完成审查、测试和提交，再构建可追溯镜像。
- `.env`、数据库、媒体、日志和备份没有加入 Git。

如果需要获取远端更新，应先审查更新内容、测试和数据库兼容性，再由维护者决定是否执行 `git pull`。Agent 不得未经授权直接合并远端更新。

### 3.2 生成不可变镜像标签

```powershell
$version = (Get-Content -LiteralPath 'VERSION' -Raw -Encoding UTF8).Trim()
$gitSha = (git rev-parse --short=12 HEAD).Trim()
$imageTag = "vozeb-pro:${version}-${gitSha}"
$imageTag
```

### 3.3 构建镜像

Dockerfile 默认使用 Debian 官方软件源。国内网络可以通过已经支持的构建参数使用阿里云 Debian 源：

```powershell
docker build `
  --platform linux/amd64 `
  --build-arg DEBIAN_MIRROR=http://mirrors.aliyun.com/debian `
  --build-arg DEBIAN_SECURITY_MIRROR=http://mirrors.aliyun.com/debian-security `
  --tag $imageTag `
  .
```

该构建会执行依赖锁定安装、TypeScript 类型检查、Next.js 生产构建和 Sharp 原生库加载检查。任一步失败都不能继续部署。

检查镜像：

```powershell
docker image inspect $imageTag `
  --format 'ID={{.Id}} Architecture={{.Architecture}} Created={{.Created}} Size={{.Size}}'
```

预期 `Architecture=amd64`。

### 3.4 在本机首次部署或冒烟验证

如果本机已经存在可用的 `.env` 和 Compose 数据卷，不要覆盖 `.env`，也不要修改现有 `COMPOSE_PROJECT_NAME`。第一次部署才复制模板：

```powershell
if (-not (Test-Path -LiteralPath '.env')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
```

Windows PowerShell 可用下面的函数生成 32 字节随机十六进制值。连续执行五次，并分别写入数据库密码、加密密钥、安装令牌、维护令牌和 Worker 令牌；五个值不得相同：

```powershell
function New-RandomHex32 {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

1..5 | ForEach-Object { New-RandomHex32 }
```

编辑本机 `.env`，至少设置：

```dotenv
COMPOSE_PROJECT_NAME=vozeb-pro-local
NEXT_PUBLIC_SITE_URL=http://localhost:3000
VOZEB_PRO_IMAGE=替换为本次构建输出的完整镜像标签
POSTGRES_PASSWORD=填写独立随机值
VOZEB_PRO_ENCRYPTION_KEY=填写独立随机值
VOZEB_PRO_INSTALL_TOKEN=填写独立随机值
VOZEB_PRO_MAINTENANCE_TOKEN=填写独立随机值
VOZEB_PRO_WORKER_TOKEN=填写独立随机值
VOZEB_PRO_TRUSTED_PROXY_HOPS=0
```

`VOZEB_PRO_IMAGE` 必须写入 `$imageTag` 实际输出，例如 `vozeb-pro:v0.0.6-763fdd72203b`，不能把 PowerShell 变量名 `$imageTag` 原样写进 `.env`。

准备 Compose 使用的 PostgreSQL `amd64` 镜像，然后启动。下载发生在本机，不发生在 Debian 服务器：

```powershell
$postgresImage = 'postgres:16.6-alpine'
docker pull --platform linux/amd64 $postgresImage
docker image inspect $postgresImage --format 'ID={{.Id}} Architecture={{.Architecture}}'
docker compose config --quiet
docker compose config --images | ForEach-Object {
  docker image inspect $_ --format 'Image={{.RepoTags}} ID={{.Id}} Architecture={{.Architecture}}'
}
docker compose up -d --pull never
docker compose ps
Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health/live' -UseBasicParsing
```

第一次运行时打开 `http://localhost:3000/install`，使用本机安装令牌初始化 Schema 并创建管理员。完成后再检查：

```powershell
Invoke-WebRequest -Uri 'http://127.0.0.1:3000/api/health/ready' -UseBasicParsing
docker compose logs --tail 100 app
docker compose logs --tail 100 generation-worker
```

本机停止服务可执行 `docker compose stop`；再次启动执行 `docker compose start`。不要为了停止服务执行带 `-v` 的命令。不要把本机 `.env` 上传到生产服务器，本机和生产环境必须使用不同的数据库密码、加密密钥和令牌。

## 四、导出镜像与部署文件

### 4.1 导出完整运行镜像包

仍在项目根目录执行：

```powershell
New-Item -ItemType Directory -Force -Path 'dist' | Out-Null

$postgresImage = 'postgres:16.6-alpine'
docker image inspect $imageTag --format 'App={{.Id}} Architecture={{.Architecture}}'
docker image inspect $postgresImage --format 'PostgreSQL={{.Id}} Architecture={{.Architecture}}'

$archive = "dist\vozeb-pro-bundle-${version}-${gitSha}-linux-amd64.tar"
$archiveName = Split-Path -Leaf $archive
docker save --output $archive $imageTag $postgresImage

$archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
"$archiveHash  $archiveName" | Set-Content -LiteralPath "$archive.sha256" -Encoding ascii
Get-Content -LiteralPath "$archive.sha256"
```

创建部署记录：

```powershell
$fullCommit = (git rev-parse HEAD).Trim()
$imageId = (docker image inspect $imageTag --format '{{.Id}}').Trim()

@"
VERSION=$version
GIT_COMMIT=$fullCommit
IMAGE_TAG=$imageTag
IMAGE_ID=$imageId
POSTGRES_IMAGE=$postgresImage
ARCHITECTURE=linux/amd64
"@ | Set-Content -LiteralPath 'dist\DEPLOYMENT-MANIFEST.txt' -Encoding ascii
```

这个 tar 包含两个运行镜像：本项目源码构建的 VOZEB PRO App/Worker 镜像，以及固定版本的 PostgreSQL 官方镜像。它不包含数据库内容和媒体数据。

`dist/` 是构建产物目录，不得提交 Git。上传并确认服务器可用后，可按保留策略移动到仓库外的归档目录或删除本地 tar；不要误删源码或服务器备份。

### 4.2 上传到 Debian

先在服务器创建权限受限的临时目录：

```powershell
$serverHost = '203.0.113.10'
ssh "root@$serverHost" 'install -d -m 700 /tmp/vozeb-deploy'
```

上传镜像和本次部署所需文件：

```powershell
scp `
  $archive `
  "$archive.sha256" `
  'dist\DEPLOYMENT-MANIFEST.txt' `
  'docker-compose.yml' `
  '.env.example' `
  'VERSION' `
  'CHANGELOG.md' `
  "root@${serverHost}:/tmp/vozeb-deploy/"
```

生产 `.env` 不参与上传。

## 五、Debian 12 安装 Docker Engine

如果服务器已经由 Docker 官方仓库安装 Docker Engine 和 Compose v2，可以跳到第六节。

以下命令以 `root` 用户为例。非 root 用户需要按实际权限添加 `sudo`。

先检查并移除冲突包。该命令不会自动删除 `/var/lib/docker` 中已有镜像、容器和卷，但已运行生产 Docker 的服务器不得在未评估影响时重新安装：

```bash
apt remove $(dpkg --get-selections docker.io docker-compose docker-doc docker-buildx podman-docker containerd runc | cut -f1)
```

添加 Docker 官方 Debian 仓库：

```bash
apt update
apt install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker
```

验证：

```bash
docker version
docker compose version
systemctl --no-pager --full status docker
```

Docker 官方文档：<https://docs.docker.com/engine/install/debian/>。

> Docker 发布端口可能绕过部分 ufw/firewalld 规则。本文的 App 端口在 Compose 中只绑定 `127.0.0.1:3000`，不要改成 `0.0.0.0:3000`。防火墙策略还应按 Docker 官方说明检查 `DOCKER-USER` 链。

## 六、Debian 首次部署

### 6.1 固定 Compose 项目名和部署目录

在 Debian 服务器执行：

```bash
install -d -m 750 /root/mutangaigc/VOZEB-PRO
install -d -m 700 /root/mutangaigc/VOZEB-PRO/backups
cp /tmp/vozeb-deploy/docker-compose.yml /root/mutangaigc/VOZEB-PRO/
cp /tmp/vozeb-deploy/.env.example /root/mutangaigc/VOZEB-PRO/
cp /tmp/vozeb-deploy/VERSION /root/mutangaigc/VOZEB-PRO/
cp /tmp/vozeb-deploy/CHANGELOG.md /root/mutangaigc/VOZEB-PRO/
cp /tmp/vozeb-deploy/DEPLOYMENT-MANIFEST.txt /root/mutangaigc/VOZEB-PRO/
cd /root/mutangaigc/VOZEB-PRO
```

生产环境在 `.env` 中设置：

```dotenv
COMPOSE_PROJECT_NAME=vozeb-pro
```

这样即使维护者从其他路径运行 Compose，数据卷前缀仍保持 `vozeb-pro_`。不要随意修改项目名或卷声明。

### 6.2 校验并加载镜像

进入上传目录：

```bash
cd /tmp/vozeb-deploy
ls -lh
cat DEPLOYMENT-MANIFEST.txt
```

从 `DEPLOYMENT-MANIFEST.txt` 读取本次真实 `IMAGE_TAG`，并确认 tar 和 `.sha256` 文件名。示例：

```bash
IMAGE_ARCHIVE='vozeb-pro-bundle-v0.0.6-763fdd72203b-linux-amd64.tar'
IMAGE_TAG='vozeb-pro:v0.0.6-763fdd72203b'
POSTGRES_IMAGE='postgres:16.6-alpine'

sha256sum -c "$IMAGE_ARCHIVE.sha256"
docker load --input "$IMAGE_ARCHIVE"
docker image inspect "$IMAGE_TAG" --format 'ID={{.Id}} Architecture={{.Architecture}} Created={{.Created}}'
docker image inspect "$POSTGRES_IMAGE" --format 'ID={{.Id}} Architecture={{.Architecture}} Created={{.Created}}'
```

必须看到校验成功，并且两个镜像都是 `Architecture=amd64`。如果实际文件名或应用标签不同，只修改对应变量，不要给应用镜像随意重新打模糊的 `latest` 标签。

### 6.3 创建生产 `.env`

```bash
cd /root/mutangaigc/VOZEB-PRO
umask 077
cp .env.example .env
chmod 600 .env
```

分别执行五次 `openssl rand -hex 32`，为以下字段生成五个互不相同的 64 位十六进制值：

```bash
openssl rand -hex 32
```

需要填写：

```dotenv
COMPOSE_PROJECT_NAME=vozeb-pro
NEXT_PUBLIC_SITE_URL=https://vozeb.example.com
VOZEB_PRO_IMAGE=vozeb-pro:v0.0.6-763fdd72203b

POSTGRES_DB=vozeb_pro
POSTGRES_USER=vozeb_pro
POSTGRES_PASSWORD=填写独立随机值

VOZEB_PRO_ENCRYPTION_KEY=填写独立随机值
VOZEB_PRO_INSTALL_TOKEN=填写独立随机值
VOZEB_PRO_MAINTENANCE_TOKEN=填写独立随机值
VOZEB_PRO_WORKER_TOKEN=填写独立随机值

VOZEB_PRO_TRUSTED_PROXY_HOPS=1
```

规则：

- `NEXT_PUBLIC_SITE_URL` 必须使用真实生产 HTTPS 域名。
- `VOZEB_PRO_IMAGE` 必须使用刚加载的完整不可变标签。
- `VOZEB_PRO_ENCRYPTION_KEY` 在安装后不得更换，否则已加密数据可能无法解密。
- 生产密钥不得与本地测试环境共用。
- 不要把密钥粘贴到聊天、Issue、Git、部署记录或普通日志。
- 当前 Compose 要求安装令牌存在；安装完成后继续以 `chmod 600` 的 `.env` 保存，除非后续版本明确改变该要求。

Agent 只能检查字段是否存在和长度是否合规，不得输出字段值。

### 6.4 验证配置并启动

```bash
cd /root/mutangaigc/VOZEB-PRO
docker compose config --quiet
docker compose config --images | while IFS= read -r image; do
  docker image inspect "$image" --format 'Image={{.RepoTags}} ID={{.Id}} Architecture={{.Architecture}}'
done
docker compose up -d --pull never
docker compose ps
```

`--pull never` 是本流程的交付门禁：若 tar 中漏了某个运行镜像，启动应直接失败，由维护者回到本地补齐镜像包，而不是让生产服务器静默下载。

预期服务：

```text
vozeb-pro-postgres            healthy
vozeb-pro                     healthy
vozeb-pro-generation-worker   running
```

检查本机存活接口：

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/api/health/live
```

预期响应包含：

```json
{"code":0,"data":{"status":"live"},"msg":"服务运行中"}
```

## 七、Nginx 反向代理与 HTTPS

如果现有 Nginx 已经管理域名和证书，只需要把站点的 `location /` 指向 `127.0.0.1:3000`。

示例配置：

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name vozeb.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_buffering off;
    }
}
```

将域名替换成真实域名，然后检查并平滑加载：

```bash
nginx -t
systemctl reload nginx
```

Nginx 代理模块文档：<https://nginx.org/en/docs/http/ngx_http_proxy_module.html>。

如果证书尚未配置，可根据实际系统和 Nginx 选择 Certbot 官方命令：<https://certbot.eff.org/instructions>。常规 HTTP 验证需要域名已解析到服务器，并且公网能访问 80 端口；不能开放 80 端口时应使用 DNS 验证。

典型证书申请命令为：

```bash
certbot --nginx -d vozeb.example.com
```

运行前必须先按 Certbot 官方当前说明安装 Certbot，并确保 `nginx -t` 通过。证书签发后再次检查：

```bash
nginx -t
systemctl reload nginx
curl --fail --silent --show-error https://vozeb.example.com/api/health/live
```

出现上传 `413 Request Entity Too Large` 时，应根据实际业务允许的最大上传体积设置 Nginx `client_max_body_size`，不要未经评估直接取消限制。

## 八、完成首次安装

浏览器打开：

```text
https://vozeb.example.com/install
```

按顺序执行：

1. 粘贴服务器 `.env` 中的 `VOZEB_PRO_INSTALL_TOKEN`。
2. 执行只读数据库连接检查。
3. 初始化当前版本 Schema。
4. 创建第一个管理员账号。
5. 登录后配置模型渠道、逻辑模型、套餐、邮件和存储。

安装完成后检查：

```bash
cd /root/mutangaigc/VOZEB-PRO
curl --fail --silent --show-error http://127.0.0.1:3000/api/health/live
curl --fail --silent --show-error http://127.0.0.1:3000/api/health/ready
docker inspect vozeb-pro --format 'Image={{.Config.Image}} Health={{.State.Health.Status}}'
docker inspect vozeb-pro-generation-worker --format 'Image={{.Config.Image}} Status={{.State.Status}}'
docker compose logs --tail 100 app
docker compose logs --tail 100 generation-worker
```

`/api/health/live` 只证明 Web 进程存活；安装后的 `/api/health/ready` 才会检查数据库、Schema、加密密钥和首个管理员。两者都不能替代真实文本、图片、视频、音频和备份恢复验收。

## 九、日常操作

所有命令在 `/root/mutangaigc/VOZEB-PRO` 执行：

```bash
cd /root/mutangaigc/VOZEB-PRO

# 状态
docker compose ps

# 启动已有容器
docker compose start

# 停止但保留容器和卷
docker compose stop

# 按当前配置创建或更新容器
docker compose up -d --pull never

# 查看最近日志，避免无限输出
docker compose logs --tail 200 app
docker compose logs --tail 200 generation-worker
docker compose logs --tail 200 postgres
```

修改 `.env` 后使用：

```bash
docker compose config --quiet
docker compose up -d --pull never
```

不要使用 `docker compose restart` 判断新环境变量已经生效；环境变量变化需要 Compose 重新创建对应容器。

## 十、完整备份

### 10.1 备份范围

生产备份必须同时包含：

1. PostgreSQL 整库自定义格式备份。
2. `vozeb-pro-data` 媒体卷。
3. 生产 `.env` 和不可更换的加密密钥。
4. 当前 `docker-compose.yml`、`VERSION`、`CHANGELOG.md` 和部署记录。
5. 当前镜像标签、镜像 ID 和源码提交。
6. 使用外部 S3/OSS 时，对象存储数据和配置的独立备份。

后台“数据备份”导出的业务 JSON 不等于完整灾难恢复备份，不能替代 PostgreSQL、媒体和对象存储备份。

### 10.2 创建备份目录

```bash
cd /root/mutangaigc/VOZEB-PRO
backup_stamp=$(date -u +%Y%m%dT%H%M%SZ)
backup_dir="/root/mutangaigc/VOZEB-PRO/backups/$backup_stamp"
install -d -m 700 "$backup_dir"
printf 'Backup directory: %s\n' "$backup_dir"
```

确认输出路径必须位于 `/root/mutangaigc/VOZEB-PRO/backups/`。

### 10.3 备份 PostgreSQL

数据库账号从容器内部环境读取，不在命令行展开密码：

```bash
docker compose exec -T postgres sh -c 'pg_dump --format=custom --create -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$backup_dir/postgres.dump"
test -s "$backup_dir/postgres.dump"
```

### 10.4 备份媒体卷

为避免备份过程中继续写入本地媒体，短暂停止 App 和 Worker；PostgreSQL 保持运行：

```bash
docker compose stop app generation-worker

docker run --rm --user 0 \
  -v vozeb-pro_vozeb-pro-data:/source:ro \
  -v "$backup_dir":/backup \
  --entrypoint tar postgres:16.6-alpine \
  -czf /backup/vozeb-pro-data.tar.gz -C /source .

docker compose start app generation-worker
test -s "$backup_dir/vozeb-pro-data.tar.gz"
```

如果归档失败，先检查并恢复 App/Worker 运行状态，再处理错误；不要删除源数据卷。

### 10.5 备份配置与部署记录

```bash
cp --preserve=mode .env "$backup_dir/.env"
cp docker-compose.yml VERSION CHANGELOG.md DEPLOYMENT-MANIFEST.txt "$backup_dir/"
docker inspect vozeb-pro --format 'ImageTag={{.Config.Image}} ImageID={{.Image}}' > "$backup_dir/image.txt"
chmod 600 "$backup_dir/.env"

cd "$backup_dir"
sha256sum postgres.dump vozeb-pro-data.tar.gz .env docker-compose.yml VERSION CHANGELOG.md DEPLOYMENT-MANIFEST.txt image.txt > SHA256SUMS
sha256sum -c SHA256SUMS
```

把备份复制到独立磁盘或异地安全存储，并定期做恢复演练。备份命令成功不等于恢复一定可用。

## 十一、安全更新流程

### 11.1 更新前门禁

必须全部满足：

- 已阅读新版本 `CHANGELOG.md`、README 和部署说明。
- 已明确数据库 Schema 是否支持从当前版本原地升级。
- 第十节的 PostgreSQL、媒体、配置和部署记录备份已完成并校验。
- 新镜像已经在本地完成构建检查和冒烟验证。
- 旧镜像标签仍保留在服务器。
- 已记录维护窗口和回滚负责人。

### 11.2 上传并加载新镜像

按照第四节上传新 tar、校验文件、Compose 和部署记录。服务器执行：

```bash
cd /tmp/vozeb-deploy
NEW_IMAGE_ARCHIVE='替换为新镜像归档文件名.tar'
NEW_IMAGE_TAG='替换为新镜像完整标签'

sha256sum -c "$NEW_IMAGE_ARCHIVE.sha256"
docker load --input "$NEW_IMAGE_ARCHIVE"
docker image inspect "$NEW_IMAGE_TAG" --format 'ID={{.Id}} Architecture={{.Architecture}}'
```

确认 `Architecture=amd64`。

### 11.3 检查 Compose 变化

```bash
diff -u /root/mutangaigc/VOZEB-PRO/docker-compose.yml /tmp/vozeb-deploy/docker-compose.yml || true
```

如果新 Compose 修改了服务名、项目名、数据库连接、卷名或挂载目标，停止更新并人工评审。普通应用更新不得静默创建一套新卷。

确认新 Compose 兼容后才复制：

```bash
cp /tmp/vozeb-deploy/docker-compose.yml /root/mutangaigc/VOZEB-PRO/docker-compose.yml
cp /tmp/vozeb-deploy/VERSION /root/mutangaigc/VOZEB-PRO/VERSION
cp /tmp/vozeb-deploy/CHANGELOG.md /root/mutangaigc/VOZEB-PRO/CHANGELOG.md
cp /tmp/vozeb-deploy/DEPLOYMENT-MANIFEST.txt /root/mutangaigc/VOZEB-PRO/DEPLOYMENT-MANIFEST.txt
```

### 11.4 切换不可变镜像标签

```bash
cd /root/mutangaigc/VOZEB-PRO
PREVIOUS_IMAGE_TAG=$(docker inspect vozeb-pro --format '{{.Config.Image}}')
printf 'Previous image: %s\n' "$PREVIOUS_IMAGE_TAG"
printf 'New image: %s\n' "$NEW_IMAGE_TAG"

sed -i -E "s|^VOZEB_PRO_IMAGE=.*$|VOZEB_PRO_IMAGE=$NEW_IMAGE_TAG|" .env
docker compose config --quiet
docker compose up -d --pull never
docker compose ps
```

此操作会按需要重建 App 和 Worker，并继续使用现有 PostgreSQL/媒体卷。禁止在更新流程中删除卷。

### 11.5 更新后验收

```bash
curl --fail --silent --show-error http://127.0.0.1:3000/api/health/live
curl --fail --silent --show-error http://127.0.0.1:3000/api/health/ready
docker inspect vozeb-pro --format 'Image={{.Config.Image}} Health={{.State.Health.Status}}'
docker inspect vozeb-pro-generation-worker --format 'Image={{.Config.Image}} Status={{.State.Status}}'
docker compose logs --tail 200 app
docker compose logs --tail 200 generation-worker
```

随后使用真实生产账号验证登录、管理员页面、文本任务和已启用的图片/视频/音频能力。若涉及支付、对象存储或 Schema 变化，还要执行对应专项验收。

### 11.6 验证生成媒体公网访问

图片、视频和 Agent 使用站内参考素材调用外部模型时，应用会从 `.env` 的 `NEXT_PUBLIC_SITE_URL` 读取公网域名，并将 `/api/generation-log-assets/**` 转为完整 URL。例如：

```env
NEXT_PUBLIC_SITE_URL=https://aigc.mutangtech.com
```

```text
/api/generation-log-assets/permanent/2026/08/20/images/example.png
→ https://aigc.mutangtech.com/api/generation-log-assets/permanent/2026/08/20/images/example.png
```

该资源路由允许匿名 `GET` 和 `HEAD`，不再要求登录；路径校验、公共媒体限流、并发保护、安全响应头和原文件名下载仍然生效。任何获得完整 URL 的人都可以在文件删除前访问它，因此不要把 URL 当作访问凭证，也不要在公开日志或不可信页面中主动暴露不需要分享的链接。

外部 S3/OSS Bucket 可以继续保持私有。应用会先接收上述稳定站内 URL，再以短期签名地址跳转到对象存储；此改动不会公开对象列表、删除接口、后台管理接口或 Bucket 本身。

部署后任选一条真实媒体链接，在无痕窗口或服务器外部执行：

```bash
MEDIA_URL='https://aigc.mutangtech.com/api/generation-log-assets/permanent/替换为真实路径'
curl --head "$MEDIA_URL"
curl --fail --location --output /dev/null "$MEDIA_URL"
```

预期不返回 `401` 或 `403`。使用私有对象存储时允许先返回 `307`，`curl --location` 应能继续取得最终媒体。随后分别用一张站内图片完成真实图生图，并在已启用视频渠道时完成一次参考图生视频，确认供应商能够拉取该公网 URL。

## 十二、回滚

### 12.1 仅回滚镜像

只有在确认数据库 Schema 向后兼容时，才可只切回旧镜像：

```bash
cd /root/mutangaigc/VOZEB-PRO
ROLLBACK_IMAGE_TAG='替换为上一版完整不可变标签'

docker image inspect "$ROLLBACK_IMAGE_TAG" --format 'ID={{.Id}} Architecture={{.Architecture}}'
sed -i -E "s|^VOZEB_PRO_IMAGE=.*$|VOZEB_PRO_IMAGE=$ROLLBACK_IMAGE_TAG|" .env
docker compose config --quiet
docker compose up -d --pull never

curl --fail --silent --show-error http://127.0.0.1:3000/api/health/live
curl --fail --silent --show-error http://127.0.0.1:3000/api/health/ready
```

### 12.2 Schema 不兼容时

如果新版本已经执行不兼容的数据库变更，仅切换旧镜像可能继续报错或损坏数据。必须使用升级前同一时间点的数据库、媒体、`.env`、Compose 和旧镜像完成成套恢复。

恢复是破坏性操作，执行前必须：

1. 再备份当前故障现场。
2. 核对目标备份目录的绝对路径。
3. 校验 `SHA256SUMS`。
4. 确认旧镜像仍存在。
5. 获得维护者明确批准。

数据库恢复示例：

```bash
cd /root/mutangaigc/VOZEB-PRO
RESTORE_DIR='/root/mutangaigc/VOZEB-PRO/backups/替换为已核验的备份目录'
test -d "$RESTORE_DIR"
test -s "$RESTORE_DIR/postgres.dump"
(cd "$RESTORE_DIR" && sha256sum -c SHA256SUMS)

docker compose stop app generation-worker
cat "$RESTORE_DIR/postgres.dump" | docker compose exec -T postgres sh -c 'pg_restore --clean --if-exists --create -U "$POSTGRES_USER" -d postgres'
```

媒体卷恢复会删除当前媒体卷内容。Agent 不得自动执行；维护者必须先验证卷名并明确确认：

```bash
docker volume inspect vozeb-pro_vozeb-pro-data
```

获得明确确认后，先把当前媒体卷再次归档，再清理并恢复已核验备份：

```bash
docker run --rm --user 0 \
  -v vozeb-pro_vozeb-pro-data:/target \
  --entrypoint sh postgres:16.6-alpine \
  -c 'find /target -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'

docker run --rm --user 0 \
  -v vozeb-pro_vozeb-pro-data:/target \
  -v "$RESTORE_DIR":/backup:ro \
  --entrypoint tar postgres:16.6-alpine \
  -xzf /backup/vozeb-pro-data.tar.gz -C /target
```

恢复匹配的 `.env`、Compose 和旧镜像标签后再启动：

```bash
cp "$RESTORE_DIR/.env" /root/mutangaigc/VOZEB-PRO/.env
cp "$RESTORE_DIR/docker-compose.yml" /root/mutangaigc/VOZEB-PRO/docker-compose.yml
chmod 600 /root/mutangaigc/VOZEB-PRO/.env

cd /root/mutangaigc/VOZEB-PRO
docker compose config --quiet
docker compose up -d --pull never
curl --fail --silent --show-error http://127.0.0.1:3000/api/health/ready
```

## 十三、Agent 操作红线

自动化 Agent 必须遵守：

- 不在对话、命令输出、补丁、Git、Issue 或日志中显示 `.env`、密码、令牌、API Key、证书私钥。
- 不修改已安装环境的 `VOZEB_PRO_ENCRYPTION_KEY`。
- 不覆盖生产 `.env`；变更单个字段前先创建权限受控备份。
- 不执行 `docker compose down -v`。
- 不执行 `docker volume rm`、数据库 DROP/TRUNCATE、递归删除媒体目录等破坏性操作，除非用户明确授权恢复流程且目标已验证。
- 不因新版本启动失败而删除旧镜像、旧 Compose 或升级前备份。
- 不在未完成备份、校验和版本兼容审查时升级。
- 不把 `/api/health/live` 成功解释为 Schema、Worker、支付、存储和真实模型全部正常。
- 不改变 `COMPOSE_PROJECT_NAME`、卷名或挂载目标来“解决”找不到数据的问题。
- 不将服务器现场构建作为默认升级方式；默认交付本地已验证的不可变镜像。
- 一键脚本只在人工执行时拉取代码；不要把它加入服务器开机任务或无限循环。
- 服务器上的已跟踪源码有未提交修改时脚本会拒绝更新；先审查并提交或移走这些修改，禁止用强制 Git 清理覆盖现场修改。
- 脚本快速备份 PostgreSQL、`.env` 和部署元数据；外部 COS/OSS Bucket 与仍在本地卷中的不可再生媒体需要独立备份策略。

## 十四、常见问题

| 问题 | 检查与处理 |
| --- | --- |
| `exec format error` | 镜像架构不匹配；本流程要求镜像和服务器均为 `amd64` |
| Debian 构建源 502 | 本地构建传入 `DEBIAN_MIRROR` 和 `DEBIAN_SECURITY_MIRROR`；服务器不现场构建 |
| npm 下载超时 | 重新执行本地构建可复用 BuildKit 缓存；重复失败时再评估可信 npm 镜像，不要改服务器数据 |
| 服务器提示缺少镜像或尝试拉取镜像 | 不要临时开放生产服务器拉取；检查交付 tar 是否同时包含清单中的应用镜像和 `postgres:16.6-alpine`，回到本地补齐后重新上传 |
| `no configuration file provided` | 先进入 `/root/mutangaigc/VOZEB-PRO`，再执行 Compose |
| Compose 创建了新卷 | 检查 `COMPOSE_PROJECT_NAME=vozeb-pro`、执行目录和卷声明；不要删除任一卷 |
| PostgreSQL unhealthy | 检查磁盘、日志、数据库密码和卷权限：`docker compose logs --tail 200 postgres` |
| App unhealthy | 检查 `.env` 必填字段、数据库状态和 App 日志 |
| Worker 反复退出或 401/403 | 确认 App 与 Worker 使用同一个 `VOZEB_PRO_WORKER_TOKEN`，但不要输出令牌值 |
| Nginx 502 | 检查 App 是否 healthy、`127.0.0.1:3000` 是否监听、`proxy_pass` 是否正确 |
| HTTPS 域名跳转或回调错误 | 检查 `NEXT_PUBLIC_SITE_URL`、`X-Forwarded-*` 请求头和 `VOZEB_PRO_TRUSTED_PROXY_HOPS` |
| `/api/health/live` 成功但 `/ready` 失败 | 检查数据库连接、Schema、加密密钥和首个管理员；查看 App 日志 |
| 修改 `.env` 不生效 | 执行 `docker compose config --quiet` 和 `docker compose up -d --pull never` 重新创建容器 |
| 更新后旧数据“消失” | 首先检查 Compose 项目名和卷挂载，不要初始化新库或删除旧卷 |
| 磁盘空间不足 | 检查镜像、媒体和备份占用；先制定保留策略，不要直接清理生产卷 |

## 十五、可选交付方式

### 15.1 镜像仓库

可以把同一不可变镜像推送到 GHCR 或私有仓库，再由服务器拉取。此方式适合多服务器或频繁发布，但需要安全管理仓库凭据和镜像保留策略。

### 15.2 服务器源码一键构建与更新

如果明确选择“服务器从 GitHub 拉取源码并本地构建镜像”，项目固定放在 `/root/mutangaigc/VOZEB-PRO`，生产分支固定为 `main_yao_20260820`。首次部署且该目录尚不存在时执行：

```bash
apt-get update
apt-get install -y git curl util-linux
git clone --branch main_yao_20260820 --single-branch \
  https://github.com/yaoke602/VOZEB-PRO.git \
  /root/mutangaigc/VOZEB-PRO
cd /root/mutangaigc/VOZEB-PRO
```

把已经准备好的生产 `.env` 安全地放到 `/root/mutangaigc/VOZEB-PRO/.env`，再限制权限。不要从 Git 提交或命令输出中复制密钥：

```bash
chown root:root /root/mutangaigc/VOZEB-PRO/.env
chmod 600 /root/mutangaigc/VOZEB-PRO/.env
cd /root/mutangaigc/VOZEB-PRO
docker compose config --quiet
```

先执行只读检查，再执行第一次部署：

```bash
git branch --show-current
git remote -v
sudo ./scripts/deploy-debian.sh --dry-run
sudo ./scripts/deploy-debian.sh
```

日常更新仍然只执行：

```bash
cd /root/mutangaigc/VOZEB-PRO
sudo ./scripts/deploy-debian.sh
```

脚本会从 `origin/main_yao_20260820` 快进到最新提交，在服务器本地构建 `vozeb-pro:<VERSION>-<Git SHA>`，完成 PostgreSQL 与配置备份，然后依次更新 App 和 Worker。应用切换使用 `--pull never`，不会下载 VOZEB PRO 应用镜像。

第一次部署还没有初始化 Schema 或创建管理员时，脚本会在 App 存活、PostgreSQL 可连接且 Worker 进程稳定后报告 `schema_pending` 或 `admin_pending`，此时打开：

```text
https://aigc.mutangtech.com/install
```

完成初始化后再次执行一键脚本或检查 `/api/health/ready`。已经安装的环境在更新时会停止旧 Worker，更新 App，再启动新 Worker；只有检测到新心跳且 `/api/health/ready` 成功才算发布完成。

服务器第一次构建仍可能下载 Dockerfile 的 Node 基础镜像、Debian/npm 构建依赖；第一次创建数据库服务也需要取得 `postgres:16.6-alpine`。这些是应用的构建基础和独立数据库镜像，不是从远程下载 VOZEB PRO 成品镜像。后续构建会尽量复用 Docker 缓存。

如果 `VERSION` 改变，先阅读 `CHANGELOG.md`、README 和对应版本说明。确认数据库支持原地升级后才执行：

```bash
sudo ./scripts/deploy-debian.sh --allow-version-change
```

如果现有容器使用 `vozeb-pro:local` 等无法识别版本的标签，脚本也会默认停止；审查当前数据库来源和目标版本后才能使用同一参数继续。`--force-build` 会创建带时间和进程号后缀的新标签，不会覆盖当前回滚镜像：

```bash
sudo ./scripts/deploy-debian.sh --force-build
```

一键流程拒绝包含未提交/未跟踪构建文件的工作区，也拒绝自动部署修改过 `docker-compose.yml` 的提交。后者可能改变项目名、PostgreSQL 或媒体卷拓扑，必须按第十一节人工审查和部署。脚本会记录并核对 PostgreSQL 容器、实际挂载的数据库卷和已有媒体卷身份，应用更新过程中不得发生变化。即使 PostgreSQL 容器已被删除，只要标准数据库卷或媒体卷仍存在，脚本仍按“已有部署”执行版本兼容门禁；由于此时无法从实际 App 镜像证明旧版本，必须先审查数据兼容性并显式使用 `--allow-version-change`，不能借删除容器绕过检查。

更新前 `.env` 中的 `VOZEB_PRO_IMAGE` 必须与正在运行的 App 一致，App 与 Worker 也必须使用同一镜像；否则脚本会停止，防止回滚标签指向错误镜像。先用 `docker inspect` 查清现场，不要直接覆盖标签。

服务器重启不会拉取 GitHub 最新代码；Compose 的 `restart: unless-stopped` 会恢复上一次验证通过的镜像。只有实际 App 镜像、目标提交和镜像 revision 标签都一致时，脚本才走无更新检查路径；该路径只检查并恢复 App/Worker，不重建 PostgreSQL。没有 App 但保留持久卷的现场即使已人工授权，也必须先备份再执行完整发布。发布切换期间如果脚本异常退出或收到 `INT`/`TERM`，会自动尝试回滚；第一次部署失败时只移除本次创建的 App/Worker 容器，保留 PostgreSQL 容器及全部命名卷。`.env` 的发布与回滚均通过权限受控的临时文件校验后原子替换。发布日志位于 `/var/log/vozeb-pro-deploy.log`，升级备份位于 `/root/mutangaigc/VOZEB-PRO/backups/`。

```bash
tail -n 200 /var/log/vozeb-pro-deploy.log
docker compose ps
docker compose logs --tail 100 app generation-worker
```

脚本的自动回滚只切换应用镜像。如果新版本执行了不兼容 Schema 变化，必须使用第十二节的数据库、媒体、`.env` 和旧镜像成套恢复流程。

## 十六、部署完成记录

每次部署至少记录以下非敏感信息：

```text
部署时间：
维护者：
项目 VERSION：
Git commit：
镜像标签：
镜像 ID：
Compose 文件版本：
升级前备份目录：
数据库兼容性依据：
health/live 结果：
health/ready 结果：
Worker 状态：
回滚镜像标签：
尚未完成的真实业务验收：
```

不得把密码、令牌、API Key、支付密钥、证书私钥或 `.env` 正文写入部署记录。
