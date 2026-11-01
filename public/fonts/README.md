# Offline XR label fonts

These fonts are vendored so Troika text rendering works on an offline LAN without
runtime CDN requests.

| File | Official source | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `NotoSans-Regular.ttf` | https://github.com/notofonts/noto-fonts/blob/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf | 569208 | `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5` |
| `NotoSansSymbols2-Regular.ttf` | https://github.com/google/fonts/blob/main/ofl/notosanssymbols2/NotoSansSymbols2-Regular.ttf | 1233128 | `7d5fb73b7ca67a6798101741f5d280a3d016a56a197afcd4199dbb57b4b82a21` |

Both fonts are licensed under the SIL Open Font License 1.1. The corresponding
license texts are `OFL.txt` and `NotoSansSymbols2-OFL.txt`.

`src/xr/glyph-ranges.ts` records the compact cmap ranges generated from these
files with `fc-query --format '%{charset}\\n'`. Before Troika sync, unsupported
visual code points are replaced with `?` while the original label remains in
`userData.labelText`; this prevents an unsupported title from reaching Troika's
CDN-backed unicode fallback resolver.

The four directional key glyphs are rendered using supported white-arrow equivalents
(`⇦`, `⇧`, `⇨`, `⇩`). Font choice uses the exact cmap coverage rather than broad
Unicode-block assumptions, including the local symbol font for the mathematical minus.
