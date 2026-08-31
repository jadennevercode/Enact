-- 一个数据源一份清洗脚本 —— 落 data/clean/<数据源>/clean.sql。
--
-- 规则见 ../references/clean.md。三条最要紧的：
--   1. 输出目标结构的列，一列不多一列不少。
--   2. 一条原始行带多个指标时用 UNION ALL 逐指标拆开，
--      不要为了迁就源表去加宽目标结构。
--   3. 每一列在注释里标出它的来路：Hardcode / Direct / Mapping / Transform / Calculation。
--
-- 只能是 SELECT 或 WITH 开头的单语句。没有文件与网络访问。

SELECT
  '示例数据源'                      AS task_name,      -- Hardcode
  Manufacture                       AS brand,          -- Direct
  '全国'                            AS province_group, -- Hardcode
  {{enum:channel_type:渠道}}        AS channel_type,   -- Mapping：ELSE 有意保留原值
  ''                                AS channel,        -- Hardcode：该源无二级渠道
  CAST(LEFT(期间, 4) AS INTEGER)    AS year,           -- Transform
  CAST(期间 AS INTEGER)             AS month,          -- Transform：yyyymm
  '消费者需求驱动'                   AS l1,             -- Hardcode：逐字抄自因子树
  '品牌广告/内容种草'                AS l2,             -- Hardcode
  '品牌传播'                         AS l3,             -- Hardcode
  'Digital Display'                 AS l4,             -- Hardcode
  'NA' AS l5, 'NA' AS l6, 'NA' AS l7, 'NA' AS l8,      -- Hardcode：无下钻
  'spending'                        AS metric_type,    -- Hardcode：Y | spending | X
  '花费'                            AS metric,         -- Hardcode
  CAST(花费金额 AS DOUBLE)          AS value,          -- Direct
  'media-spend'                     AS source          -- Hardcode：这批交付的标识
FROM t
WHERE 花费金额 IS NOT NULL

-- 一行多指标时这样接着写：
-- UNION ALL
-- SELECT … '曝光量' AS metric, CAST(曝光 AS DOUBLE) AS value … FROM t
--
-- 按比例分摊金额时，让比例之和恒等于 1，这样「拆分后合计 = 拆分前合计」
-- 是构造性成立的，不需要额外对账。
