/**
 * 统一终端颜色模块 — src/lib/color.js (W5 Day 31)
 *
 * 从各模块提取的公共颜色常量和着色函数。
 * 统一使用本模块，避免各文件重复定义 C 和 color/c 函数。
 */

const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

/**
 * 给文本加上终端颜色
 * @param {string} code - ANSI 颜色代码 (如 C.red)
 * @param {string} text - 要着色的文本
 * @returns {string} 着色后的文本（如果 NO_COLOR 或非 TTY 则返回原文）
 */
function color(code, text) {
  if (process.env.NO_COLOR || !process.stdout.isTTY) return text;
  return code + text + C.reset;
}

// c = color 的短别名（兼容 sandbox.js 等文件）
function c(code, text) {
  return color(code, text);
}

module.exports = { C, color, c };
