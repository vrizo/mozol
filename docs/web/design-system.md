Design system

The look of the MOZOL web app and of every brand asset. It comes from the landing page and the hackathon poster: warm paper, black ink, monospace characters that form shapes. Tokens live in web/src/tokens.css; components use the tokens, never raw values.

Brand mark

The mark is a footprint drawn with separate monospace characters, mostly "+". The field is uneven, as on the poster: every character is shifted and sized a little at random, some are "|", "-", "'", "/" or a stacked "+", the edge is ragged, and a few characters fall outside the foot. Short slanted lines on both sides of the foot show motion; they are drawn at 50% opacity. The foot is tilted 25 degrees to the right, toes up. The word MOZOL is written in wide geometric capitals with wide letter spacing.

The mark is always made of characters, at every size. A filled footprint is never used.

The mark always mixes different characters, as in the full mark: "+" with "|", "-", "'", "/" and a stacked "+", shifted and sized unevenly. A mark made only of equal "+" signs, or of "+" signs on an even grid, is not allowed.

Each toe is a separate group of characters. An empty gap separates every toe from its neighbors and from the sole; toes never merge into one another or into the sole.

Every level has the same foot with five toes. Smaller levels use fewer, larger characters; they never switch to another foot shape or to a single character.

Each use has its own mark, drawn by hand for its size. A smaller mark is never a scaled-down or generated copy of a larger one: a 32 px mark is designed on a 32 px canvas, pixel by pixel. No script generates the marks.

Marks that exist (assets/icons/, each SVG with a PNG of the same name next to it):

- mozol-mark-no-lines.svg: the full mark without motion lines, 1000 x 1000. 256 px and larger: hero areas.
- mozol-mark-no-lines-inverted.svg: the same mark with white strokes on a black square background, 1000 x 1000.
- mozol-favicon.png: the favicon and the iOS app icon, 1254 x 1254, white characters on a black background, no alpha channel (the App Store requires none). It is a raster image with no SVG source. Its copies, each resized from it: web/public/brand/mozol-favicon-16.png and -32.png (favicon), -180.png (apple-touch-icon), -192.png and -512.png (manifest icons); ios/Mozol/Resources/Assets.xcassets/AppIcon.appiconset/mozol-favicon-1024.png (app icon).
- mozol-mark-512.svg: the full mark without lines in a 512 x 512 canvas, with a margin of 11% from the foot to every edge and heavier strokes. Square images from 256 to 512 px.
- mozol-wordmark.svg: the word MOZOL alone.
- mozol-poster.svg: the full mark with motion lines, the wordmark and labels.
- mozol-og.svg: social card, 1200 x 630, with the full mark and motion lines.

These files are now the sources; edit them directly. Copies for the web app are in web/public/brand/.

Marks still to draw, each for its own size:

- Favicon: 16 px and 32 px drawn for their size, to replace the resized copies of mozol-favicon.png.
- App icon: an iOS dark variant.
- Lockup: mark plus wordmark for the site header, ink on paper and paper on ink.
- Mark for empty states and loading screens, 64 to 256 px.

Clear space around the mark and the lockup is at least the height of one toe of the mark.

Color

- --bg #f3f2ee: page background, warm paper.
- --surface #fbfaf7: raised areas, inputs, cards.
- --ink #111111: text, the mark, primary buttons, borders.
- --ink-2 #55554f: secondary text (contrast 6.7 on --bg).
- --muted #8a8a86: decoration only: hard shadows, motion lines, drifting labels. Contrast is 3.1, so never body text.
- --line #d9d7cf: thin dividers inside a surface.
- --danger #a3241b: error text and the border of a field with an error. The only color that is not gray.
- --on-ink #f3f2ee: text on ink.

The interface is monochrome. State is shown with weight, borders, fill and the "+" character, not with color. Dark surfaces swap --bg and --ink.

Browser

- Browser bars and the page share one color: theme-color, the manifest theme and background, and the Windows tile are all #f3f2ee. The page declares color-scheme light.
- Home screen: apple-touch-icon 180 px and the manifest icons 192 and 512 px are the app icon. The installed name is MOZOL.
- Link previews use mozol-og.png, 1200 x 630.

Type

- --sans (Helvetica Neue, Arial): body text, buttons, inputs.
- --mono (system monospace): labels, kickers, numbers, codes, timestamps, and every character texture.
- Sizes: 12, 14, 16, 18, 24, 32, 48 px (--text-xs to --text-3xl). Body text is 16 px, line height 1.45; long reading text is 18 px.
- Labels: mono, 12 px, weight 600, uppercase, letter spacing 0.12em. A section label starts with "+ " ("+ YOUR WORDS").
- Headings: sans, weight 700, line height 1.15.

Space and layout

- Space steps of 4 px: 4, 8, 12, 16, 20, 24, 32, 40, 48 (--space-1 to --space-12).
- The content column is 760 px wide at most. Side gutter 16 px on phones.
- At 640 px and narrower: one column, actions full width.
- Touch targets are at least 44 px high.

Shape

- Corners are square everywhere (--radius 0).
- Borders are 2 px solid ink. Separators between page sections are 2 px dotted ink (--rule).
- Elevation is a hard offset shadow in --muted, never a blur: 4 px at rest, 6 px on hover.

Components

- Primary button: ink fill, --on-ink text, sans 16 px bold, padding 12 x 20 px, hard shadow. On hover it moves up-left by 2 px and the shadow grows to 6 px. A forward action ends with " ->".
- Secondary button: transparent, 2 px ink border, ink text, no shadow. On hover the fill turns ink.
- Text link: ink, underlined, offset 3 px.
- Input: --surface fill, 2 px ink border, 16 px text, 44 px high, mono label above. Error: --danger border and a --danger message below.
- Card: --surface fill, 2 px ink border, hard shadow when it is clickable.
- Tag or count: mono 12 px uppercase, 2 px ink border, no fill.
- Empty state: the simple mark in --muted, one line of text, one primary action.
- Loading: a row of "+" characters that appear one after another, in mono.
- Focus: the global 2 px ink outline with 2 px offset (rules.md).

Motion

- Hover and press: 0.15 s.
- Text and blocks appear with a 0.45 s reveal: from 10 px lower, transparent and blurred to in place. Items in a list follow 0.1 s apart.
- With prefers-reduced-motion, everything appears at once.
