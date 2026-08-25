# UI polish research — weather mode, contrast, nav redesign

Date: 2026-08-25. Companion to the `feature/ui-polish` branch, which implements
the weather + high-contrast theme modes, the confirm-dialog replacement, and
the button/contrast pass. This file records the research behind those choices
and the nav options that are *not* yet implemented.

## 1. Live campus weather (implemented)

**Data source: Open-Meteo** (`api.open-meteo.com/v1/forecast`).
Chosen over alternatives because it is free, keyless, and CORS-friendly:

| Source | Key | Free tier | Notes |
|---|---|---|---|
| Open-Meteo | none | 10k req/day | WMO codes, cloud cover, is_day in one call |
| OpenWeatherMap | required | 1k req/day | key management for no benefit |
| Environment Canada (MSC GeoMet) | none | yes | authoritative but heavier API, no simple current-conditions JSON |

One server-side fetch with `revalidate: 1800` means the whole site shares one
cached observation — the API sees ~48 requests/day regardless of traffic.
Coordinates are hardcoded to UBC Vancouver (49.2606, −123.246): the sky shows
*campus* weather by design, so no geolocation permission prompt.

**Mapping.** WMO weather codes collapse to seven skies: clear, cloudy,
overcast, fog, rain, snow, storm. Cloud density, palette, and rain/snow
particle layers are shader uniforms; the CSS sky gradient and stars swap by a
`data-weather` attribute. Day/night comes from the API's `is_day` (fallback:
local clock, 07–19). Failure of any kind falls back to the default clouds —
weather mode can never break the page.

## 2. Contrast research (implemented where noted)

Measured against WCAG 2.1 AA (4.5:1 small text, 3:1 large text/UI).

| Pair | Ratio | Verdict |
|---|---|---|
| `--foreground` #000 on #fff | 21:1 | fine |
| `--text-secondary` #615f5c on #fff | 6.2:1 | fine |
| `--text-tertiary` #878581 on #fff | **3.5:1** | failed AA → darkened to #6e6c68 (5.1:1) |
| dark `--text-secondary` #ababaf on #1c1c1e | 7.7:1 | fine |
| dark `--text-tertiary` #8e8e93 on #1c1c1e | 5.3:1 | fine |
| `--brand` #002145 under white text | 15.7:1 | fine |
| dark `--brand-accent` #7aa7e8 on #1c1c1e | 6.9:1 | fine |

The clean-but-functional balance: keep the muted three-tier text hierarchy
(it is what makes the design read calm), but hold every tier at ≥4.5:1 so
"muted" never becomes "faint". The one failing token was tertiary text in
light mode; one hex change fixed it globally. High-contrast mode goes further:
all text tokens collapse to navy on white (≥12:1, AAA), translucency and
shadows removed.

**Buttons:** shared Button raised from `py-2 text-sm` to `py-2.5 text-base`
(~40px hit target, at Apple's 44pt guidance once padding and line-height are
counted) and moved from raw `blue-700` onto the brand tokens so every mode —
including high contrast — restyles it for free. A themed `:focus-visible`
ring replaced the browser default.

## 3. Nav bar redesign options (research only — not implemented)

Current state: floating frosted bar, collapses inward on scroll down, reopens
scrolling up. Each link carries a dark backing chip for contrast over the sky.

**Option A — keep the float, drop the chips.** Raise the bar's own
`brightness()` floor slightly and remove the per-link chips. One backdrop
instead of five rectangles; quieter, more Apple. Risk: the chips are what
guarantees contrast under a bright cloud — needs the same veil-worst-case
check the sky palettes get. Cheapest option.

**Option B — solid-on-scroll.** Transparent over the hero, solid `--surface`
bar once scrolled past ~80px (one IntersectionObserver, swap a class).
Standard product-site behavior, kills the contrast problem entirely below the
fold, keeps the airy top-of-page look. Medium effort, most predictable result.

**Option C — centered pill dock.** Shrink the nav to a centered floating pill
(logo left, three links, account right), fixed, never collapses. Reads modern
and app-like; pairs well with the sky since it occupies less of it. Needs
mobile thought (pill → bottom tab bar?). Highest effort.

Recommendation: B for reliability, A if the current look should survive with
less visual noise. C only as part of a broader mobile-nav rethink.
