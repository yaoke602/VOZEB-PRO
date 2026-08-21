# sub2api 图生图协议修复设计

## 目标

让 sub2api 渠道按官方图片协议区分文生图与图生图，确保参考图片实际传给上游并参与生成。

## 已确认的协议

- 文生图继续使用 `POST /v1/images/generations`。
- 带参考图的编辑任务使用 `POST /v1/images/edits`。
- 图生图使用 JSON 请求体，参考图字段为 `images[].image_url`。
- 参考图使用上游可匿名读取的完整公网 URL。
- 图生图失败时不回退到文生图接口，避免上游忽略参考图后仍返回成功结果。

## 实现

1. 修正 sub2api 严格协议注册表：图片 `createPath` 保持 `/images/generations`，`editPath` 改为 `/images/edits`，请求模板与参考规则改为 `images[].image_url`。
2. 图片任务运行时对 sub2api 编辑任务构造单一 JSON 请求体：`images` 为 `{ image_url }` 对象数组；文生图请求体保持不变。
3. sub2api 编辑任务使用严格协议，不尝试其他参考图字段，也不回退到 `/images/generations`。
4. 项目仍处于测试阶段，不增加数据库迁移或旧配置兼容逻辑；运行时以修正后的内置严格协议为准。

## 验证

- sub2api 文生图请求命中 `/v1/images/generations`。
- sub2api 图生图请求命中 `/v1/images/edits`。
- 图生图请求只包含 `images: [{ image_url: ... }]`，不再包含 `image_urls`。
- 多张参考图保持原顺序进入 `images` 数组。
- 上游拒绝图生图请求时直接报告失败，不额外创建文生图任务。
- 标准 OpenAI、其他严格协议和普通兼容渠道行为不变。

## 后续工作台衔接

后续新增生图工作台和视频工作台时，复用 VOZEB PRO 已有的渠道路由、任务持久化、Worker、生成日志与媒体资产链路；`infinite-canvas` 仅作为交互与任务分流参考，不在本次协议修复中迁移其工作台实现。
