# Debian 12 服务器源码一键部署设计

## 1. 背景

VOZEB PRO 生产环境运行在腾讯云 Debian 12 `amd64` 服务器。服务器已经安装 Docker、Docker Compose 与 Git，项目固定部署在 `/opt/vozeb-pro`，生产域名为 `https://aigc.mutangtech.com`。

维护者选择在服务器上从 GitHub 获取源码并构建应用镜像，不使用远程仓库中的 VOZEB PRO 预构建镜像。PostgreSQL 继续作为独立 Compose 服务运行，数据库和本地媒体由 Docker 命名卷持久化。

目标是把日常发布收敛为一条人工触发的命令：

```bash
cd /opt/vozeb-pro
sudo ./scripts/deploy-debian.sh
```

服务器重启不自动拉取源码或构建镜像。现有 Compose `restart: unless-stopped` 负责使用已经验证的镜像恢复服务，避免 GitHub、软件源或构建失败阻塞开机恢复。

## 2. 目标与非目标

### 2.1 目标

- 从固定远端与分支获取最新提交：`origin/main_yao_20260820`。
- 在 Debian 服务器本地构建可追溯的 VOZEB PRO 镜像。
- 镜像标签由 `VERSION` 和 Git 短提交号组成，例如 `vozeb-pro:v0.0.6-bfe52ee6d381`。
- 构建成功后依次更新 App 和 Generation Worker，并验证健康状态。
- 发布过程中保持 PostgreSQL 容器和命名卷不变。
- 在切换前保存 PostgreSQL、生产 `.env` 和部署元数据备份。
- 新版本启动失败时，在安全边界内切回旧镜像。
- 无新提交时避免无意义的重复构建。
- 给维护者和 Agent 提供明确的运行、排错和恢复说明。

### 2.2 非目标

- 不在服务器开机过程中自动发布最新代码。
- 不自动合并分叉历史、解决 Git 冲突或覆盖服务器上的已跟踪修改。
- 不自动判断任意数据库 Schema 变化是否向前或向后兼容。
- 不自动删除旧镜像、旧备份、数据库卷或媒体卷。
- 不替代对象存储 Bucket 的版本控制、快照或异地备份。
- 不实现多节点滚动发布或真正的零停机编排。

## 3. 方案比较

### 3.1 采用：不可变镜像标签的一键发布脚本

脚本先拉取代码，再构建带版本和提交号的本地镜像。只有构建成功才修改 `.env` 中的 `VOZEB_PRO_IMAGE` 并重建 App/Worker 容器。

优点：镜像可追溯、构建失败不影响旧容器、回滚目标明确、与当前 `docker-compose.yml` 的 `image:` 设计一致。

代价：服务器需要足够的 CPU、内存、磁盘和构建网络；需要制定旧镜像与备份的人工保留策略。

### 3.2 未采用：固定标签配合 `docker compose up --build`

该方案需要在生产 Compose 中加入 `build:`，并反复覆盖同一镜像标签。命令较短，但很难从容器状态直接追溯到 Git 提交，失败后的回滚也不够可靠。

### 3.3 未采用：systemd 开机自动拉取和构建

开机发布会把系统恢复依赖于 GitHub、Debian/npm 软件源和新提交质量。网络或构建失败可能让业务无法随服务器一起恢复，因此服务器开机只恢复上一次已验证的容器。

## 4. 命令接口

主入口为：

```bash
sudo ./scripts/deploy-debian.sh
```

计划支持以下受控选项：

```text
--allow-version-change   VERSION 改变且人工审查兼容性后允许继续
--force-build            远端提交未变化时仍重新构建并发布
--dry-run                显示检查结果和计划动作，不拉取、构建或切换
--help                   显示使用说明
```

脚本固定面向 `/opt/vozeb-pro`、`origin` 和 `main_yao_20260820`。如未来需要修改这些部署参数，应通过脚本顶部的只读配置常量集中调整，避免在多个命令中散落。

## 5. 发布流程

### 5.1 发布前检查

脚本启用 Bash 严格模式并通过 `flock` 获取独占锁。随后检查：

- 当前用户具有运行 Docker 和写入项目、备份目录的权限。
- 当前目录解析结果是 `/opt/vozeb-pro`。
- `git`、`docker`、Docker Compose、`curl` 和 `flock` 可用。
- `.env` 是 root 拥有的普通文件、组和其他用户无权限，并包含 Compose 要求的生产变量；`COMPOSE_PROJECT_NAME` 固定为 `vozeb-pro`。
- Git 当前分支为 `main_yao_20260820`，远端 `origin` 存在。
- 已跟踪文件没有未提交修改，Docker 构建上下文也没有未跟踪文件；忽略的生产 `.env` 和 `backups/` 不参与该判断。
- `docker compose config --quiet` 通过。
- PostgreSQL 服务可以启动并达到健康状态。

任一检查失败都在拉取、构建或切换前退出。

### 5.2 获取最新代码

脚本执行 `git fetch origin main_yao_20260820`，确认远端提交是当前提交的快进后继，再执行快进更新。禁止自动 merge、rebase、reset 或覆盖本地修改。

如果目标提交修改了 `docker-compose.yml`，一键脚本在更新源码前停止。Compose 变化可能改变项目名、数据库服务或持久化卷，必须使用人工审查流程部署。

如果远端提交与当前提交相同，并且 `.env` 已经指向该提交对应的本地镜像，默认不重复构建，只执行 Compose 状态与应用健康检查。如果源码已经更新、但上次执行在版本确认或构建阶段中止，脚本会继续完成尚未发布的目标镜像。维护者也可以使用 `--force-build` 强制重建。

Git 更新只改变服务器上的源码目录；当前 App 和 Worker 仍运行旧镜像，不会因源码拉取或构建失败而停止。

### 5.3 版本兼容门禁

脚本从 `VERSION` 读取目标版本，优先从当前 App 容器的实际镜像引用识别已部署版本。它支持版本化仓库镜像和本项目的 `VERSION + Git SHA` 标签；存在 App/PostgreSQL 部署但无法识别版本时默认停止，只有明确审查后才能通过版本授权参数继续。

当二者不同，默认停止并提示维护者阅读 `CHANGELOG.md`、README 和部署说明，确认数据库 Schema 是否支持原地升级。人工确认后使用：

```bash
sudo ./scripts/deploy-debian.sh --allow-version-change
```

该参数只记录维护者明确授权，不代表脚本已经证明 Schema 兼容。项目已知 `0.0.2` 到 `0.0.6` 不支持原地升级，此类升级必须执行版本文档规定的完整迁移或重装流程，不能通过本脚本强行切换。

同一 `VERSION` 下的提交仍可能包含数据层变化，因此发布者依然需要审查拉取的提交；脚本不会把相同版本误认为绝对安全。

### 5.4 构建不可变应用镜像

目标镜像标签格式为：

```text
vozeb-pro:<VERSION>-<12 位 Git 提交号>
```

示例：

```text
vozeb-pro:v0.0.6-bfe52ee6d381
```

脚本使用项目根目录的 `Dockerfile` 在服务器本地执行 `docker build`。国内网络使用项目已经支持的 Debian 镜像源构建参数。构建过程包含项目 Dockerfile 定义的依赖安装、类型检查、生产构建和运行库检查。

构建失败时立即退出，不修改 `.env`，也不重建现有 App/Worker。PostgreSQL 与线上旧容器继续运行。

普通构建使用 `VERSION + Git SHA` 标签并记录版本、完整提交号镜像标签。`--force-build` 使用额外的 UTC 时间与进程号后缀，禁止覆盖当前容器引用的回滚标签。`backups/` 同时从 Git 和 Docker 构建上下文排除，避免数据库备份和生产配置进入镜像构建输入。

### 5.5 切换前备份

备份目录使用 UTC 时间戳，位于：

```text
/opt/vozeb-pro/backups/<UTC 时间戳>/
```

权限固定为仅 root 可访问。至少保存：

- PostgreSQL `pg_dump --format=custom --create` 整库备份。
- 当前生产 `.env`。
- 当前镜像标签和镜像 ID。
- 更新前、更新后的 Git 提交号。
- `VERSION`、`CHANGELOG.md` 和 Compose 配置副本。
- 文件 SHA-256 校验记录。

数据库备份必须非空，任何备份步骤失败都禁止切换。

当前生产环境使用外部对象存储时，脚本不复制整个 Bucket；Bucket 的版本控制、快照或异地备份必须单独配置。如果 `vozeb-pro-data` 仍保存不可再生的本地媒体，应继续按照 `DEPLOY-GUIDE.md` 的完整备份流程归档该卷，不能只依赖本脚本的快速发布备份。

### 5.6 原子更新镜像配置

脚本先复制 `.env` 到权限受控的临时文件，只替换或追加 `VOZEB_PRO_IMAGE=<新镜像标签>`，验证值唯一且 Compose 配置有效后再原子替换正式 `.env`。

数据库密码、加密密钥、安装令牌、维护令牌、Worker 令牌、域名和对象存储配置均保持原值。

### 5.7 分阶段更新与健康检查

切换顺序为：

1. 保持 PostgreSQL 运行，并记录 PostgreSQL 容器、数据库卷和已有媒体卷身份。
2. 记录旧 Worker 心跳并停止旧 Worker。
3. 使用 `--pull never --no-deps --force-recreate` 只重建 App。
4. 等待 Compose App 健康检查并请求 `http://127.0.0.1:3000/api/health/live`。
5. 请求 `/api/install/status`，区分已安装、等待初始化 Schema 和等待首个管理员三种状态。
6. 使用同一个新镜像重建 Generation Worker，并要求进程持续稳定运行。
7. 已初始化 Schema 时等待新 Worker 心跳；已完成安装时最后请求 `/api/health/ready`。
8. 再次核对 PostgreSQL 容器和持久化卷身份，并输出三个服务状态。

首次部署在 Schema 或管理员尚未初始化时不会错误回滚，而是明确报告安装待完成并给出 `/install` 地址。已安装环境只有在新 Worker 心跳和最终 readiness 都通过后才算成功。

`--pull never` 保证 App 和 Worker 使用服务器刚构建的本地镜像，不从镜像仓库获取同名应用镜像。

### 5.8 失败与回滚

脚本在修改 `.env` 前记录旧应用镜像。如果 App 在新镜像下未通过健康检查，脚本恢复旧 `.env`，使用旧镜像重建 App 和 Worker，并再次检查健康状态。

自动回滚只适用于已确认没有不兼容 Schema 变化的镜像切换。如果新版本已经执行了不兼容数据库变更，只切换旧镜像并不安全，必须按照 `DEPLOY-GUIDE.md` 使用同一恢复点的数据库、媒体、`.env` 和旧镜像成套恢复。

Worker 更新失败时，脚本保留诊断日志并尝试恢复旧 App/Worker 组合，避免两个服务长期运行不同应用版本。

脚本永远不执行以下操作：

```text
docker compose down -v
docker volume rm
git reset --hard
docker image prune -a
```

## 6. 日志与可观测性

每次执行输出以下信息，但不输出 `.env` 密钥：

- 部署开始和结束时间。
- 旧、新 Git 提交号。
- 旧、新镜像标签。
- 构建、备份、App 切换、Worker 切换和健康检查结果。
- 备份目录绝对路径。
- 失败阶段和人工排错命令。

脚本输出同时追加到 `/var/log/vozeb-pro-deploy.log`。日志文件权限不得允许普通用户读取可能包含的基础部署信息。

## 7. 计划修改的文件

- 新增 `scripts/deploy-debian.sh`：一键发布入口。
- 新增部署脚本契约测试：验证关键安全约束、参数和命令结构。
- 更新 `DEPLOY-GUIDE.md`：增加服务器源码一键发布、首次安装和日常更新命令。
- 如有需要，补充 `.gitignore` 中仅针对本地测试产物的规则，不忽略发布脚本或说明。

## 8. 验收标准

- Shell 语法检查通过。
- 契约测试验证脚本包含严格模式、部署锁、快进检查、不可变标签、版本门禁、备份、`--pull never`、健康检查和回滚入口。
- `--help` 和 `--dry-run` 不改变 Git、Docker、`.env` 或备份状态。
- 无新提交时不会重复构建。
- 构建失败时现有容器和 `.env` 保持不变。
- 更新 App/Worker 时 PostgreSQL 容器 ID 和两个命名卷保持不变。
- 新 App 未通过健康检查时能够恢复旧镜像配置。
- 成功后 App 与 Worker 使用同一个 `VERSION + Git SHA` 镜像。
- `/api/health/live` 与 `/api/health/ready` 均成功。
- 文档明确首次部署、普通更新、跨版本更新、查看日志和人工回滚命令。

## 9. 运维结论

“启动服务”和“发布最新代码”保持分离：服务器重启由 Docker 恢复上一次稳定镜像；维护者需要更新时人工运行一键脚本。这样既满足服务器直接拉取最新源码并构建运行，也不会让一次普通重启自动引入未经验证的新代码。
