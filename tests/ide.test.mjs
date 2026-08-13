import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getIdeSeries, getSuggest, resolveMcpPrefix } from '../src/ide.mjs';

describe('getIdeSeries()', () => {
  it('detects IntelliJ IDEA', () => {
    assert.equal(getIdeSeries('IntelliJ IDEA'), 'idea');
  });

  it('detects WebStorm', () => {
    assert.equal(getIdeSeries('WebStorm'), 'webstorm');
  });

  it('detects PyCharm', () => {
    assert.equal(getIdeSeries('PyCharm Community Edition'), 'pycharm');
  });

  it('detects GoLand', () => {
    assert.equal(getIdeSeries('GoLand'), 'goland');
  });

  it('detects RustRover', () => {
    assert.equal(getIdeSeries('RustRover'), 'rustrover');
  });

  it('detects CLion', () => {
    assert.equal(getIdeSeries('CLion'), 'clion');
  });

  it('detects PhpStorm', () => {
    assert.equal(getIdeSeries('PhpStorm'), 'phpstorm');
  });

  it('returns default for unknown IDE', () => {
    assert.equal(getIdeSeries('VS Code'), 'default');
  });

  it('is case insensitive', () => {
    assert.equal(getIdeSeries('intellij idea'), 'idea');
    assert.equal(getIdeSeries('WEBSTORM'), 'webstorm');
    assert.equal(getIdeSeries('pycharm'), 'pycharm');
  });

  it('returns default for empty string', () => {
    assert.equal(getIdeSeries(''), 'default');
  });

  it('returns default for undefined input', () => {
    assert.equal(getIdeSeries(), 'default');
  });

  it('detects IntelliJ from partial name', () => {
    assert.equal(getIdeSeries('IntelliJ IDEA Ultimate Edition 2024.1'), 'idea');
  });

  it('detects IDEA keyword alone', () => {
    assert.equal(getIdeSeries('IDEA'), 'idea');
  });
});

describe('getSuggest()', () => {
  it('returns suggestion for known action: search', () => {
    assert.equal(getSuggest('idea', 'search'), 'search_symbol 或 search_regex');
  });

  it('returns suggestion for known action: read', () => {
    assert.equal(getSuggest('idea', 'read'), 'read_file');
  });

  it('returns suggestion for known action: write', () => {
    assert.equal(getSuggest('idea', 'write'), 'create_new_file');
  });

  it('returns suggestion for known action: edit', () => {
    assert.equal(getSuggest('idea', 'edit'), 'apply_patch');
  });

  it('returns suggestion for known action: list', () => {
    assert.equal(getSuggest('idea', 'list'), 'list_directory_tree');
  });

  it('returns suggestion for known action: bash', () => {
    assert.equal(getSuggest('idea', 'bash'), 'execute_terminal_command');
  });

  it('returns action name for unknown action', () => {
    assert.equal(getSuggest('idea', 'unknown'), 'unknown');
  });

  it('returns action name regardless of series', () => {
    // getSuggest does not use series parameter; verify it works with any series
    assert.equal(getSuggest('webstorm', 'search'), 'search_symbol 或 search_regex');
    assert.equal(getSuggest('default', 'read'), 'read_file');
  });
});

describe('resolveMcpPrefix()', () => {
  it('returns correct prefix for idea', () => {
    assert.equal(resolveMcpPrefix('idea'), 'JetBrains-IDEA');
  });

  it('returns correct prefix for webstorm', () => {
    assert.equal(resolveMcpPrefix('webstorm'), 'JetBrains-WebStorm');
  });

  it('returns correct prefix for pycharm', () => {
    assert.equal(resolveMcpPrefix('pycharm'), 'JetBrains-PyCharm');
  });

  it('returns correct prefix for goland', () => {
    assert.equal(resolveMcpPrefix('goland'), 'JetBrains-GoLand');
  });

  it('returns correct prefix for rustrover', () => {
    assert.equal(resolveMcpPrefix('rustrover'), 'JetBrains-RustRover');
  });

  it('returns correct prefix for clion', () => {
    assert.equal(resolveMcpPrefix('clion'), 'JetBrains-CLion');
  });

  it('returns correct prefix for phpstorm', () => {
    assert.equal(resolveMcpPrefix('phpstorm'), 'JetBrains-PhpStorm');
  });

  it('returns default prefix for unknown series', () => {
    assert.equal(resolveMcpPrefix('unknown'), 'JetBrains-IDE');
  });

  it('returns default prefix for empty string', () => {
    assert.equal(resolveMcpPrefix(''), 'JetBrains-IDE');
  });
});
