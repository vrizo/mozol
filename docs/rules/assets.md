Assets

- Brand sources of truth are SVG files in assets/icons/, drawn by hand. Each size and use has its own drawing; no script generates marks. Which mark to use at which size: ../web/design-system.md.
- Render SVG to PNG with scripts/render-svg.swift (system SVG renderer, keeps transparency). No rsvg or imagemagick on this Mac.
- Every brand SVG in assets/icons/ has a PNG of the same name next to it, rendered with scripts/render-svg.swift and committed.
- App icons cannot be SVG; asset-catalog imagesets can. App icon PNGs are rendered from their own SVG in assets/icons/ and checked in with the app, without an alpha channel.
- Web images live in web/public/images/. Use SVG where possible; raster images are compressed before commit.
- Generated or local-only design input (background photos, App Store compositions, render outputs, videos) is never committed. Add its folder to .gitignore when it first appears, with a comment that says how to regenerate it.
- The repository is public: commit only assets we own or may publish. Third-party assets need their license next to them in the same folder.
- Hackathon organizer logos live in assets/hackathon/, with a README that says where each came from. Jamie is the first organizer and always comes first; {Tech: Europe} comes second. The README header shows both logos in that order.
- File names: lowercase, words joined by "-", the product name first (mozol-icon-circle.svg).
