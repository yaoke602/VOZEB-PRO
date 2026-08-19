# Docker 本地源码构建设计

## 目标

使用当前 `main` 分支源码构建 `vozeb-pro:local`，通过标准 `docker-compose.yml` 启动应用、PostgreSQL 和 Generation Worker，并复用现有 Docker 数据卷。

## 背景

当前 Dockerfile 在运行阶段从 Debian 官方源安装 `ca-certificates`、FFmpeg、中文字体和 PostgreSQL 客户端。本机网络访问该源持续返回 502；阿里云 Debian 主仓库和安全仓库已在相同基础镜像中验证可用。

## 设计

Dockerfile 新增两个构建参数，分别表示 Debian 主仓库和安全仓库地址。参数默认值保持现有官方源，因此默认构建行为不变。本机构建时显式传入阿里云地址，并在执行 `apt-get update` 前替换 `/etc/apt/sources.list.d/debian.sources` 中对应的 URI。

构建命令生成 `vozeb-pro:local`。`.env` 中的 `VOZEB_PRO_IMAGE` 指向该本地镜像，标准 Compose 文件继续提供 `127.0.0.1:3000` 端口绑定、固定 PostgreSQL 16.6 镜像、现有健康检查和命名卷。

## 数据与安全

- 不执行 `docker compose down -v`，不删除或重建命名卷。
- 复用现有 `vozeb-pro_vozeb-pro-data` 和 `vozeb-pro_vozeb-pro-postgres`。
- 复用旧部署的数据库密码和加密密钥，不在日志或提交中输出 `.env` 内容。
- `.env` 保持 Git 忽略状态。

## 错误处理

构建失败时保留旧容器和数据卷，不启动不完整镜像。Compose 启动失败时检查容器状态和日志；健康接口未通过则不宣告部署成功。

## 验收

1. Docker 镜像 `vozeb-pro:local` 构建成功，镜像内类型检查和 Next.js 生产构建通过。
2. PostgreSQL、主应用和 Generation Worker 三个服务成功启动。
3. 主应用容器健康状态为 `healthy`。
4. `http://127.0.0.1:3000/api/health/live` 返回成功响应。
5. 现有 Docker 数据卷仍存在且未被清空。
