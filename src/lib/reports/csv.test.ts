import { describe, expect, it } from 'vitest';

import { toCsv } from './csv';

describe('toCsv', () => {
  it('escreve o cabeçalho primeiro e depois as linhas', () => {
    expect(toCsv(['A', 'B'], [['1', '2']])).toBe('"A","B"\n"1","2"');
  });

  it('entre aspas todos os campos, inclusive os simples', () => {
    expect(toCsv(['name'], [['Ana']])).toBe('"name"\n"Ana"');
  });

  it('escapa aspas duplas embutidas dobrando-as', () => {
    expect(toCsv(['name'], [['João "Zé"']])).toBe('"name"\n"João ""Zé"""');
  });

  it('mantém vírgulas dentro de uma célula intactas', () => {
    expect(toCsv(['name'], [['Doe, John']])).toBe('"name"\n"Doe, John"');
  });

  it('mantém quebras de linha dentro de uma célula intactas', () => {
    expect(toCsv(['notes'], [['line1\nline2']])).toBe(
      '"notes"\n"line1\nline2"'
    );
  });

  it('coage números para string', () => {
    expect(toCsv(['v'], [[42, 3.5]])).toBe('"v"\n"42","3.5"');
  });

  it('retorna só o cabeçalho quando não há linhas', () => {
    expect(toCsv(['A', 'B'], [])).toBe('"A","B"');
  });

  it('números vazios de linhas nem quebram o arquivo', () => {
    expect(toCsv([], [])).toBe('');
  });
});
