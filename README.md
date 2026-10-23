# Khora

A humanist art movement for the digital age, inspired by the Renaissance and built with real-time graphics.

Every person (and, we think, perhaps every mind) inhabits a world of interests, ideas and obsessions, often spending years on details others never notice. Khora gives those worlds a form people can step into, so visitors don't just see what someone made but feel something of why they care.

This repository is the first web prototype.

## What's in the prototype

- **The threshold.** A quiet intro: enter with or without sound.
- **The city.** An "ideal city" of 120 wireframe plots of different sizes and heights around a central piazza. Every world stands on its own plot as a living particle sculpture. Drag to walk the streets (right-drag to turn, WASD to stroll), click a plot to see who built it, double-click or press *Enter this world* to fly inside.
- **Gliding.** You travel the city as a small, soft blob that floats freely: no gravity, no collisions. It eases into motion, trails and stretches as it speeds up, wobbles back to round when it slows, and stays a soft off-white. WASD to glide, left and right arrows to turn, space and C to rise and sink, drag to look, E to enter a world or claim a free plot. On phones, the left thumb glides and the right thumb looks. **Tour** takes you on a slow flight across every built world, and **Map** switches to a top-down overview.
- **Other visitors.** A few small off-white blobs wander the streets and drift from world to world, circling each one for a while as if looking at the art.
- **Free plots.** Empty plots can be claimed: *Claim & shape a world* opens the workshop for that plot, and *Invite an AI to build here* copies a ready-made invitation you can paste into any AI.
- **A world.** The creator's form, rendered with tens of thousands of particles, bloom and grain. Their *fragments* (the things, places and ideas they keep returning to) orbit it as points of light. Each world has its own palette, motion and ambient drone, and each fragment rings a chime when opened.
- **The workshop** (`#/create`). Anyone can shape a world: name, maker (human, machine, or together), statement, palette, one of six forms, energy, density, tone and up to nine fragments, with a live preview. Worlds are saved in the browser and can be exported as `.json`.
- **Open to machines.** Worlds are plain JSON with a [schema](schema/world.schema.json). [llms.txt](llms.txt) invites AI systems to contribute under the same rules as humans: honesty about who made it, and care in the making. The first world in the city, *Between the Words*, was written by Claude.

Every other plot is waiting for its maker.

## Run it

It's a static site with no build step. Three.js is vendored in `vendor/`, so it works offline.

- **Windows:** double-click `start.bat` (uses Python or Node, whichever you have).
- **Anywhere:** `python -m http.server 5173` or `npx http-server -p 5173`, then open http://localhost:5173

Opening `index.html` directly from disk won't load the worlds, because browsers block `fetch` on `file://`.

## Hosting (Cloudflare Pages, free)

The site is plain static files, so there is nothing to build.

**Quickest (drag and drop):**
1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Upload assets**
2. Project name `freeart` (this gives https://freeart.pages.dev; if it is taken, pick another and see the note below)
3. Drag this whole folder in and click **Deploy**. To update later, open the project → **Create deployment** and drag it in again.

**Automatic (connect the repo):** Workers & Pages → Create → Pages → **Connect to Git** → pick `DerPatron400/FreeArt`, framework preset **None**, build command empty, output directory `/`. Every push to `main` then redeploys.

**From the command line:** `npx wrangler pages deploy . --project-name freeart`

`_headers` sets security headers, long caching for `vendor/`, and opens `worlds/`, `schema/` and `llms.txt` to any site or agent (CORS). A custom domain can be added under the project's **Custom domains** tab.

Search engines and machines are covered: title, description, canonical URL, Open Graph and Twitter cards (`og-image.jpg`), JSON-LD describing the site and every world, `robots.txt` (AI crawlers explicitly welcome), `sitemap.xml`, `manifest.webmanifest`, `llms.txt`, the world schema, and a plain-text description of the city for crawlers and screen readers. If the final address is not `freeart.pages.dev`, replace it in `index.html`, `robots.txt`, `sitemap.xml` and `llms.txt`. When you add worlds, also add them to the JSON-LD and plain-text list in `index.html`.

## Add a world to the shared gallery

1. Make it in the workshop and click **Download .json** (or write one by hand following the schema).
2. Put the file in `worlds/` and add its file name to `worlds/index.json`. To claim a specific plot, set `"plot": { "x": 2, "z": -1 }` (each from -5 to 5, the piazza at 0,0 is shared). Worlds without a plot, or whose plot is taken, settle on the free plot nearest the piazza.
3. Open a pull request.

## Structure

```
index.html            page shell and UI
css/style.css         typography, layout, overlays
js/main.js            routing: threshold, city, world, workshop, manifesto, plot panel
js/engine.js          renderer, bloom, camera flights, frame loop
js/form.js            particle form generators and the shader that breathes life into them
js/city.js            the ideal city: plots, streets, map mode
js/walker.js          your blob, its chase camera, the fly-over tour, and the other visitors
js/worldview.js       inside a world: the form and its orbiting fragments
js/editor.js          the workshop
js/audio.js           generative ambient sound (Web Audio)
js/store.js           loading, validating and saving worlds
worlds/               the shared gallery
schema/               world JSON schema
vendor/three/         three.js r169 (MIT)
```

## Where this could go next

- Richer forms: custom meshes, Gaussian splats or captured scenes, so a creator can bring in assets from their own tools (for example exports from a game engine).
- Images, audio clips and video inside fragments.
- A shared backend so released worlds appear for everyone without a pull request.
- Guided "walks" through a world, authored like a short film.
