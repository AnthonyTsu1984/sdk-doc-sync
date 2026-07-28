'use strict';

const fs = require('node:fs');
const path = require('node:path');

const CLASS_PATTERN = /\b(class|struct)\s+(?:(?:MILVUS_SDK_API|MILVUS_DEPRECATED)\s+)*([A-Za-z_]\w*)\s*(?::\s*([^{]+))?\s*\{/g;
const ALIAS_PATTERN = /\busing\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g;
const LEADING_METHOD_QUALIFIERS = /^(?:(?:static|virtual|inline|constexpr|friend|explicit)\s+)+/;
const INTERNAL_MUTATOR = /^(?:Set|With|Add|Start|Clear|Reset|Mutable|Emplace|Push|Swap|Assign|Release)/;

function lineNumberAt(content, index) {
  return content.slice(0, index).split('\n').length;
}

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function extractBracedBody(content, openingBraceIndex) {
  let depth = 0;
  let state = 'code';
  for (let index = openingBraceIndex; index < content.length; index += 1) {
    const character = content[index];
    const next = content[index + 1];
    if (state === 'line-comment') {
      if (character === '\n') state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      if (character === '*' && next === '/') {
        state = 'code';
        index += 1;
      }
      continue;
    }
    if (state === 'string') {
      if (character === '\\') index += 1;
      else if (character === '"') state = 'code';
      continue;
    }
    if (state === 'character') {
      if (character === '\\') index += 1;
      else if (character === "'") state = 'code';
      continue;
    }
    if (character === '/' && next === '/') {
      state = 'line-comment';
      index += 1;
    } else if (character === '/' && next === '*') {
      state = 'block-comment';
      index += 1;
    } else if (character === '"') {
      state = 'string';
    } else if (character === "'") {
      state = 'character';
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          body: content.slice(openingBraceIndex + 1, index),
          endIndex: index,
        };
      }
    }
  }
  return { body: content.slice(openingBraceIndex + 1), endIndex: content.length - 1 };
}

function stripLineComment(value) {
  const index = value.indexOf('//');
  return index >= 0 ? value.slice(0, index) : value;
}

function parseDoxygen(lines) {
  const text = lines
    .map((line) => line.replace(/^\s*\/\*\*?\s?/, '').replace(/^\s*\*\s?/, '').replace(/\*\/\s*$/, '').trim())
    .filter((line) => line && !line.startsWith('@param') && !line.startsWith('@return'))
    .map((line) => line.replace(/^@brief\s+/, ''))
    .join(' ')
    .trim();
  return text;
}

function parseParameters(value) {
  const parameters = [];
  let start = 0;
  let angleDepth = 0;
  let parenDepth = 0;
  for (let index = 0; index <= value.length; index += 1) {
    const character = value[index];
    if (character === '<') angleDepth += 1;
    else if (character === '>' && angleDepth > 0) angleDepth -= 1;
    else if (character === '(') parenDepth += 1;
    else if (character === ')' && parenDepth > 0) parenDepth -= 1;
    if ((character === ',' && angleDepth === 0 && parenDepth === 0) || index === value.length) {
      const declaration = value.slice(start, index).trim().replace(/\s*=\s*[\s\S]*$/, '').trim();
      start = index + 1;
      if (!declaration || declaration === 'void') continue;
      const match = declaration.match(/([A-Za-z_]\w*)\s*((?:\[[^\]]*\]\s*)*)$/);
      const name = match?.[1] || '';
      const arraySuffix = match?.[2]?.trim() || '';
      let type = match ? declaration.slice(0, match.index).trim() : declaration;
      if (arraySuffix) type = `${type}${arraySuffix}`;
      parameters.push({ name, type });
    }
  }
  return parameters;
}

function normalizeDeclaration(value) {
  return value
    .replace(/\[\[[^\]]+\]\]\s*/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s*;\s*$/, '')
    .trim();
}

function parseMemberDeclaration({ declaration, access, className, description, filePath, lineNumber }) {
  const normalized = normalizeDeclaration(declaration);
  if (!normalized || normalized.startsWith('using ') || normalized.startsWith('typedef ')) return null;

  const openParen = normalized.indexOf('(');
  if (openParen >= 0) {
    const preamble = normalized.slice(0, openParen).trim();
    const nameMatch = preamble.match(/(~?[A-Za-z_]\w*|operator\S*)$/);
    if (!nameMatch) return null;
    const name = nameMatch[1];
    const closeParen = normalized.lastIndexOf(')');
    if (closeParen < openParen) return null;
    const fullArgStr = normalized.slice(openParen + 1, closeParen).trim();
    const suffix = normalized.slice(closeParen + 1).trim();
    const type = preamble
      .slice(0, nameMatch.index)
      .trim()
      .replace(LEADING_METHOD_QUALIFIERS, '')
      .trim();
    const deleted = /=\s*delete\b/.test(suffix);
    const signature = `${type ? `${type} ` : ''}${name}(${fullArgStr})${/\bconst\b/.test(suffix) ? ' const' : ''}`;
    const common = {
      name,
      type,
      signature,
      fullSignature: signature,
      fullArgStr,
      inputs: parseParameters(fullArgStr),
      description,
      filePath,
      lineNumber,
      deleted,
      public: access === 'public',
    };
    if (name === className || name === `~${className}` || name.startsWith('operator')) return null;
    if (/^(?:With|Add)\w+/.test(name)) return { category: 'builder', member: common };
    const iteratorAccessor = /Iterator/.test(className) && /^(?:Next|HasNext|Done|Valid)/.test(name);
    const taskAccessor = /Task$/.test(className);
    const useful = access === 'public'
      && !INTERNAL_MUTATOR.test(name)
      && (/\bconst\b/.test(suffix) || fullArgStr === '' || iteratorAccessor || taskAccessor);
    return useful ? { category: 'accessor', member: common } : null;
  }

  if (access !== 'public' || /^(?:friend|static_assert)\b/.test(normalized)) return null;
  const withoutInitializer = normalized
    .replace(/\s*=\s*[\s\S]*$/, '')
    .replace(/\s*\{[\s\S]*\}\s*$/, '')
    .trim();
  const match = withoutInitializer.match(/([A-Za-z_]\w*)\s*((?:\[[^\]]*\]\s*)*)$/);
  if (!match) return null;
  const name = match[1];
  const arraySuffix = match[2]?.trim() || '';
  let type = withoutInitializer.slice(0, match.index).trim();
  if (!type || type === 'return') return null;
  if (arraySuffix) type = `${type}${arraySuffix}`;
  return {
    category: 'field',
    member: { name, type, description, filePath, lineNumber },
  };
}

function parsePublicMembers({ body, bodyStartLine, kind, className, filePath }) {
  const fields = [];
  const builders = [];
  const accessors = [];
  const lines = body.split('\n');
  let access = kind === 'struct' ? 'public' : 'private';
  let braceDepth = 0;
  let statement = '';
  let statementLine = bodyStartLine;
  let pendingDescription = '';
  let commentLines = [];
  let inBlockComment = false;

  const emit = () => {
    const parsed = parseMemberDeclaration({
      declaration: statement,
      access,
      className,
      description: pendingDescription,
      filePath,
      lineNumber: statementLine,
    });
    statement = '';
    pendingDescription = '';
    if (!parsed) return;
    if (parsed.category === 'field') fields.push(parsed.member);
    else if (parsed.category === 'builder' && (parsed.member.public || parsed.member.deleted)) builders.push(parsed.member);
    else if (parsed.category === 'accessor') accessors.push(parsed.member);
  };

  for (let offset = 0; offset < lines.length; offset += 1) {
    const sourceLine = lines[offset];
    const trimmed = sourceLine.trim();
    if (inBlockComment) {
      commentLines.push(sourceLine);
      if (trimmed.includes('*/')) {
        inBlockComment = false;
        pendingDescription = parseDoxygen(commentLines);
        commentLines = [];
      }
      continue;
    }
    if (trimmed.startsWith('/**')) {
      inBlockComment = !trimmed.includes('*/');
      commentLines = [sourceLine];
      if (!inBlockComment) {
        pendingDescription = parseDoxygen(commentLines);
        commentLines = [];
      }
      continue;
    }
    const code = stripLineComment(sourceLine).trim();
    if (!code) continue;
    if (braceDepth === 0) {
      const accessMatch = code.match(/^(public|protected|private)\s*:\s*$/);
      if (accessMatch) {
        if (statement) emit();
        access = accessMatch[1];
        continue;
      }
      if (!statement) statementLine = bodyStartLine + offset;
      statement = `${statement} ${code}`.trim();
      if (code.includes(';')) emit();
      else if (code.includes('{') && statement.includes('(')) emit();
    }
    for (const character of code) {
      if (character === '{') braceDepth += 1;
      else if (character === '}' && braceDepth > 0) braceDepth -= 1;
    }
    if (braceDepth === 0 && statement && code.includes('}')) statement = '';
  }
  if (statement) emit();
  return { fields, builders, accessors };
}

class CppTypeGraph {
  constructor({ rootDir, includeDir }) {
    this.rootDir = rootDir;
    this.includeDir = includeDir;
    this.nodes = new Map();
    this.aliases = new Map();
    this._scan();
    this._finalize();
  }

  _walkHeaderFiles(directory) {
    const results = [];
    if (!fs.existsSync(directory)) return results;
    const walk = (current) => {
      const entries = fs.readdirSync(current, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) walk(fullPath);
        else if (entry.name.endsWith('.h')) results.push(fullPath);
      }
    };
    walk(directory);
    return results;
  }

  _scan() {
    const files = ['request', 'response', 'types']
      .flatMap((directory) => this._walkHeaderFiles(path.join(this.includeDir, directory)));
    for (const file of files) this._scanFile(file);
  }

  _scanFile(file) {
    const content = fs.readFileSync(file, 'utf8');
    const filePath = toPosix(path.relative(this.rootDir, file));
    let aliasMatch;
    while ((aliasMatch = ALIAS_PATTERN.exec(content)) !== null) {
      this.aliases.set(aliasMatch[1], {
        name: aliasMatch[1],
        expression: aliasMatch[2].trim(),
        filePath,
        lineNumber: lineNumberAt(content, aliasMatch.index),
      });
    }

    let classMatch;
    while ((classMatch = CLASS_PATTERN.exec(content)) !== null) {
      const kind = classMatch[1];
      if (kind === 'class' && /\benum\s+$/.test(content.slice(Math.max(0, classMatch.index - 16), classMatch.index))) {
        continue;
      }
      const name = classMatch[2];
      const openingBraceIndex = CLASS_PATTERN.lastIndex - 1;
      const { body, endIndex } = extractBracedBody(content, openingBraceIndex);
      const lineNumber = lineNumberAt(content, classMatch.index);
      const members = parsePublicMembers({
        body,
        bodyStartLine: lineNumberAt(content, openingBraceIndex + 1),
        kind,
        className: name,
        filePath,
      });
      this.nodes.set(name, {
        name,
        kind,
        filePath,
        file,
        lineNumber,
        baseExpressions: classMatch[3]
          ? classMatch[3]
            .split(',')
            .map((base) => base.trim())
            .filter((base) => /^public\b/.test(base)
              || (kind === 'struct' && !/^(?:private|protected)\b/.test(base)))
          : [],
        baseClasses: [],
        aliases: [],
        relatedFiles: [],
        fields: members.fields,
        builders: members.builders,
        accessors: members.accessors,
        referencedTypes: [],
      });
      CLASS_PATTERN.lastIndex = endIndex + 1;
    }
  }

  _identifierCandidates(expression) {
    return String(expression || '')
      .match(/[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*/g)
      ?.map((name) => name.split('::').at(-1)) || [];
  }

  _resolveAlias(aliasName, seen = new Set()) {
    if (seen.has(aliasName)) return [];
    seen.add(aliasName);
    const alias = this.aliases.get(aliasName);
    if (!alias) return this.nodes.has(aliasName) ? [aliasName] : [];
    const resolved = [];
    for (const candidate of this._identifierCandidates(alias.expression)) {
      if (this.nodes.has(candidate)) resolved.push(candidate);
      else if (this.aliases.has(candidate)) resolved.push(...this._resolveAlias(candidate, new Set(seen)));
    }
    return [...new Set(resolved)];
  }

  resolveTypeNames(expression) {
    const resolved = [];
    for (const candidate of this._identifierCandidates(expression)) {
      if (this.nodes.has(candidate)) resolved.push(candidate);
      else if (this.aliases.has(candidate)) resolved.push(...this._resolveAlias(candidate));
    }
    return [...new Set(resolved)];
  }

  _finalize() {
    for (const aliasName of [...this.aliases.keys()].sort()) {
      for (const targetName of this._resolveAlias(aliasName)) {
        const node = this.nodes.get(targetName);
        if (node) {
          node.aliases.push(aliasName);
          node.relatedFiles.push(this.aliases.get(aliasName).filePath);
        }
      }
    }
    for (const node of this.nodes.values()) {
      node.aliases = [...new Set(node.aliases)].sort();
      node.relatedFiles = [...new Set(node.relatedFiles)].filter((file) => file !== node.filePath).sort();
      node.baseClasses = [...new Set(node.baseExpressions.flatMap((expression) => this.resolveTypeNames(expression)))]
        .filter((name) => name !== node.name);
      const memberExpressions = [
        ...node.baseExpressions,
        ...node.fields.map((field) => field.type),
        ...node.builders.flatMap((builder) => [builder.type, builder.fullArgStr]),
        ...node.accessors.flatMap((accessor) => [accessor.type, accessor.fullArgStr]),
      ];
      node.referencedTypes = [...new Set(memberExpressions.flatMap((expression) => this.resolveTypeNames(expression)))]
        .filter((name) => name !== node.name)
        .sort();
      for (const member of [...node.fields, ...node.builders, ...node.accessors]) {
        member.referencedTypes = [...new Set([
          ...this.resolveTypeNames(member.type),
          ...this.resolveTypeNames(member.fullArgStr),
        ])].filter((name) => name !== node.name).sort();
      }
    }
  }

  requestParamsFor(typeName) {
    const params = new Map();
    const visited = new Set();
    const collect = (name) => {
      if (visited.has(name)) return;
      visited.add(name);
      const node = this.nodes.get(name);
      if (!node) return;
      for (const baseName of node.baseClasses) collect(baseName);
      for (const builder of node.builders) {
        if (builder.deleted) params.delete(builder.name);
        else if (builder.public) params.set(builder.name, {
          name: builder.name,
          kind: 'keyword',
          type: builder.inputs[0]?.type || '',
          argName: builder.inputs[0]?.name || '',
          fullArgStr: builder.fullArgStr,
          fullSignature: builder.signature,
          description: builder.description || '',
          deleted: false,
          filePath: builder.filePath,
          lineNumber: builder.lineNumber,
        });
      }
    };
    for (const resolved of this.resolveTypeNames(typeName)) collect(resolved);
    return [...params.values()];
  }

  embeddedTypesFor(seedExpressions) {
    const visited = new Set();
    const visit = (name) => {
      if (visited.has(name)) return;
      const node = this.nodes.get(name);
      if (!node) return;
      visited.add(name);
      for (const referenced of node.referencedTypes) visit(referenced);
    };
    for (const expression of seedExpressions.filter(Boolean)) {
      for (const name of this.resolveTypeNames(expression)) visit(name);
    }
    return [...visited]
      .sort((left, right) => left.localeCompare(right))
      .map((name) => {
        const node = this.nodes.get(name);
        return {
          name: node.name,
          kind: node.kind,
          aliases: [...node.aliases],
          relatedFiles: [...node.relatedFiles],
          filePath: node.filePath,
          lineNumber: node.lineNumber,
          baseClasses: [...node.baseClasses],
          fields: node.fields.map((field) => ({ ...field })),
          builders: node.builders.filter((builder) => builder.public && !builder.deleted).map((builder) => ({ ...builder })),
          accessors: node.accessors.map((accessor) => ({ ...accessor })),
          referencedTypes: [...node.referencedTypes],
        };
      });
  }
}

module.exports = CppTypeGraph;
