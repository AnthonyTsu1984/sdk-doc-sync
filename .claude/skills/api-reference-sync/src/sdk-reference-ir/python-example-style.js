'use strict';

function lineNumberAt(source, index) {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === '\n') line += 1;
  }
  return line;
}

function skipString(source, start) {
  const quote = source[start];
  const triple = source.slice(start, start + 3) === quote.repeat(3);
  let cursor = start + (triple ? 3 : 1);
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (triple ? source.slice(cursor, cursor + 3) === quote.repeat(3) : source[cursor] === quote) {
      return cursor + (triple ? 3 : 1);
    }
    cursor += 1;
  }
  return source.length;
}

function matchingParen(source, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = ['('];
  for (let cursor = open + 1; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    if (char === '"' || char === "'") {
      cursor = skipString(source, cursor) - 1;
      continue;
    }
    if (char === '#') {
      const newline = source.indexOf('\n', cursor);
      if (newline === -1) return -1;
      cursor = newline;
      continue;
    }
    if (pairs[char]) stack.push(char);
    else if (Object.values(pairs).includes(char)) {
      const expected = pairs[stack.at(-1)];
      if (char !== expected) return -1;
      stack.pop();
      if (stack.length === 0) return cursor;
    }
  }
  return -1;
}

function isCallOpen(source, open) {
  const prefix = source.slice(0, open);
  const match = prefix.match(/(?:^|[^\w])((?:[A-Za-z_]\w*\.)*[A-Za-z_]\w*)\s*$/);
  if (!match) return false;
  const before = prefix.slice(0, match.index + (match[0].length - match[1].length));
  return !/(?:^|\s)(?:def|class)\s*$/.test(before);
}

function topLevelArguments(source, open, close) {
  const args = [];
  const stack = [];
  let start = open + 1;
  for (let cursor = open + 1; cursor < close; cursor += 1) {
    const char = source[cursor];
    if (char === '"' || char === "'") {
      cursor = skipString(source, cursor) - 1;
      continue;
    }
    if (char === '#') {
      const newline = source.indexOf('\n', cursor);
      cursor = newline === -1 || newline > close ? close : newline;
      continue;
    }
    if ('([{'.includes(char)) stack.push(char);
    else if (')]}'.includes(char)) stack.pop();
    else if (char === ',' && stack.length === 0) {
      args.push({ start, end: cursor });
      start = cursor + 1;
    }
  }
  if (source.slice(start, close).trim() !== '') args.push({ start, end: close });
  return args.map((arg) => {
    const raw = source.slice(arg.start, arg.end);
    const leading = raw.search(/\S/);
    const trailing = raw.search(/\s*$/);
    const contentStart = leading === -1 ? arg.start : arg.start + leading;
    const contentEnd = arg.start + trailing;
    return {
      text: raw.trim(),
      startLine: lineNumberAt(source, contentStart),
      endLine: lineNumberAt(source, Math.max(contentStart, contentEnd - 1)),
    };
  });
}

function pythonExampleCallLayoutDiagnostics(source) {
  if (typeof source !== 'string' || source.trim() === '') return [];
  const diagnostics = [];
  for (let open = 0; open < source.length; open += 1) {
    if (source[open] !== '(' || !isCallOpen(source, open)) continue;
    const close = matchingParen(source, open);
    if (close === -1) continue;
    const args = topLevelArguments(source, open, close);
    const hasKeyword = args.some((arg) => /^(?:\*\*)?[A-Za-z_]\w*\s*=/.test(arg.text));
    if (args.length < 2 || !hasKeyword) continue;
    const openLine = lineNumberAt(source, open);
    const closeLine = lineNumberAt(source, close);
    const argumentLines = args.map((arg) => arg.startLine);
    const onePerLine = new Set(argumentLines).size === argumentLines.length;
    const delimitersHaveOwnLines = args[0].startLine > openLine && args.at(-1).endLine < closeLine;
    if (!onePerLine || !delimitersHaveOwnLines) {
      diagnostics.push({
        line: openLine,
        code: 'PYTHON_CALL_ARGUMENTS_NOT_MULTILINE',
        message: 'Python example calls with multiple arguments must put the opening parenthesis, each argument, and the closing parenthesis on separate lines.',
      });
    }
  }
  return diagnostics;
}

module.exports = { pythonExampleCallLayoutDiagnostics };
