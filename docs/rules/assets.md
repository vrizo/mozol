Assets

- Brand sources of truth are SVG files in assets/icons/. Every other size or format is rendered from them.
- Render SVG with `qlmanage -t -s <px> -o <dir> <file.svg>` (no rsvg or imagemagick on this Mac).
- App icons cannot be SVG; asset-catalog imagesets can. App icon PNGs are rendered from assets/icons/ and checked in with the app.
- Web images live in web/public/images/. Use SVG where possible; raster images are compressed before commit.
- Generated or local-only design input (background photos, App Store compositions, render outputs, videos) is never committed. Add its folder to .gitignore when it first appears, with a comment that says how to regenerate it.
- The repository is public: commit only assets we own or may publish. Third-party assets need their license next to them in the same folder.
- Hackathon organizer logos live in assets/hackathon/, with a README that says where each came from. Jamie is the first organizer and always comes first; {Tech: Europe} comes second. The README header shows both logos in that order.
- File names: lowercase, words joined by "-", the product name first (mozol-icon-circle.svg).
