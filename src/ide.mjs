/**
 * JetBrains IDE series lookup and MCP tool suggestion module
 */

const IDE_SERIES = [
  { keywords: ['intellij', 'idea'], series: 'idea' },
  { keywords: ['webstorm'], series: 'webstorm' },
  { keywords: ['pycharm'], series: 'pycharm' },
  { keywords: ['goland'], series: 'goland' },
  { keywords: ['rustrover'], series: 'rustrover' },
  { keywords: ['clion'], series: 'clion' },
  { keywords: ['phpstorm'], series: 'phpstorm' },
  { keywords: ['rubymine'], series: 'rubymine' },
  { keywords: ['rider'], series: 'rider' },
];

const MCP_PREFIXES = {
  idea: 'IDEA',
  webstorm: 'WebStorm',
  pycharm: 'PyCharm',
  goland: 'GoLand',
  rustrover: 'RustRover',
  clion: 'CLion',
  phpstorm: 'PhpStorm',
  rubymine: 'RubyMine',
  rider: 'Rider',
  default: 'IDE',
};

const SUGGESTIONS = {
  search: 'search_symbol 或 search_regex',
  read: 'read_file',
  write: 'create_new_file',
  edit: 'apply_patch',
  list: 'list_directory_tree',
  bash: 'execute_terminal_command',
};

export function getIdeSeries(ideName = '') {
  const lower = ideName.toLowerCase();
  return IDE_SERIES.find(({ keywords }) =>
    keywords.some(kw => lower.includes(kw))
  )?.series ?? 'default';
}

export function getSuggest(series, action) {
  return SUGGESTIONS[action] ?? action;
}

export function resolveMcpPrefix(series) {
  return MCP_PREFIXES[series] ?? MCP_PREFIXES.default;
}
