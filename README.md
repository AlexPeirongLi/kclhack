# Vector Web

The web, but you walk it. Every topic is a floating island, every signboard on it is a live website, and the islands are joined by parkour bridges. Etch a question into the back of your compass and the needle points to the island where its answer lives.

## Run

```
npm install
npm start
```

Open http://localhost:3000 in a normal browser tab. For the guide's written answers, copy `.env.example` to `.env` and add `ANTHROPIC_API_KEY`. Everything else works without a key.

## Controls

| Key | Action |
| --- | --- |
| Click, then move the mouse | Look around (Esc frees the mouse) |
| WASD, Shift | Move, sprint |
| Space | Jump. Press again while touching a wall in the air to wall-jump |
| C | Crouch. Pressed while sprinting, it becomes a slide |
| E | Turn the compass over, type a question, Enter to seek |
| F | Use the signboard in front of you: click links and scroll like a normal site |
| G | Ask the guide (Claude) about the signboard |

Falling into the black abyss puts you back on the last solid ground you stood on.

## Getting between islands

Every island has a direct route to every other island.

- **Ground bridges** join neighbours with nothing between them: scattered blocks from rim to rim.
- **Sky bridges** join everything else. Step on the red pad in the middle of an island and it throws you up the red shaft and out onto a hub platform high above. Hold a direction as you come out of the top so you land on the hub. Blocks lead from the hub straight to every other island's hub, all at one height, so routes that cross simply join up. To come down, step off the hub.
- Some bridges have a low gate: crouch or slide under it.

## How it works

1. `data/concepts.txt` lists 280 topics in 14 categories.
2. `npm run build-map` embeds each topic locally (MiniLM, no key needed) and lays them out with UMAP. Each category becomes an island, placed so related categories are neighbours, and each topic becomes a signboard on its island's rim. The result is `data/map.json`.
3. `POST /api/ask` embeds your question, finds the 5 nearest topics, and puts a red destination board on the best match's island.
4. Signboards are real `<iframe>`s of Wikipedia, positioned in 3D with a CSS matrix behind the game canvas; the board is a transparent hole in the canvas. Only the board nearest to you is loaded.
5. `POST /api/answer` streams the guide's text from Claude.

## Where things are

- `server.js`: API and static hosting
- `lib/embed.js`: local embeddings
- `scripts/build-map.js`: builds the islands and signboard positions
- `public/main.js`: the world, physics, compass and signboards (Three.js)

To change the world, edit `data/concepts.txt` and run `npm run build-map`, then restart the server.

## Limits

Signboards show Wikipedia because it allows itself to be embedded. Most big sites (Google, YouTube pages, news sites) refuse to load inside another page, so they cannot be put on a board without a proxy.
