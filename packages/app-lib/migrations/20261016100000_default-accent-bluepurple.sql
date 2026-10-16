-- 默认强调色：粉色 → 蓝紫色（ALLIGATORZONE 品牌色 #6c5ce7）。
--
-- 只覆盖仍是出厂默认 'pink' 的行：
--   - 全新安装：init.sql 插入设置行后，accent_color 被列默认值填成 'pink'，这里改成 'purple'。
--   - 已有安装：玩家主动选过其它颜色则不受影响；仍是 'pink' 的会跟着改。
--
-- 为什么不直接改列默认值：SQLite 不支持 ALTER COLUMN ... DEFAULT，而重建 settings 表
-- 需要抄全当前所有列定义，任何遗漏都会让玩家的设置丢失。这条 UPDATE 不碰任何结构。
UPDATE settings SET accent_color = 'purple' WHERE id = 0 AND accent_color = 'pink';
