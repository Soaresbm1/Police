using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Caseline.Reconstruction
{
    /// <summary>
    /// Phase U5.2 — a small, self-contained, dependency-free JSON parser
    /// (no external package, per this phase's explicit "do not add external
    /// packages" instruction). Exists for exactly one reason:
    /// `UnityEngine.JsonUtility` silently ignores any JSON field it doesn't
    /// recognize, which makes it impossible to prove a
    /// ReconstructionScenario payload does NOT smuggle an extra,
    /// unexpected field (a raw `culpritId`, a `seed`, ...) — see
    /// `ReconstructionJsonLoader`, the only caller of this parser, for the
    /// strict allowlist validation this makes possible.
    ///
    /// Parses into a generic tree of `Dictionary&lt;string, object&gt;`,
    /// `List&lt;object&gt;`, `string`, `double`, `bool`, or `null` — never
    /// throws on malformed input, returns `false` instead (matching every
    /// other loader in this codebase's "reject cleanly" convention).
    /// </summary>
    public static class ReconstructionMiniJson
    {
        public static bool TryParse(string json, out object root, out string error)
        {
            root = null;
            error = null;
            if (json == null)
            {
                error = "JSON text is null.";
                return false;
            }
            var parser = new Parser(json);
            try
            {
                parser.SkipWhitespace();
                if (!parser.TryParseValue(out root, out error)) return false;
                parser.SkipWhitespace();
                if (!parser.AtEnd)
                {
                    error = $"Unexpected trailing content at position {parser.Position}.";
                    return false;
                }
                return true;
            }
            catch (System.Exception e)
            {
                error = $"JSON parse error: {e.Message}";
                return false;
            }
        }

        private sealed class Parser
        {
            private readonly string _s;
            private int _i;

            public Parser(string s)
            {
                _s = s;
                _i = 0;
            }

            public int Position => _i;
            public bool AtEnd => _i >= _s.Length;
            private char Cur => _s[_i];

            public void SkipWhitespace()
            {
                while (_i < _s.Length && (_s[_i] == ' ' || _s[_i] == '\t' || _s[_i] == '\n' || _s[_i] == '\r')) _i++;
            }

            public bool TryParseValue(out object value, out string error)
            {
                value = null;
                error = null;
                if (AtEnd)
                {
                    error = "Unexpected end of JSON.";
                    return false;
                }
                switch (Cur)
                {
                    case '{': return TryParseObject(out value, out error);
                    case '[': return TryParseArray(out value, out error);
                    case '"': return TryParseString(out var s, out error) ? Assign(out value, s) : Fail(out value, error);
                    case 't':
                        if (Match("true")) return Assign(out value, (object)true);
                        error = $"Invalid literal at position {_i}.";
                        return false;
                    case 'f':
                        if (Match("false")) return Assign(out value, (object)false);
                        error = $"Invalid literal at position {_i}.";
                        return false;
                    case 'n':
                        if (Match("null")) return Assign(out value, null);
                        error = $"Invalid literal at position {_i}.";
                        return false;
                    default:
                        return TryParseNumber(out value, out error);
                }
            }

            private static bool Assign(out object value, object v)
            {
                value = v;
                return true;
            }

            private static bool Fail(out object value, string _)
            {
                value = null;
                return false;
            }

            private bool Match(string literal)
            {
                if (_i + literal.Length > _s.Length) return false;
                for (var k = 0; k < literal.Length; k++)
                {
                    if (_s[_i + k] != literal[k]) return false;
                }
                _i += literal.Length;
                return true;
            }

            private bool TryParseObject(out object value, out string error)
            {
                value = null;
                error = null;
                var dict = new Dictionary<string, object>();
                _i++; // consume '{'
                SkipWhitespace();
                if (!AtEnd && Cur == '}')
                {
                    _i++;
                    value = dict;
                    return true;
                }
                while (true)
                {
                    SkipWhitespace();
                    if (AtEnd || Cur != '"')
                    {
                        error = $"Expected a string key at position {_i}.";
                        return false;
                    }
                    if (!TryParseString(out var key, out error)) return false;
                    SkipWhitespace();
                    if (AtEnd || Cur != ':')
                    {
                        error = $"Expected ':' at position {_i}.";
                        return false;
                    }
                    _i++;
                    SkipWhitespace();
                    if (!TryParseValue(out var val, out error)) return false;
                    dict[key] = val;
                    SkipWhitespace();
                    if (AtEnd)
                    {
                        error = "Unexpected end of JSON inside object.";
                        return false;
                    }
                    if (Cur == ',')
                    {
                        _i++;
                        continue;
                    }
                    if (Cur == '}')
                    {
                        _i++;
                        break;
                    }
                    error = $"Expected ',' or '}}' at position {_i}.";
                    return false;
                }
                value = dict;
                return true;
            }

            private bool TryParseArray(out object value, out string error)
            {
                value = null;
                error = null;
                var list = new List<object>();
                _i++; // consume '['
                SkipWhitespace();
                if (!AtEnd && Cur == ']')
                {
                    _i++;
                    value = list;
                    return true;
                }
                while (true)
                {
                    SkipWhitespace();
                    if (!TryParseValue(out var val, out error)) return false;
                    list.Add(val);
                    SkipWhitespace();
                    if (AtEnd)
                    {
                        error = "Unexpected end of JSON inside array.";
                        return false;
                    }
                    if (Cur == ',')
                    {
                        _i++;
                        continue;
                    }
                    if (Cur == ']')
                    {
                        _i++;
                        break;
                    }
                    error = $"Expected ',' or ']' at position {_i}.";
                    return false;
                }
                value = list;
                return true;
            }

            private bool TryParseString(out string value, out string error)
            {
                value = null;
                error = null;
                _i++; // consume opening quote
                var sb = new StringBuilder();
                while (true)
                {
                    if (AtEnd)
                    {
                        error = "Unterminated string.";
                        return false;
                    }
                    var c = Cur;
                    if (c == '"')
                    {
                        _i++;
                        break;
                    }
                    if (c == '\\')
                    {
                        _i++;
                        if (AtEnd)
                        {
                            error = "Unterminated escape sequence.";
                            return false;
                        }
                        var esc = Cur;
                        switch (esc)
                        {
                            case '"': sb.Append('"'); break;
                            case '\\': sb.Append('\\'); break;
                            case '/': sb.Append('/'); break;
                            case 'b': sb.Append('\b'); break;
                            case 'f': sb.Append('\f'); break;
                            case 'n': sb.Append('\n'); break;
                            case 'r': sb.Append('\r'); break;
                            case 't': sb.Append('\t'); break;
                            case 'u':
                                if (_i + 4 >= _s.Length)
                                {
                                    error = "Invalid unicode escape.";
                                    return false;
                                }
                                var hex = _s.Substring(_i + 1, 4);
                                sb.Append((char)int.Parse(hex, NumberStyles.HexNumber, CultureInfo.InvariantCulture));
                                _i += 4;
                                break;
                            default:
                                error = $"Invalid escape character '\\{esc}'.";
                                return false;
                        }
                        _i++;
                        continue;
                    }
                    sb.Append(c);
                    _i++;
                }
                value = sb.ToString();
                return true;
            }

            private bool TryParseNumber(out object value, out string error)
            {
                value = null;
                error = null;
                var start = _i;
                if (!AtEnd && Cur == '-') _i++;
                while (!AtEnd && char.IsDigit(Cur)) _i++;
                if (!AtEnd && Cur == '.')
                {
                    _i++;
                    while (!AtEnd && char.IsDigit(Cur)) _i++;
                }
                if (!AtEnd && (Cur == 'e' || Cur == 'E'))
                {
                    _i++;
                    if (!AtEnd && (Cur == '+' || Cur == '-')) _i++;
                    while (!AtEnd && char.IsDigit(Cur)) _i++;
                }
                if (_i == start)
                {
                    error = $"Invalid character at position {_i}.";
                    return false;
                }
                var text = _s.Substring(start, _i - start);
                if (!double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var d))
                {
                    error = $"Invalid number '{text}'.";
                    return false;
                }
                value = d;
                return true;
            }
        }
    }
}
