/**
 * 主题色板 —— 贴图模板.html 与 导出SVG.js 共用同一份定义
 *
 * 命名约定：
 *   xxx + "Rgb"  形如 "140,190,235"，给 CSS 的 rgba(var(--x), a) 用
 *   其余为十六进制色值
 *
 * 新增一套配色的最小改动：在这里加一个 key，其余不用动。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.THEMES = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  return {
    blue: {
      label: '蓝白 · 默认',
      bgFrom: '#E7F1FB', bgMid: '#F6FAFD', bgTo: '#DDEBF8',
      blobRgb: '140,190,235', blobOp: 0.5,
      badge: '#10294B',
      title: '#16324F',
      mistRgb: '186,220,238',
      card: '#16365C',
      cardDeep: '#0F2E52',
      barTop: '#0F2E52', barBot: '#1D4E80',
      line: '#2FBF8F',
      hlFill: '#E8622A', hlStroke: '#E8622A',
      bar2: '#2E7DD1',
      pillFrom: '#FF7A45', pillTo: '#F2451B', pillBorder: '#FFD9C7',
      thumbFrom: '#EAF3FC', thumbTo: '#CDE2F5', thumbText: '#2E6FA8',
      soft: '#E6F1FB', softLine: '#A9C8E4',
      axis: '#344054', ink: '#101828', foot: '#7A8798',
      grid: '#E6ECF4', split: '#DDE6F0', xLabel: '#1D2939'
    },

    red: {
      label: '中国红 · 金榜',
      bgFrom: '#FDEDE8', bgMid: '#FFF9F6', bgTo: '#F9DFD7',
      blobRgb: '240,166,140', blobOp: 0.45,
      badge: '#7A1F1B',
      title: '#4A1512',
      mistRgb: '247,206,192',
      card: '#7A1F1B',
      cardDeep: '#5C130F',
      barTop: '#7A1F1B', barBot: '#C0392B',
      line: '#C9971A',
      hlFill: '#5C130F', hlStroke: '#FFB800',
      bar2: '#C0392B',
      pillFrom: '#E8623F', pillTo: '#B9311F', pillBorder: '#FFDCCF',
      thumbFrom: '#FBE4DC', thumbTo: '#F5C9BC', thumbText: '#B9311F',
      soft: '#FBE6DF', softLine: '#E3A695',
      axis: '#5A3A34', ink: '#2B1512', foot: '#9B7A73',
      grid: '#F5E0D9', split: '#F0D5CC', xLabel: '#3A1F1A'
    },

    green: {
      label: '墨绿 · 理性',
      bgFrom: '#E6F2ED', bgMid: '#F7FBF9', bgTo: '#D4E8DF',
      blobRgb: '127,191,168', blobOp: 0.45,
      badge: '#0F3A2E',
      title: '#123B2E',
      mistRgb: '190,224,211',
      card: '#0F3A2E',
      cardDeep: '#0B2E24',
      barTop: '#0B2E24', barBot: '#1F6B52',
      line: '#E0A63C',
      hlFill: '#123B2E', hlStroke: '#E8663E',
      bar2: '#2E8B6F',
      pillFrom: '#E07B39', pillTo: '#C25A1E', pillBorder: '#FBDCC4',
      thumbFrom: '#DCEFE7', thumbTo: '#B7D9CB', thumbText: '#1F6B52',
      soft: '#E2F0EA', softLine: '#9CC4B5',
      axis: '#2F4F45', ink: '#10241E', foot: '#7E968C',
      grid: '#DFEDE7', split: '#D6E5DE', xLabel: '#1A3A2F'
    },

    amber: {
      label: '暖橙 · 米色',
      bgFrom: '#FDF0DC', bgMid: '#FFFBF4', bgTo: '#F7E2C4',
      blobRgb: '232,181,120', blobOp: 0.45,
      badge: '#6B4318',
      title: '#4A2F10',
      mistRgb: '245,217,176',
      card: '#6B4318',
      cardDeep: '#54330F',
      barTop: '#8A5A1E', barBot: '#C4822E',
      line: '#3E8E7E',
      hlFill: '#54330F', hlStroke: '#E8622A',
      bar2: '#C4822E',
      pillFrom: '#E07B39', pillTo: '#BF5A1E', pillBorder: '#FBE0C6',
      thumbFrom: '#FAEBD4', thumbTo: '#F0D5AA', thumbText: '#B07530',
      soft: '#F7E7CE', softLine: '#DCBB88',
      axis: '#5C4630', ink: '#2E1F0A', foot: '#9A8468',
      grid: '#F2E3CE', split: '#EEDAC2', xLabel: '#3D2A14'
    },

    ink: {
      label: '墨黑 · 极简',
      bgFrom: '#EFEFEF', bgMid: '#FAFAFA', bgTo: '#E3E3E3',
      blobRgb: '184,184,184', blobOp: 0.35,
      badge: '#111111',
      title: '#111111',
      mistRgb: '216,216,216',
      card: '#111111',
      cardDeep: '#000000',
      barTop: '#1A1A1A', barBot: '#4A4A4A',
      line: '#D94F2B',
      hlFill: '#111111', hlStroke: '#D94F2B',
      bar2: '#4A4A4A',
      pillFrom: '#D94F2B', pillTo: '#A83217', pillBorder: '#EFC3B6',
      thumbFrom: '#EDEDED', thumbTo: '#D4D4D4', thumbText: '#333333',
      soft: '#EDEDED', softLine: '#B4B4B4',
      axis: '#444444', ink: '#111111', foot: '#8A8A8A',
      grid: '#E8E8E8', split: '#E0E0E0', xLabel: '#222222'
    }
  };
});
