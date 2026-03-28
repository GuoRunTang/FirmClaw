/**
 * src/utils/prompt-template.ts
 *
 * 简单的 {{}} 模板替换引擎。
 *
 * 支持：
 * - {{variable}}           → 简单替换
 * - {{variable|default}}   → 带默认值（变量未定义时使用默认值）
 * - {{#section}}...{{/section}} → 条件渲染（变量为 truthy 时才输出）
 *
 * 为什么不引入 Handlebars/Mustache？
 * - 它们的功能（循环、嵌套 helper）我们不需要
 * - 增加依赖体积（Handlebars ~60KB）
 * - 手写只需 40 行代码，完全够用
 *
 * 安全考量：
 * - 模板内容来自本地文件（SOUL.md），不受用户输入影响
 * - 不会执行任何代码，纯字符串替换
 *
 * v2.2: 初始实现
 */

/**
 * 渲染模板
 *
 * @param template - 包含 {{}} 占位符的模板字符串
 * @param context  - 变量键值对
 * @returns 渲染后的字符串
 */
export function renderTemplate(template: string, context: Record<string, unknown>): string {
  let result = template;

  // 1. 处理条件块 {{#section}}...{{/section}}
  // 先找出所有条件块，判断变量是否为 truthy
  const sectionRegex = /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
  result = result.replace(sectionRegex, (_match, key: string, body: string) => {
    const value = context[key];
    return value ? body : '';
  });

  // 2. 处理变量替换 {{variable}} 和 {{variable|default}}
  const varRegex = /\{\{(\w+)(?:\|([^}]*))?\}\}/g;
  result = result.replace(varRegex, (_match, key: string, defaultValue: string | undefined) => {
    const value = context[key];
    if (value === undefined || value === null || value === '') {
      return defaultValue !== undefined ? defaultValue : '';
    }
    return String(value);
  });

  // 3. 清理多余的空行（连续 3+ 个换行压缩为 2 个）
  result = result.replace(/\n{3,}/g, '\n\n');

  // 4. 清理行首尾空白（去掉条件渲染留下的空行）
  result = result
    .split('\n')
    .map(line => line.trimEnd())
    .join('\n')
    .trim();

  return result;
}
