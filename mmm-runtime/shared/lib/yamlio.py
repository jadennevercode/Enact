"""YAML load/dump for the suite, with no hard dependency on PyYAML.

Uses PyYAML when it is installed. When it is not, falls back to a parser for the
restricted subset the suite itself emits: block maps, block sequences, flow maps
and sequences one level deep, block scalars, comments, and plain scalars.

The dumper is always ours, so a file written on a machine with PyYAML and one
written without it are byte-identical. That matters: these files are diffed by
humans during review.
"""
from __future__ import annotations

import re

try:  # pragma: no cover - environment dependent
    import yaml as _pyyaml
except Exception:  # pragma: no cover
    _pyyaml = None

__all__ = ["load", "dump", "YamlError"]


class YamlError(ValueError):
    """Raised when a file cannot be parsed as the supported YAML subset."""


# ── loading ──────────────────────────────────────────────────────────

def load(text):
    """Parse YAML text into Python data. Returns {} for an empty document."""
    if _pyyaml is not None:
        data = _pyyaml.safe_load(text)
        return {} if data is None else data
    return _fallback_load(text)


def _fallback_load(text):
    lines = _significant_lines(text)
    if not lines:
        return {}
    value, index = _parse_block(lines, 0, lines[0][0])
    if index != len(lines):
        raise YamlError("unparsed content at line %d: %r" % (lines[index][2], lines[index][1]))
    return value


#: A key whose value is a block scalar: `shape: |`, `stdout: >-`, `when: |2`.
_BLOCK_HEADER = re.compile(r"(?:^|:\s*)([|>])([+-]?)(\d*)\s*$")


def _significant_lines(text):
    """[(indent, content, line_no, block)] with blank and comment-only lines removed.

    `block` is the assembled text of a block scalar, or None. Block scalars are
    resolved HERE, straight off the raw lines, because everything this function
    does to an ordinary line — dropping blanks, stripping `#` comments, throwing
    away indentation — is destructive inside a block scalar, where a blank line is
    a paragraph break, a `#` is a hash, and indentation is content. Reading them
    later from the digested lines silently reflowed every multi-line value.
    """
    raw_lines = text.splitlines()
    out, index = [], 0
    while index < len(raw_lines):
        raw = raw_lines[index]
        if raw.strip() in ("", "---", "..."):
            index += 1
            continue
        stripped = _strip_comment(raw)
        if not stripped.strip():
            index += 1
            continue
        indent = len(stripped) - len(stripped.lstrip(" "))
        content = stripped.strip()
        header = _BLOCK_HEADER.search(content)
        if header:
            block, index = _read_block_scalar(raw_lines, index + 1, indent, header)
            out.append((indent, content, index, block))
            continue
        out.append((indent, content, index + 1, None))
        index += 1
    return out


def _read_block_scalar(raw_lines, index, header_indent, header):
    """Assemble a block scalar from raw lines. Returns (text, next_index).

    Indentation is measured against the first non-blank line, so anything indented
    further than that keeps the difference — which is the whole point of writing a
    value as a block in the first place.
    """
    style, chomp, explicit = header.group(1), header.group(2), header.group(3)
    body, seen_content = [], False
    base = header_indent + int(explicit) if explicit else None
    while index < len(raw_lines):
        raw = raw_lines[index].rstrip("\r")
        if not raw.strip():
            body.append("")
            index += 1
            continue
        line_indent = len(raw) - len(raw.lstrip(" "))
        if line_indent <= header_indent:
            break
        if base is None:
            base = line_indent
        if line_indent < base:
            break
        body.append(raw[base:])
        seen_content = True
        index += 1
    if not seen_content:
        return ("" if chomp == "-" else "\n"), index
    while body and body[-1] == "":
        body.pop()

    if style == "|":
        text = "\n".join(body)
    else:
        # Folded: newlines inside a paragraph become spaces, a blank line becomes
        # the paragraph break. A more-indented line keeps its own line, per spec.
        chunks, buffer = [], []
        for line in body:
            if line == "":
                chunks.append(" ".join(buffer))
                buffer = []
            elif line.startswith(" "):
                if buffer:
                    chunks.append(" ".join(buffer))
                    buffer = []
                chunks.append(line)
            else:
                buffer.append(line)
        if buffer:
            chunks.append(" ".join(buffer))
        text = "\n".join(chunks)

    if chomp == "-":
        return text, index
    return text + "\n", index


def _strip_comment(line):
    out, quote = [], None
    for i, ch in enumerate(line):
        if quote:
            out.append(ch)
            if ch == quote and line[i - 1: i] != "\\":
                quote = None
            continue
        if ch in "\"'":
            quote = ch
            out.append(ch)
            continue
        if ch == "#" and (i == 0 or line[i - 1] in " \t"):
            break
        out.append(ch)
    return "".join(out).rstrip()


def _parse_block(lines, i, indent):
    if lines[i][1].startswith("- "):
        return _parse_seq(lines, i, indent)
    return _parse_map(lines, i, indent)


def _parse_map(lines, i, indent):
    result = {}
    while i < len(lines):
        line_indent, content, line_no, block = lines[i]
        if line_indent < indent:
            break
        if line_indent > indent:
            raise YamlError("unexpected indent at line %d: %r" % (line_no, content))
        if content.startswith("- "):
            break
        match = re.match(r"^(\"[^\"]*\"|'[^']*'|[^:]+):(?:\s+(.*))?$", content)
        if not match:
            raise YamlError("expected 'key: value' at line %d: %r" % (line_no, content))
        key = _scalar(match.group(1))
        rest = (match.group(2) or "").strip()
        if block is not None:
            value, i = block, i + 1
        elif rest == "":
            if i + 1 < len(lines) and lines[i + 1][0] > indent:
                value, i = _parse_block(lines, i + 1, lines[i + 1][0])
            elif i + 1 < len(lines) and lines[i + 1][0] == indent and lines[i + 1][1].startswith("- "):
                value, i = _parse_seq(lines, i + 1, indent)
            else:
                value, i = None, i + 1
        else:
            # A plain scalar may run on to the following, more-indented lines —
            # `what: 列名，用来对账。\n  **不给就对不了账**` is one value, not a value
            # and a stray line. Quoted and flow values do not fold, so they are
            # excluded rather than guessed at.
            value, i = _scalar(rest), i + 1
            if rest[:1] not in ('"', "'", "{", "["):
                folded = [rest]
                while (i < len(lines) and lines[i][0] > line_indent
                       and lines[i][3] is None
                       and not lines[i][1].startswith("- ")
                       and not _KEYISH.match(lines[i][1])):
                    folded.append(lines[i][1])
                    i += 1
                if len(folded) > 1:
                    value = _scalar(" ".join(folded))
        result[key] = value
    return result, i


def _parse_seq(lines, i, indent):
    items = []
    while i < len(lines):
        line_indent, content, line_no, _block = lines[i]
        if line_indent < indent or not content.startswith("- "):
            break
        if line_indent > indent:
            raise YamlError("unexpected indent at line %d: %r" % (line_no, content))
        body = content[2:].strip()
        child_indent = line_indent + 2
        # A quoted scalar is a scalar even when it contains a colon. Excluding the
        # quote characters from the bare-key alternative is what makes that true:
        # without it, `- "note, flag: x"` matched the bare-key branch at `flag`
        # and a list of strings silently became a list of one-key maps.
        if re.match(r"^(\"[^\"]*\"|'[^']*'|[^:{\[\"']+):(\s|$)", body):
            # a block map starting on the dash line
            synthetic = [(child_indent, body, line_no, None)]
            j = i + 1
            while j < len(lines) and lines[j][0] >= child_indent:
                synthetic.append(lines[j])
                j += 1
            value, consumed = _parse_map(synthetic, 0, child_indent)
            if consumed != len(synthetic):
                raise YamlError("unparsed list item at line %d" % line_no)
            items.append(value)
            i = j
        else:
            items.append(_scalar(body))
            i += 1
    return items, i


#: Looks like the start of a `key: value` pair, so it is NOT a continuation line.
_KEYISH = re.compile(r"^(\"[^\"]*\"|'[^']*'|[^:{\[\"']+):(\s|$)")

_INT = re.compile(r"^-?\d+$")
_FLOAT = re.compile(r"^-?\d+\.\d+$")


def _scalar(token):
    token = token.strip()
    if len(token) >= 2 and token[0] == token[-1] and token[0] in "\"'":
        body = token[1:-1]
        if token[0] != '"':
            return body
        # Order matters: unescape the escape character last, or "\\n" (a literal
        # backslash then n) comes back as a newline.
        out, index = [], 0
        while index < len(body):
            if body[index] == "\\" and index + 1 < len(body):
                nxt = body[index + 1]
                out.append({"n": "\n", "t": "\t", '"': '"', "\\": "\\"}.get(nxt, "\\" + nxt))
                index += 2
            else:
                out.append(body[index])
                index += 1
        return "".join(out)
    if token.startswith("{") and token.endswith("}"):
        return _flow_map(token[1:-1])
    if token.startswith("[") and token.endswith("]"):
        return [_scalar(p) for p in _split_flow(token[1:-1])] if token[1:-1].strip() else []
    low = token.lower()
    # `on`/`off` are booleans in the YAML PyYAML implements, and a client enum is
    # entirely capable of containing them. Leaving them out meant one parser read a
    # string where the other read a boolean.
    if low in ("true", "yes", "on"):
        return True
    if low in ("false", "no", "off"):
        return False
    if low in ("null", "~", ""):
        return None
    if _INT.match(token):
        return int(token)
    if _FLOAT.match(token):
        return float(token)
    return token


def _flow_map(body):
    result = {}
    for part in _split_flow(body):
        if not part.strip():
            continue
        key, _, value = part.partition(":")
        result[_scalar(key)] = _scalar(value)
    return result


def _split_flow(body):
    parts, depth, quote, current = [], 0, None, []
    for ch in body:
        if quote:
            current.append(ch)
            if ch == quote:
                quote = None
            continue
        if ch in "\"'":
            quote = ch
        elif ch in "{[":
            depth += 1
        elif ch in "}]":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append("".join(current))
            current = []
            continue
        current.append(ch)
    parts.append("".join(current))
    return parts


# ── dumping ──────────────────────────────────────────────────────────

def dump(data, indent=0):
    """Emit the suite's YAML style: block structure, flow maps for small leaves."""
    pad = " " * indent
    if isinstance(data, dict):
        if not data:
            return pad + "{}\n"
        out = []
        for key, value in data.items():
            rendered_key = _emit_key(key)
            if isinstance(value, dict) and value and _fits_inline(value):
                out.append("%s%s: %s\n" % (pad, rendered_key, _emit_flow(value)))
            elif isinstance(value, (dict, list)) and value:
                out.append("%s%s:\n" % (pad, rendered_key))
                out.append(dump(value, indent + 2))
            elif isinstance(value, (dict, list)):
                out.append("%s%s: %s\n" % (pad, rendered_key, "{}" if isinstance(value, dict) else "[]"))
            else:
                out.append("%s%s: %s\n" % (pad, rendered_key, _emit_scalar(value)))
        return "".join(out)
    if isinstance(data, list):
        if not data:
            return pad + "[]\n"
        out = []
        for item in data:
            if isinstance(item, dict) and item and not _fits_inline(item):
                body = dump(item, indent + 2)
                out.append(pad + "- " + body[indent + 2:])
            elif isinstance(item, dict) and item:
                out.append("%s- %s\n" % (pad, _emit_flow(item)))
            elif isinstance(item, list):
                # A row of a table — the profile's `scopeRows` is the reason this
                # branch exists. Without it a list of lists fell through to the
                # scalar emitter, which str()'d the inner list into "['A', 'B']"
                # and the reader read it back as one long string.
                out.append("%s- %s\n" % (pad, _emit_flow_seq(item)))
            else:
                out.append("%s- %s\n" % (pad, _emit_scalar(item)))
        return "".join(out)
    return pad + _emit_scalar(data) + "\n"


def _fits_inline(mapping):
    if len(mapping) > 4:
        return False
    if any(isinstance(v, (dict, list)) for v in mapping.values()):
        return False
    return len(_emit_flow(mapping)) <= 72


def _emit_flow(mapping):
    inner = ", ".join("%s: %s" % (_emit_key(k), _emit_scalar(v)) for k, v in mapping.items())
    return "{ %s }" % inner


def _emit_flow_seq(items):
    """A nested sequence, inline. Nested-in-nested is out of scope — nothing in
    the suite has one, and guessing at it would be inventing a shape."""
    return "[%s]" % ", ".join(
        _emit_flow(i) if isinstance(i, dict) else _emit_scalar(i) for i in items)


def _emit_key(key):
    text = str(key)
    return '"%s"' % text if re.search(r"[:#{}\[\],]|^\d|^\s|\s$", text) else text


_PLAIN_SAFE = re.compile(r"^[A-Za-z_][A-Za-z0-9_./·§+-]*$")


def _emit_scalar(value):
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if text and _PLAIN_SAFE.match(text) and text.lower() not in ("true", "false", "null", "yes", "no", "on", "off"):
        return text
    escaped = text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return '"%s"' % escaped
