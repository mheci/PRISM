//! Theme palette math.
//!
//! Pure color utilities: hex parsing, HSL conversion, mixing, and palette
//! generation from a single base color (the "create theme from color"
//! feature). Replaces the previous culori dependency with ~300 lines of
//! deterministic Rust.

use serde::{Deserialize, Serialize};

use crate::error::{Error, ErrorCode, Subsystem};

/// The 17-key palette used by every theme.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Palette {
    pub base_background: String,
    pub raised_background: String,
    pub menu_background: String,
    pub general_background_a: String,
    pub general_background_b: String,
    pub general_background_c: String,
    pub text_primary: String,
    pub text_secondary: String,
    pub text_disabled: String,
    pub badge_chip_background: String,
    pub outline: String,
    pub call_to_action: String,
    pub call_to_action_inverse: String,
    pub icon_active_other: String,
    pub icon_inactive: String,
    pub ten_percent_layer: String,
    pub shadow: String,
}

impl Palette {
    /// Emits the CSS variable declarations used by the host.
    pub fn to_css_vars(&self) -> String {
        format!(
            "--yt-spec-base-background:{p1};--yt-spec-raised-background:{p2};--yt-spec-menu-background:{p3};--yt-spec-general-background-a:{p4};--yt-spec-general-background-b:{p5};--yt-spec-general-background-c:{p6};--yt-spec-text-primary:{p7};--yt-spec-text-secondary:{p8};--yt-spec-text-disabled:{p9};--yt-spec-badge-chip-background:{p10};--yt-spec-outline:{p11};--yt-spec-call-to-action:{p12};--yt-spec-call-to-action-inverse:{p13};--yt-spec-icon-active-other:{p14};--yt-spec-icon-inactive:{p15};--yt-spec-10-percent-layer:{p16};--yt-spec-shadow:{p17}",
            p1 = self.base_background,
            p2 = self.raised_background,
            p3 = self.menu_background,
            p4 = self.general_background_a,
            p5 = self.general_background_b,
            p6 = self.general_background_c,
            p7 = self.text_primary,
            p8 = self.text_secondary,
            p9 = self.text_disabled,
            p10 = self.badge_chip_background,
            p11 = self.outline,
            p12 = self.call_to_action,
            p13 = self.call_to_action_inverse,
            p14 = self.icon_active_other,
            p15 = self.icon_inactive,
            p16 = self.ten_percent_layer,
            p17 = self.shadow,
        )
    }
}

/// RGB in [0,255].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

/// HSL with h in [0,360), s,l in [0,1].
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Hsl {
    pub h: f64,
    pub s: f64,
    pub l: f64,
}

/// Parses "#rgb", "#rrggbb" or a bare hex.
pub fn parse_hex(input: &str) -> Result<Rgb, Error> {
    let s = input.trim().trim_start_matches('#');
    let hex = match s.len() {
        3 => s.chars().flat_map(|c| [c, c]).collect::<String>(),
        6 => s.to_string(),
        _ => {
            return Err(Error::invalid(
                Subsystem::Themes,
                "parse_hex",
                ErrorCode::ThemeColorInvalid,
                format!("invalid hex color: {input}"),
            ))
        }
    };
    let val = u32::from_str_radix(&hex, 16).map_err(|_| {
        Error::invalid(
            Subsystem::Themes,
            "parse_hex",
            ErrorCode::ThemeColorInvalid,
            format!("invalid hex color: {input}"),
        )
    })?;
    Ok(Rgb {
        r: ((val >> 16) & 0xFF) as u8,
        g: ((val >> 8) & 0xFF) as u8,
        b: (val & 0xFF) as u8,
    })
}

impl Rgb {
    pub fn to_hex(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }

    pub fn to_hsl(self) -> Hsl {
        let r = self.r as f64 / 255.0;
        let g = self.g as f64 / 255.0;
        let b = self.b as f64 / 255.0;
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let l = (max + min) / 2.0;
        let d = max - min;
        let (mut h, s) = if d == 0.0 {
            (0.0, 0.0)
        } else {
            let s = if l > 0.5 {
                d / (2.0 - max - min)
            } else {
                d / (max + min)
            };
            let h = if max == r {
                ((g - b) / d).rem_euclid(6.0)
            } else if max == g {
                (b - r) / d + 2.0
            } else {
                (r - g) / d + 4.0
            };
            (h * 60.0, s)
        };
        if h < 0.0 {
            h += 360.0;
        }
        Hsl { h, s, l }
    }
}

impl Hsl {
    pub fn to_rgb(self) -> Rgb {
        let h = self.h.rem_euclid(360.0) / 360.0;
        let s = self.s.clamp(0.0, 1.0);
        let l = self.l.clamp(0.0, 1.0);
        if s == 0.0 {
            let v = (l * 255.0).round() as u8;
            return Rgb { r: v, g: v, b: v };
        }
        let q = if l < 0.5 {
            l * (1.0 + s)
        } else {
            l + s - l * s
        };
        let p = 2.0 * l - q;
        let conv = |t: f64| -> f64 {
            let t = if t < 0.0 {
                t + 1.0
            } else if t > 1.0 {
                t - 1.0
            } else {
                t
            };
            if t < 1.0 / 6.0 {
                p + (q - p) * 6.0 * t
            } else if t < 1.0 / 2.0 {
                q
            } else if t < 2.0 / 3.0 {
                p + (q - p) * (2.0 / 3.0 - t) * 6.0
            } else {
                p
            }
        };
        Rgb {
            r: (conv(h + 1.0 / 3.0) * 255.0).round() as u8,
            g: (conv(h) * 255.0).round() as u8,
            b: (conv(h - 1.0 / 3.0) * 255.0).round() as u8,
        }
    }

    pub fn to_hex(self) -> String {
        self.to_rgb().to_hex()
    }

    /// Lightness-shifted copy: `amount` in [-1, 1]; positive = lighter.
    pub fn lighten(self, amount: f64) -> Hsl {
        Hsl {
            h: self.h,
            s: self.s,
            l: (self.l + amount).clamp(0.0, 1.0),
        }
    }

    pub fn darken(self, amount: f64) -> Hsl {
        self.lighten(-amount)
    }

    pub fn saturate(self, amount: f64) -> Hsl {
        Hsl {
            h: self.h,
            s: (self.s + amount).clamp(0.0, 1.0),
            l: self.l,
        }
    }

    pub fn with_lightness(self, l: f64) -> Hsl {
        Hsl {
            h: self.h,
            s: self.s,
            l: l.clamp(0.0, 1.0),
        }
    }
}

/// Mixes two colors with weight `w` in [0,1] (0 = all `a`).
pub fn mix(a: Rgb, b: Rgb, w: f64) -> Rgb {
    let w = w.clamp(0.0, 1.0);
    let f = |x: u8, y: u8| (x as f64 * (1.0 - w) + y as f64 * w).round() as u8;
    Rgb {
        r: f(a.r, b.r),
        g: f(a.g, b.g),
        b: f(a.b, b.b),
    }
}

const WHITE: Rgb = Rgb {
    r: 255,
    g: 255,
    b: 255,
};
const BLACK: Rgb = Rgb { r: 0, g: 0, b: 0 };

/// Generates a complete palette from one base color.
///
/// * `dark` — build a dark or light theme.
/// * `accent` — the call-to-action color (usually the base itself).
pub fn generate_palette(base: &str, dark: bool) -> Result<Palette, Error> {
    let base_rgb = parse_hex(base)?;
    let _base_hsl = base_rgb.to_hsl();

    let shade = |factor: f64| -> String {
        // factor > 0 mixes toward black; < 0 toward white.
        let target = if factor > 0.0 { BLACK } else { WHITE };
        mix(base_rgb, target, factor.abs()).to_hex()
    };
    let tint = |w: f64| mix(base_rgb, WHITE, w).to_hex();

    let palette = if dark {
        Palette {
            base_background: shade(0.72),
            raised_background: shade(0.60),
            menu_background: shade(0.66),
            general_background_a: shade(0.68),
            general_background_b: shade(0.74),
            general_background_c: shade(0.62),
            text_primary: tint(0.86),
            text_secondary: tint(0.62),
            text_disabled: tint(0.40),
            badge_chip_background: shade(0.50),
            outline: shade(0.45),
            call_to_action: base_rgb.to_hex(),
            call_to_action_inverse: "#0f0f0f".into(),
            icon_active_other: tint(0.80),
            icon_inactive: tint(0.45),
            ten_percent_layer: "rgba(255,255,255,.1)".into(),
            shadow: "0 12px 30px rgba(0,0,0,.6)".into(),
        }
    } else {
        Palette {
            base_background: tint(0.94),
            raised_background: tint(0.88),
            menu_background: tint(0.90),
            general_background_a: tint(0.92),
            general_background_b: tint(0.96),
            general_background_c: tint(0.86),
            text_primary: shade(0.55),
            text_secondary: shade(0.40),
            text_disabled: shade(0.25),
            badge_chip_background: tint(0.80),
            outline: shade(0.30),
            call_to_action: base_rgb.to_hex(),
            call_to_action_inverse: "#ffffff".into(),
            icon_active_other: shade(0.50),
            icon_inactive: shade(0.35),
            ten_percent_layer: "rgba(0,0,0,.06)".into(),
            shadow: "0 12px 30px rgba(0,0,0,.18)".into(),
        }
    };
    Ok(palette)
}

/// Contrasting text color for a given background (for badges).
pub fn contrast_text(bg: &str) -> Result<String, Error> {
    let rgb = parse_hex(bg)?;
    // Relative luminance (WCAG).
    let f = |c: u8| {
        let v = c as f64 / 255.0;
        if v <= 0.03928 {
            v / 12.92
        } else {
            ((v + 0.055) / 1.055).powf(2.4)
        }
    };
    let lum = 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
    Ok(if lum > 0.179 {
        "#0f0f0f".into()
    } else {
        "#ffffff".into()
    })
}

/// The accent-hue rotation used by the theme engine's accent slider:
/// rotates the call-to-action hue while keeping s/l constant.
pub fn rotate_hue(hex: &str, degrees: f64) -> Result<String, Error> {
    let rgb = parse_hex(hex)?;
    let hsl = rgb.to_hsl();
    Ok(Hsl {
        h: (hsl.h + degrees).rem_euclid(360.0),
        s: hsl.s,
        l: hsl.l,
    }
    .to_hex())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_roundtrip() {
        let rgb = parse_hex("#ff3d7f").unwrap();
        assert_eq!(
            rgb,
            Rgb {
                r: 0xFF,
                g: 0x3D,
                b: 0x7F
            }
        );
        assert_eq!(rgb.to_hex(), "#ff3d7f");
        let short = parse_hex("#fff").unwrap();
        assert_eq!(short.to_hex(), "#ffffff");
    }

    #[test]
    fn invalid_hex_rejected() {
        assert!(parse_hex("#ggg").is_err());
        assert!(parse_hex("notacolor").is_err());
        assert_eq!(
            parse_hex("#ggg").unwrap_err().code,
            ErrorCode::ThemeColorInvalid
        );
    }

    #[test]
    fn hsl_roundtrip_red() {
        let rgb = Rgb { r: 255, g: 0, b: 0 };
        let hsl = rgb.to_hsl();
        assert!((hsl.h - 0.0).abs() < 0.01 || (hsl.h - 360.0).abs() < 0.01);
        assert!((hsl.s - 1.0).abs() < 0.001);
        assert!((hsl.l - 0.5).abs() < 0.001);
        assert_eq!(hsl.to_rgb(), rgb);
    }

    #[test]
    fn mix_toward_black_and_white() {
        let base = Rgb {
            r: 128,
            g: 128,
            b: 128,
        };
        let blackish = mix(base, BLACK, 1.0);
        assert_eq!(blackish, BLACK);
        let whiteish = mix(base, WHITE, 1.0);
        assert_eq!(whiteish, WHITE);
        let half = mix(base, BLACK, 0.5);
        assert_eq!(half.r, 64);
    }

    #[test]
    fn generate_palette_dark_and_light() {
        let dark = generate_palette("#ff3d7f", true).unwrap();
        assert_eq!(dark.call_to_action, "#ff3d7f");
        assert!(dark.text_primary.starts_with('#'));
        let light = generate_palette("#ff3d7f", false).unwrap();
        assert_eq!(light.call_to_action, "#ff3d7f");
    }

    #[test]
    fn contrast_text_picks_dark_on_light() {
        assert_eq!(contrast_text("#ffffff").unwrap(), "#0f0f0f");
        assert_eq!(contrast_text("#000000").unwrap(), "#ffffff");
    }

    #[test]
    fn hue_rotation_preserves_chroma() {
        let rotated = rotate_hue("#ff0000", 120.0).unwrap();
        let parsed = parse_hex(&rotated).unwrap();
        let hsl = parsed.to_hsl();
        assert!(
            (hsl.h - 120.0).abs() < 1.0,
            "expected green-ish, got h={}",
            hsl.h
        );
    }
}
