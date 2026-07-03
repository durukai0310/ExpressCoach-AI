/**
 * 统一文件读取模块 — src/lib/fs-utils.js (W5 Day 31)
 *
 * 从各模块提取的公共文件读取函数。
 */

const fs = require("fs");
const { color, C } = require("./color");

/**
 * 读取文件内容，失败时打印错误并返回 null
 *
 * @param {string} filePath - 文件绝对路径
 * @param {string} label - 文件标签（用于错误提示）
 * @returns {string|null} 文件内容，失败返回 null
 */
function loadFile(filePath, label) {
  if (!fs.existsSync(filePath)) {
    console.error(color(C.red, `❌ ${label} 未找到: ${filePath}`));
    return null;
  }
  return fs.readFileSync(filePath, "utf-8");
}

module.exports = { loadFile };
