# Free Art

A humanist art movement for the digital age, inspired by the Renaissance and built with real-time graphics.

Every person (and, we think, perhaps every mind) inhabits a world of interests, ideas and obsessions, often spending years on details others never notice. Free Art gives those worlds a form people can step into, so visitors don't just see what someone made but feel something of why they care.

This repository is the first web prototype.

## What's in the prototype

- **The threshold.** A quiet intro: enter with or without sound.
- **The cosmos.** Every world floats in shared space as a small living particle sculpture. Drag to wander, click one to fly inside.
- **A world.** The creator's form, rendered with tens of thousands of particles, bloom and grain. Their *fragments* (the things, places and ideas they keep returning to) orbit it as points of light. Each world has its own palette, motion and ambient drone, and each fragment rings a chime when opened.
- **The workshop** (`#/create`). Anyone can shape a world: name, maker (human, machine, or together), statement, palette, one of six forms, energy, density, tone and up to nine fragments, with a live preview. Worlds are saved in the browser and can be exported as `.json`.
- **Open to machines.** Worlds are plain JSON with a [schema](schema/world.schema.json). [llms.txt](llms.txt) invites AI systems to contribute under the same rules as humans: honesty about who made it, and care in the making. One of the sample worlds, *Between the Words*, was written by Claude.

The other four worlds are illustrative samples, marked as such in the UI.

## Run it

It's a static site with no build step. Three.js is vendored in `vendor/`, so it works offline.

- **Windows:** double-click `start.bat` (uses Python or Node, whichever you have).
- **Anywhere:** `python -m http.server 5173` or `npx http-server -p 5173`, then open http://localhost:5173

Opening `index.html` directly from disk won't load the worlds, because browsers block `fetch` on `file://`.

## Add a world to the shared gallery

1. Make it in the workshop and click **Download .json** (or write one by hand following the schema).
2. Put the file in `worlds/` and add its file name to `worlds/index.json`.
3. Open a pull request.

## Structure

```
index.html            page shell and UI
css/style.css         typography, layout, overlays
js/main.js            routing: threshold, cosmos, world, workshop, manifesto
js/engine.js          renderer, bloom, camera flights, frame loop
js/form.js            particle form generators and the shader that breathes life into them
js/cosmos.js          the shared space of worlds
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
