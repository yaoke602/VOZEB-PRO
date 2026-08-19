# 本地构建到 Debian 12 部署指南设计

## 目标

在项目根目录新增 `DEPLOY-GUIDE.md`，让用户或 Agent 能够安全地完成以下操作：

- 在 Windows + Docker Desktop 上从当前源码构建 Linux amd64 应用镜像。
- 导出、校验并上传镜像到 Debian 12 amd64 服务器。
- 在服务器通过 Docker Compose、Nginx、域名和 HTTPS 完成首次部署。
- 在不误删 PostgreSQL 与媒体数据的前提下更新、备份、回滚和排障。

## 部署拓扑

本地构建产物是 VOZEB PRO 应用运行镜像，包含 Next.js standalone 服务、Generation Worker 脚本、FFmpeg、中文字体、Sharp 和运行依赖。PostgreSQL 数据、媒体数据卷、`.env` 和密钥不进入镜像。

服务器使用标准 `docker-compose.yml`，运行 PostgreSQL、App 和 Generation Worker。应用只绑定 `127.0.0.1:3000`，由 Nginx 对外提供域名 HTTPS。PostgreSQL 和媒体分别保存在 Compose 命名卷中。

## 镜像交付

主流程不使用镜像仓库，也不在服务器现场编译。Windows 本地构建 Linux amd64 镜像，使用包含项目版本和 Git 短提交号的不可变标签，通过 `docker save` 导出 tar，生成 SHA-256 校验值后使用 SCP 上传。服务器验证校验值并执行 `docker load`。

镜像仓库交付和服务器源码构建只作为附录，避免干扰单服务器的推荐流程。

## 首次部署

指南覆盖 Debian 12 安装 Docker Engine 与 Compose、建立 `/opt/vozeb-pro` 部署目录、准备生产 `.env`、生成五项独立强密钥、加载镜像、验证 Compose 配置、启动服务、配置 Nginx/HTTPS、访问 `/install` 初始化 Schema 并创建首个管理员。

生产 `.env` 使用真实 HTTPS 站点地址；数据库密码、加密密钥、安装令牌、维护令牌和 Worker 令牌不得输出到日志或提交 Git。`VOZEB_PRO_ENCRYPTION_KEY` 安装后不得更换。

## 更新与数据边界

更新应用镜像与重建 App/Worker 容器不会主动删除命名卷，但这不代表任意版本的数据库 Schema 都可原地升级。每次更新必须先阅读 `CHANGELOG.md`、README 和版本说明，确认是否支持沿用现有数据库。

指南明确记录 `0.0.2` 到 `0.0.6` 不支持原地升级。其他版本也只能在版本说明允许时使用保留卷更新流程。更新前必须备份 PostgreSQL、媒体卷、生产 `.env` 和加密密钥；禁止执行 `docker compose down -v`。

## 备份与回滚

备份同时覆盖：

- PostgreSQL 自定义格式整库备份。
- `vozeb-pro-data` 媒体数据卷归档。
- 权限受控的 `.env` 副本及独立保存的加密密钥。
- 当前源码提交、镜像标签、镜像 ID 和 Compose 文件。

普通回滚只切回旧的不可变镜像标签，前提是数据库 Schema 向后兼容。若新版本已经执行不兼容的 Schema 变更，必须停止服务并恢复与旧镜像匹配的数据库和媒体备份，不能只切换镜像。

## Nginx 与健康检查

Nginx 配置保留 `Host`、`X-Forwarded-Host`、`X-Forwarded-Proto` 和 `X-Forwarded-For`。生产环境设置正确的可信代理层数，并使用现有证书或 Certbot 提供 HTTPS。

部署和更新验收至少包括：Compose 配置解析成功、PostgreSQL 与 App 健康、Worker 运行、`/api/health/live` 返回 HTTP 200、安装后 `/api/health/ready` 返回 HTTP 200、首页可访问且日志无致命错误。

## Agent 安全规则

指南为自动化 Agent 提供显式红线：

- 不打印、提交、覆盖或上传 `.env` 和密钥。
- 不修改已安装环境的加密密钥。
- 不执行 `docker compose down -v`、`docker volume rm` 或数据库清空命令。
- 不在未确认备份和版本兼容性的情况下升级。
- 不因新容器启动失败而删除旧镜像或备份。
- 不把健康存活检查等同于数据库 Schema 与全部业务功能兼容。

## 文档验收

- 命令分别标明在 Windows PowerShell、本地项目根目录、Debian 服务器或 Nginx 主机执行。
- 所有路径、变量和域名占位符在首次使用时解释。
- 首次部署、日常运维、更新、回滚和恢复可独立按章节执行。
- 危险命令不作为普通步骤出现，且风险提示紧邻相关操作。
- 文档与当前 Dockerfile、标准 Compose、`.env.example` 和现有项目部署说明保持一致。
