# Home Hero A

The home route renders `HOME_HERO` (`home-hero-content.ts`): the approved board copy for the eyebrow, title (line breaks are respected) and lede.

The fixed Mural photo, visible AI label, cover disclaimer and native quote form are rendered by the home component. They cannot be removed by changing the hero text. The six radio values submit to `/quote?type=…`; the quote flow also continues to accept legacy `?category=…` links. Quote continuation requires the existing JavaScript-based quote flow; only the home picker and GET navigation are guaranteed without JavaScript.

The previous carousel modules are retained as unused source, preserving their data. They are no longer mounted on home, so there is no autoplay, animated photo, or experiment overriding the approved copy.
