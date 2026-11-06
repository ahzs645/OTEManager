# Photo-fitted layouts

Layouts used to be chosen for the copy, and photos were cropped to whatever frame the layout had. Most OTE photos are square or portrait, while most photo slots are wide, so real articles lost a lot of picture. **Fit layouts to the photos** in the planner (on by default) reverses that: the photo's real size helps decide the layout.

The code is `public/designcraft/compiler/photo-fit.js`. Like adaptive headline bands, it produces explicit template variants with recorded geometry, and native preflight still decides whether the copy fits.

## What it does

1. **Reads the real size.** Pixel size comes from the file header, after EXIF rotation, because phone portraits are stored sideways. A photo's recorded `width`/`height` wins if present.
2. **Matches photos to slots.** Each slot takes the article's closest-shaped photo, not simply the next one uploaded. The caption follows its photo.
3. **Generates readings of each template:**
   - **As designed:** the template with matched photos.
   - **Shaped frames:** rows are justified so each photo keeps its shape at one shared height, capped at 52% of the content height. Side photos take their natural width and a wider body gains a column.
   - **Insets:** the photo spans whole body columns at its exact shape, top right or left, and the copy wraps around it. There is a large size (the widest span that prints at 150 ppi or better) and a small one for long stories.
4. **Ranks by what happens to the photos.** Lost picture and printing below 150 ppi count against a layout, and so does dropping every photo of an article that has them.
5. **Keeps fallbacks.** The best plain layouts are always composed too. If nothing fits, it works further down the plain layouts rather than reporting failure.

## Safeguards

- `layoutCollisions` rejects any photo-led layout with content on top of content. Native preflight cannot see this, because a body drawn over a headline is not overset text. Templates with the photo above the headline therefore get no inset.
- A wrap keeps the body out of the photo and caption. The caption sets `ignoreWrap` so its own text is not pushed out.
- When a headline band changes height, photo-shaped frames move as a rigid block with their wraps, so the shape stays exact.
- Characters the fonts cannot print are named in the rejection reason, so an editor can replace them.

Templates with `wrap` slots already route to the shared JavaScript compiler on the server, so the Python compilers need no change.

## Results on real drafts

Measured on the 19 live Draft articles with photos and text, on DesignCraft 0.17.2. Emoji were removed from the test copy only.

| | As designed | Fitted to photos |
|---|---:|---:|
| Articles with a fitting one-page layout | 16 of 19 | 16 of 19 |
| Average photo cropped away (those 16) | 36.3% | 5.8% |
| Articles laid out with no photo at all | 6 | 3 |
| Average body fill | 83% | 78% |

## Known limits

- Very tall photos can still crop. An 800×2000 photo is too tall for one column of a one-story page.
- Short stories with one photo can leave about half a page free, which is room for a second story. Filling it by enlarging the photo is not attempted.
- Stories of roughly 950 words or more with photos may not fit one page on any layout. Issue Studio's planner gives them measured continuation pages.
- Continuation pages after the opener are text-only, so a long story shows one photo layout, and each page repeats the full headline.
- Emoji stop every layout for that article until they are replaced. The whole-issue planner holds the story back and names the characters.
- Photo reshaping is skipped on pages with booked ads or several body frames, so their checked geometry stays put. Photos are still matched by shape there.
- A photo with no caption prints the placeholder "Caption not provided".

## Checking it

- `tests/designcraft-photo-fit.test.ts` covers size reading, matching, reshaping, and collisions across every story template and five photo shapes.
- `tools/designcraft/check-interface-bot.cjs` walks the app on desktop and phone sizes, then runs Publications → planner → layouts → generate → editor against a local issue. It clicks and saves, so it refuses to run against anything but localhost. It runs Publications → Issue Studio → layouts → editor → whole-issue plan → composition, and expects an issue titled "Bot test issue" with 10 articles under Volume 33.
