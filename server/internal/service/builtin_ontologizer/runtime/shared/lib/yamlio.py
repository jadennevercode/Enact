"""YAML load/dump with a standard-library fallback.

PyYAML is used when present. When it is not, a subset parser handles the shapes
this package actually writes and the shapes its templates ask a human to fill in:
nested mappings, block sequences, scalars, quoted strings, flow lists/maps of
scalars, block scalars (| and >), and comments.

The fallback is deliberately strict: an unsupported construct raises YamlError
naming the line, because a parser that silently drops a key would let an artifact
pass a check it should have failed.
"""

from __future__ import annotations

import re
from typing import Any

import os

try:  # pragma: no cover - exercised by whichever branch the machine has
    import yaml as _pyyaml
except ImportError:  # pragma: no cover
    _pyyaml = None

if os.environ.get("ONTOLOGIZER_NO_PYYAML"):
    # Set this to exercise the fallback on a machine that happens to have PyYAML.
    # The target machine often does not, and a fallback nobody runs is a fallback
    # that is broken.
    _pyyaml = None


class YamlError(ValueError):
    """Raised when the fallback parser meets something it will not guess at."""


# --------------------------------------------------------------------------- #
# public API
# --------------------------------------------------------------------------- #

def load(text: str) -> Any:
    if _pyyaml is not None:
        return _pyyaml.safe_load(text)
    return _fallback_load(text)


def load_path(path) -> Any:
    with open(path, "r", encoding="utf-8") as handle:
        return load(handle.read())


def dump(data: Any) -> str:
    if _pyyaml is not None:
        return _pyyaml.safe_dump(
            data, allow_unicode=True, sort_keys=False, default_flow_style=False, width=100
        )
    return _fallback_dump(data)


def dump_path(path, data: Any) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(dump(data))


def has_pyyaml() -> bool:
    return _pyyaml is not None


# --------------------------------------------------------------------------- #
# fallback parser
# --------------------------------------------------------------------------- #

_FLOW_LIST = re.compile(r"^\[(.*)\]$", re.S)
_FLOW_MAP = re.compile(r"^\{(.*)\}$", re.S)


def _scalar(raw: str, line_no: int) -> Any:
    text = raw.strip()
    if text == "" or text == "~" or text.lower() == "null":
        return None
    if text[0] in "\"'" and len(text) > 1 and text[-1] == text[0]:
        return text[1:-1]
    flow_list = _FLOW_LIST.match(text)
    if flow_list:
        inner = flow_list.group(1).strip()
        if not inner:
            return []
        return [_scalar(part, line_no) for part in _split_flow(inner)]
    flow_map = _FLOW_MAP.match(text)
    if flow_map:
        inner = flow_map.group(1).strip()
        result: dict = {}
        if not inner:
            return result
        for part in _split_flow(inner):
            if ":" not in part:
                raise YamlError(f"line {line_no}: flow mapping entry without ':': {part!r}")
            key, _, value = part.partition(":")
            result[key.strip().strip("\"'")] = _scalar(value, line_no)
        return result
    low = text.lower()
    if low in ("true", "yes", "on"):
        return True
    if low in ("false", "no", "off"):
        return False
    try:
        return int(text)
    except ValueError:
        pass
    try:
        return float(text)
    except ValueError:
        pass
    return text


def _split_flow(inner: str) -> list[str]:
    parts, depth, current, quote = [], 0, [], None
    for char in inner:
        if quote:
            current.append(char)
            if char == quote:
                quote = None
            continue
        if char in "\"'":
            quote = char
            current.append(char)
        elif char in "[{":
            depth += 1
            current.append(char)
        elif char in "]}":
            depth -= 1
            current.append(char)
        elif char == "," and depth == 0:
            parts.append("".join(current))
            current = []
        else:
            current.append(char)
    if current:
        parts.append("".join(current))
    return [part.strip() for part in parts if part.strip()]


def _flow_depth(text: str) -> int:
    depth, quote = 0, None
    for char in text:
        if quote:
            if char == quote:
                quote = None
            continue
        if char in "\"'":
            quote = char
        elif char in "[{":
            depth += 1
        elif char in "]}":
            depth -= 1
    return depth


def _gather_flow(lines, index, first: str):
    """Flow sequences and mappings may span lines. Collect until brackets balance."""
    parts = [first]
    depth = _flow_depth(first)
    while depth > 0 and index < len(lines):
        parts.append(lines[index].text)
        depth += _flow_depth(lines[index].text)
        index += 1
    return " ".join(parts), index


class _Line:
    __slots__ = ("indent", "text", "no")

    def __init__(self, indent: int, text: str, no: int):
        self.indent, self.text, self.no = indent, text, no


def _tokenize(text: str) -> list[_Line]:
    lines: list[_Line] = []
    for index, raw in enumerate(text.splitlines(), start=1):
        if "\t" in raw[: len(raw) - len(raw.lstrip())]:
            raise YamlError(f"line {index}: tab used for indentation")
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped == "---":
            continue
        if stripped.startswith("- ") or stripped == "-":
            body = stripped
        else:
            body = _strip_comment(stripped)
            if not body:
                continue
        lines.append(_Line(len(raw) - len(raw.lstrip()), body, index))
    return lines


def _strip_comment(text: str) -> str:
    quote = None
    for pos, char in enumerate(text):
        if quote:
            if char == quote:
                quote = None
            continue
        if char in "\"'":
            quote = char
        elif char == "#" and (pos == 0 or text[pos - 1] in " \t"):
            return text[:pos].rstrip()
    return text.rstrip()


def _fallback_load(text: str) -> Any:
    lines = _tokenize(text)
    if not lines:
        return None
    value, index = _parse_block(lines, 0, lines[0].indent, text.splitlines())
    if index != len(lines):
        raise YamlError(f"line {lines[index].no}: unexpected indentation")
    return value


def _parse_block(lines, index, indent, raw_lines):
    if lines[index].text.startswith("-"):
        return _parse_sequence(lines, index, indent, raw_lines)
    return _parse_mapping(lines, index, indent, raw_lines)


def _parse_sequence(lines, index, indent, raw_lines):
    items = []
    while index < len(lines) and lines[index].indent == indent and lines[index].text.startswith("-"):
        line = lines[index]
        rest = line.text[1:].strip()
        if not rest:
            index += 1
            if index < len(lines) and lines[index].indent > indent:
                value, index = _parse_block(lines, index, lines[index].indent, raw_lines)
                items.append(value)
            else:
                items.append(None)
            continue
        if ":" in rest and not rest.startswith(("\"", "'", "[", "{")):
            synthetic = [_Line(indent + 2, rest, line.no)]
            follow = index + 1
            while follow < len(lines) and lines[follow].indent > indent:
                synthetic.append(lines[follow])
                follow += 1
            value, consumed = _parse_mapping(synthetic, 0, indent + 2, raw_lines)
            if consumed != len(synthetic):
                raise YamlError(f"line {line.no}: could not parse sequence item")
            items.append(value)
            index = follow
            continue
        items.append(_scalar(rest, line.no))
        index += 1
    return items, index


def _parse_mapping(lines, index, indent, raw_lines):
    result: dict = {}
    while index < len(lines) and lines[index].indent == indent:
        line = lines[index]
        if line.text.startswith("-"):
            break
        if ":" not in line.text:
            raise YamlError(f"line {line.no}: expected 'key: value', got {line.text!r}")
        key, _, rest = line.text.partition(":")
        key = key.strip().strip("\"'")
        rest = rest.strip()
        index += 1
        if rest in ("|", ">", "|-", ">-"):
            block, index = _parse_block_scalar(lines, index, indent, raw_lines, rest)
            result[key] = block
            continue
        if rest:
            if rest[0] in "[{" and _flow_depth(rest) > 0:
                rest, index = _gather_flow(lines, index, rest)
            result[key] = _scalar(rest, line.no)
            continue
        if (
            index < len(lines)
            and lines[index].indent > indent
            and lines[index].text[:1] in "[{"
        ):
            # A flow collection written on the line(s) after its key.
            text, index = _gather_flow(lines, index + 1, lines[index].text)
            result[key] = _scalar(text, line.no)
            continue
        if index < len(lines) and lines[index].indent > indent:
            value, index = _parse_block(lines, index, lines[index].indent, raw_lines)
            result[key] = value
        elif index < len(lines) and lines[index].indent == indent and lines[index].text.startswith("-"):
            value, index = _parse_sequence(lines, index, indent, raw_lines)
            result[key] = value
        else:
            result[key] = None
    return result, index


def _parse_block_scalar(lines, index, indent, raw_lines, style):
    collected = []
    while index < len(lines) and lines[index].indent > indent:
        collected.append(lines[index].text)
        index += 1
    joined = "\n".join(collected) if style.startswith("|") else " ".join(collected)
    # "|" and ">" keep one trailing newline (clip); "|-" and ">-" strip it.
    if joined and not style.endswith("-"):
        joined += "\n"
    return joined, index


# --------------------------------------------------------------------------- #
# fallback emitter
# --------------------------------------------------------------------------- #

_PLAIN = re.compile(r"^[A-Za-z0-9_\-./@:+一-鿿][^:#\n]*$")


def _looks_numeric(text: str) -> bool:
    """A string like "1" must be quoted, or it comes back as an int. Cardinality
    values are exactly this case, and a cardinality that silently became a number
    would compare unequal to the one the parent revision recorded."""
    try:
        int(text)
        return True
    except ValueError:
        pass
    try:
        float(text)
        return True
    except ValueError:
        return False


def _emit_scalar(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if text == "":
        return '""'
    if "\n" in text:
        return None  # handled by caller as a block scalar
    needs_quote = (
        not _PLAIN.match(text)
        or text.strip() != text
        or text.lower() in ("true", "false", "null", "yes", "no", "on", "off")
        or text.endswith(":")
        or _looks_numeric(text)
    )
    if needs_quote:
        return '"' + text.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return text


def _fallback_dump(data: Any, indent: int = 0) -> str:
    pad = " " * indent
    if isinstance(data, dict):
        if not data:
            return pad + "{}\n"
        out = []
        for key, value in data.items():
            key_text = _emit_scalar(str(key)) or str(key)
            if isinstance(value, (dict, list)) and value:
                out.append(f"{pad}{key_text}:\n")
                out.append(_fallback_dump(value, indent + 2))
            elif isinstance(value, (dict, list)):
                out.append(f"{pad}{key_text}: {'{}' if isinstance(value, dict) else '[]'}\n")
            else:
                scalar = _emit_scalar(value)
                if scalar is None:
                    # "|-" strips the final newline, matching the value in hand;
                    # plain "|" would add one and the round-trip would not be exact.
                    style = "|" if str(value).endswith("\n") else "|-"
                    out.append(f"{pad}{key_text}: {style}\n")
                    for line in str(value).splitlines():
                        out.append(f"{pad}  {line}\n")
                else:
                    out.append(f"{pad}{key_text}: {scalar}\n")
        return "".join(out)
    if isinstance(data, list):
        if not data:
            return pad + "[]\n"
        out = []
        for item in data:
            if isinstance(item, (dict, list)) and item:
                rendered = _fallback_dump(item, indent + 2)
                first, _, remainder = rendered.partition("\n")
                out.append(f"{pad}- {first.strip()}\n")
                if remainder.strip():
                    out.append(remainder if remainder.endswith("\n") else remainder + "\n")
            else:
                scalar = _emit_scalar(item)
                out.append(f"{pad}- {scalar if scalar is not None else ''}\n")
        return "".join(out)
    scalar = _emit_scalar(data)
    return f"{pad}{scalar}\n"
