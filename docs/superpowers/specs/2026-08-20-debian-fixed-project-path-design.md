# Debian 固定项目路径变更设计

## 目标

腾讯云 Debian 12 服务器上的 VOZEB PRO 源码仓库已经位于：

```text
/root/mutangaigc/VOZEB-PRO
```

将服务器源码部署脚本的固定项目根目录从 `/opt/vozeb-pro` 改为上述实际路径，使维护者无需移动现有仓库即可执行一键构建与发布。

## 采用方案

保持“固定生产路径”模型，只修改脚本顶部唯一的 `PROJECT_ROOT` 只读常量：

```bash
readonly PROJECT_ROOT="/root/mutangaigc/VOZEB-PRO"
```

`BACKUP_ROOT`、临时 `.env` 文件和运行目录检查继续由 `PROJECT_ROOT` 派生。部署锁与日志仍使用系统路径：

```text
/var/lock/vozeb-pro-deploy.lock
/var/log/vozeb-pro-deploy.log
```

不引入自动目录识别、命令行路径参数或环境变量覆盖，避免扩大生产脚本的配置面。

## 修改范围

- 更新 `scripts/deploy-debian.sh` 中的固定项目根目录。
- 更新服务器源码部署设计和 `DEPLOY-GUIDE.md` 中的生产路径、克隆路径、执行命令与备份路径。
- 更新部署契约测试，明确断言新的固定路径。
- 保留数据库、媒体卷、不可变镜像、版本门禁、备份、健康检查和自动回滚逻辑不变。
- 不包含当前工作区中与本任务无关的 `README.md` 修改。

## 验证

- 部署契约测试确认脚本只使用新的固定根目录，不再包含旧的 `/opt/vozeb-pro` 根目录常量。
- Bash 语法和命令级行为测试继续通过。
- Docker Compose 配置校验继续通过。
- `git diff --check` 无格式问题。

## 服务器使用方式

服务器拉取包含该变更的提交后，在现有目录执行：

```bash
cd /root/mutangaigc/VOZEB-PRO
chmod 600 .env
./scripts/deploy-debian.sh --dry-run
./scripts/deploy-debian.sh
```

脚本仍要求由 root 执行；当前服务器终端已经是 root，因此不需要额外使用 `sudo`。
