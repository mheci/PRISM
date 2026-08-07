//! Cosmetic filter engine (uBlock-Origin-style subset).
//!
//! Parses a blocklist written as uBlock cosmetic filters and produces:
//! * static CSS (element-hiding rules, domain-scoped or global),
//! * procedural rules (`:has()`, `:has-text()`, `:matches-path()`),
//! * path-based page blocking rules.
//!
//! The engine is pure: parse → structures → emit. The host decides how to
//! apply the outputs (CSS injection vs. JS matcher).

use std::fmt::Write as _;

use serde::{Deserialize, Serialize};

use crate::error::{Error, ErrorCode, Subsystem};

/// Hard cap on a single filter list, in characters.
pub const MAX_LIST_BYTES: usize = 256 * 1024;

/// A parsed, ready-to-emit cosmetic filter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CssRule {
    /// Empty = apply on every page.
    pub domains: Vec<String>,
    /// The raw selector, including `:has`/`:has-text` suffixes.
    pub selector: String,
}

/// A procedural rule the host must evaluate with JS (text matching, paths).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcRule {
    pub domains: Vec<String>,
    pub selector: String,
    pub matcher: Matcher,
}

/// What the host must check beyond static CSS.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Matcher {
    /// `:has-text(/regex/i)` — element must contain text matching.
    HasText(String),
    /// `:matches-path(/regex/)` — page URL path must match.
    MatchesPath(String),
}

/// A page-blocking rule (`domain##|path` style is not uBO syntax; we
/// support a documented `! prism-block-path: /regex/` directive).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PathRule {
    pub pattern: String,
}

/// The compiled output of a filter list.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct FilterSet {
    pub css: Vec<CssRule>,
    pub procedural: Vec<ProcRule>,
    pub paths: Vec<PathRule>,
    /// Line numbers of skipped/erroneous lines (1-based, for diagnostics).
    pub skipped: Vec<(usize, String)>,
}

/// Escapes a value for safe interpolation into a CSS selector.
fn css_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            c => out.push(c),
        }
    }
    out
}

/// Splits a line into (domains, selector) at the first `##`.
fn split_rule(line: &str) -> Option<(&str, &str)> {
    let at = line.find("##")?;
    Some((&line[..at], &line[at + 2..]))
}

/// Normalizes a domain list ("a.com,b.com" → sorted unique list).
fn parse_domains(raw: &str) -> Vec<String> {
    let mut v: Vec<String> = raw
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect();
    v.sort();
    v.dedup();
    v
}

impl FilterSet {
    /// Parses a newline-separated filter list. Malformed lines are skipped
    /// and reported; the parser never fails on content.
    pub fn parse(list: &str) -> crate::Result<Self> {
        if list.len() > MAX_LIST_BYTES {
            return Err(Error::invalid(
                Subsystem::Filter,
                "parse",
                ErrorCode::FilterListTooLarge,
                "filter list exceeds size cap",
            ));
        }
        let mut out = Self::default();
        for (idx, raw) in list.lines().enumerate() {
            let line_no = idx + 1;
            let line = raw.trim();
            if line.is_empty() || line.starts_with('!') {
                continue; // comments / blank
            }
            if line.starts_with('#') && !line.starts_with("##") {
                continue; // comment marker (but "##" is a global rule)
            }
            if let Some(pattern) = line.strip_prefix("prism-block-path:") {
                let p = pattern.trim();
                if !p.is_empty() {
                    out.paths.push(PathRule {
                        pattern: p.to_string(),
                    });
                }
                continue;
            }
            match Self::parse_line(line) {
                Ok(Some(rule)) => match rule {
                    LineRule::Css(css) => out.css.push(css),
                    LineRule::Proc(proc) => out.procedural.push(proc),
                },
                Ok(None) => {}
                Err(e) => out.skipped.push((line_no, e.to_string())),
            }
        }
        out.css.sort_by(|a, b| a.selector.cmp(&b.selector));
        out.procedural.sort_by(|a, b| a.selector.cmp(&b.selector));
        out.paths.dedup();
        Ok(out)
    }

    fn parse_line(line: &str) -> crate::Result<Option<LineRule>> {
        let Some((domains, selector)) = split_rule(line) else {
            return Err(Error::invalid(
                Subsystem::Filter,
                "parse_line",
                ErrorCode::FilterSyntax,
                format!("missing ## separator: {line}"),
            ));
        };
        let domain_list = parse_domains(domains);

        // Procedural matchers must be evaluated by the host.
        if let Some((base, pattern)) = split_procedural(selector, ":has-text(") {
            return Ok(Some(LineRule::Proc(ProcRule {
                domains: domain_list,
                selector: format!("{base}:has-text({pattern})"),
                matcher: Matcher::HasText(pattern.to_string()),
            })));
        }
        if let Some((base, pattern)) = split_procedural(selector, ":matches-path(") {
            return Ok(Some(LineRule::Proc(ProcRule {
                domains: domain_list,
                selector: format!("{base}:matches-path({pattern})"),
                matcher: Matcher::MatchesPath(pattern.to_string()),
            })));
        }

        // `:has(...)` is statically expressible in modern engines; emit it
        // as plain CSS (host may downgrade if unsupported).
        if !is_safe_selector(selector) {
            return Err(Error::invalid(
                Subsystem::Filter,
                "parse_line",
                ErrorCode::FilterSyntax,
                format!("unsupported selector syntax: {selector}"),
            ));
        }
        Ok(Some(LineRule::Css(CssRule {
            domains: domain_list,
            selector: selector.to_string(),
        })))
    }

    /// Renders all static CSS rules as one stylesheet string. Domain-scoped
    /// rules are wrapped with `:is()` + `[data-domain]` fallback is avoided;
    /// we use the standard `domain##sel` → `@-moz-document`-free approach:
    /// a single global rule list. Domain filtering is enforced by the host
    /// via `matches_domain` for rule-level application.
    pub fn to_css(&self) -> String {
        let mut out = String::new();
        for rule in &self.css {
            let sel = css_escape(&rule.selector);
            let _ = writeln!(out, "{sel}{{display:none!important;visibility:hidden!important;pointer-events:none!important}}");
        }
        out
    }

    /// Number of rules (static + procedural + path).
    pub fn len(&self) -> usize {
        self.css.len() + self.procedural.len() + self.paths.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

enum LineRule {
    Css(CssRule),
    Proc(ProcRule),
}

/// Splits `sel` at the first occurrence of `needle`, returning the part
/// before it and the balanced content inside the trailing parens.
fn split_procedural<'a>(sel: &'a str, needle: &str) -> Option<(&'a str, &'a str)> {
    let at = sel.find(needle)?;
    let base = &sel[..at];
    let rest = &sel[at + needle.len()..];
    let mut depth = 0usize;
    let mut end = None;
    for (i, ch) in rest.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    end = Some(i);
                    break;
                }
            }
            _ => {}
        }
    }
    let end = end?;
    let pattern = &rest[..end];
    let trailing = rest[end + 1..].trim();
    if !trailing.is_empty() {
        return None; // garbage after matcher
    }
    Some((base, pattern))
}

/// Allows only selector characters we are confident are safe to emit.
fn is_safe_selector(sel: &str) -> bool {
    !sel.contains('{')
        && !sel.contains('}')
        && !sel.contains(';')
        && !sel.contains('\n')
        && sel.chars().all(|c| {
            c.is_ascii_alphanumeric()
                || matches!(
                    c,
                    '#' | '.'
                        | '['
                        | ']'
                        | '='
                        | '^'
                        | '$'
                        | '*'
                        | '~'
                        | '|'
                        | ':'
                        | '('
                        | ')'
                        | ','
                        | ' '
                        | '-'
                        | '_'
                        | '/'
                        | '\\'
                        | '"'
                        | '\''
                        | '+'
                        | '>'
                )
        })
}

/// Convenience: converts a plain `@handle` or channel name into a filter
/// list, mirroring the legacy "plain name" entry format.
pub fn channel_to_filters(handle: &str, hide_watch: bool) -> (String, Option<String>) {
    let handle = handle.trim().trim_start_matches('@');
    if handle.is_empty() {
        return (String::new(), None);
    }
    let esc = css_escape(handle);
    let card_sel = format!(
        "ytd-video-renderer:has(a[href^=\"/@{esc}\" i]),\
         ytd-compact-video-renderer:has(a[href^=\"/@{esc}\" i]),\
         ytd-rich-item-renderer:has(a[href^=\"/@{esc}\" i])"
    );
    let watch = if hide_watch {
        Some(format!(
            "ytd-watch-flexy:has(ytd-video-owner-renderer a[href^=\"/@{esc}\" i])"
        ))
    } else {
        None
    };
    (card_sel, watch)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_global_rule() {
        let set = FilterSet::parse("##.ytp-watermark").unwrap();
        assert_eq!(set.css.len(), 1);
        assert!(set.css[0].domains.is_empty());
        assert_eq!(set.css[0].selector, ".ytp-watermark");
    }

    #[test]
    fn parses_domain_scoped_rule() {
        let set = FilterSet::parse("youtube.com##ytd-masthead").unwrap();
        assert_eq!(set.css[0].domains, vec!["youtube.com"]);
    }

    #[test]
    fn parses_has_text_procedural() {
        let set =
            FilterSet::parse("youtube.com##ytd-video-renderer:has-text(/premiere/i)").unwrap();
        assert_eq!(set.procedural.len(), 1);
        assert!(matches!(
            &set.procedural[0].matcher,
            Matcher::HasText(p) if p == "/premiere/i"
        ));
        assert!(set.css.is_empty());
    }

    #[test]
    fn parses_matches_path() {
        let set = FilterSet::parse("##ytd-app:matches-path(/^\\/@blocked/)").unwrap();
        assert!(matches!(
            &set.procedural[0].matcher,
            Matcher::MatchesPath(_)
        ));
    }

    #[test]
    fn skips_bad_lines_with_report() {
        let set = FilterSet::parse("##.ok\nno-separator\n##bad{selector}\n").unwrap();
        assert_eq!(set.css.len(), 1);
        assert_eq!(set.skipped.len(), 2);
    }

    #[test]
    fn emits_css_with_important() {
        let set = FilterSet::parse("##.a\n##.b").unwrap();
        let css = set.to_css();
        assert!(css.contains(".a{display:none!important"));
        assert!(css.contains(".b{display:none!important"));
    }

    #[test]
    fn comments_and_blanks_ignored() {
        let set = FilterSet::parse("! comment\n\n##.x\n# also comment\n").unwrap();
        assert_eq!(set.css.len(), 1);
        assert_eq!(set.skipped.len(), 0);
    }

    #[test]
    fn path_directive_parsed() {
        let set = FilterSet::parse("prism-block-path: /^\\/@blocked/").unwrap();
        assert_eq!(set.paths.len(), 1);
    }

    #[test]
    fn oversized_list_rejected() {
        // "##.x\n" is 5 bytes per line; repeat enough to exceed the cap.
        let big = "##.x\n".repeat(MAX_LIST_BYTES / 5 + 1);
        let err = FilterSet::parse(&big).unwrap_err();
        assert_eq!(err.code, ErrorCode::FilterListTooLarge);
    }

    #[test]
    fn channel_to_filters_builds_card_and_watch() {
        let (cards, watch) = channel_to_filters("@badchannel", true);
        assert!(cards.contains("ytd-rich-item-renderer:has(a[href^=\"/@badchannel\" i])"));
        assert!(watch.unwrap().contains("ytd-watch-flexy:has"));
    }
}
