# 生成资源公开访问设计

## 目标

让 `/api/generation-log-assets/**` 下的图片、视频和音频无需登录即可通过完整 URL 访问，并允许外部图片、视频模型把这些生成结果作为参考素材读取。

## 已确认的公开边界

- 所有 generation log asset 的 `GET` 与 `HEAD` 均不再要求 Session，也不检查素材所有权。
- 不增加目录列表或搜索接口；访问者仍需知道完整资源路径。
- 删除素材、生成记录列表、后台管理和其他业务接口继续保持现有鉴权。
- 链接永久公开，直到素材被删除。文件名中的 UUID 只降低猜测概率，不作为授权机制。
- 本地存储与 S3 兼容私有对象存储使用相同行为。对象存储 Bucket 继续私有，公开媒体路由按请求生成对象存储临时读取地址并返回重定向。

## 公网域名来源

外部模型所需的绝对 URL 不硬编码域名。服务端继续通过 `resolvePublicRequestOrigin()` 读取并规范化 `.env` 中的：

```text
NEXT_PUBLIC_SITE_URL=https://aigc.mutangtech.com
```

只有路径属于 `/api/generation-log-assets/` 时才用该 origin 拼成绝对 URL；普通远程 URL 和受签名的 `/api/reference-assets/` 保持现有逻辑。

## 实现

1. 在服务端媒体访问 helper 中提供 generation asset URL 公开化函数，将相对地址或内部 `127.0.0.1` 地址规范化到公开 origin。
2. generation log asset Route 移除 Session 与所有权校验，改用现有 `checkPublicMediaRateLimit()`，保留路径穿越检查、并发控制、内容类型、HEAD、原件下载和对象存储重定向。
3. 图片任务的公网参考地址解析调用共享 helper。
4. 视频任务在能力与公网 URL 校验前调用同一 helper；Agent 最终进入图片或视频任务时继承该行为。

## 验证

- 未登录请求可读取本地 generation asset。
- 未登录请求可获得私有对象存储 generation asset 的 307 临时地址。
- GET、HEAD、原件下载、限流和路径保护继续工作。
- 图片任务把相对 generation asset 地址转换为 `NEXT_PUBLIC_SITE_URL` 下的完整地址。
- 视频任务执行相同转换，并通过要求公网 URL 的渠道校验。
- `/api/reference-assets/` 的登录/短期签名规则保持不变。

## 风险接受

维护者已经明确接受所有 generation log asset 链接永久公开的行为。部署文档与待测试记录必须提示：获得完整链接的任何人都可以读取对应资源。
