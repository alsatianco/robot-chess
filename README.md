# Robot Chess

A 3D chess game for the browser, made for kids and teens. It plays real chess against a Stockfish bot, a coach explains every move, and the pieces are friendly robots built and animated in code. It is a static website: there is no server. The design brief is in `robot_chess.md`.

## Run it

```bash
npm install        # also copies the Stockfish engine files into public/engine, writes public/licenses.txt and draws the app icons into public/icons
npm run dev        # development server on http://127.0.0.1:5173
npm test           # unit tests (vitest)
npm run build      # static site in dist/, ready for any static host
npm run preview    # serve the built site locally
```

The built site uses relative paths, so `dist/` can be placed in any folder of any static host. No special HTTP headers are needed, because the single-threaded Stockfish build is used. Installing the game as an app and playing with no internet need https (or `localhost`), like every service worker; without https the game runs the same, only without these two things.

## What is in the box

- **Four modes** against the bot: Free play, Timed, Ranked and Coach, with eight bot levels.
- **Two players** on one device: two people take turns on the same board, with the move list, undo and give up. After each move the board flips to the player who moves next (a switch in the settings turns this off). A clock is a choice in the menu, and the coach can be switched on in the settings; then it speaks about the moves of both players. This mode needs no chess engine.
- **Coach** with three feedback levels: illegal-move reasons, move ratings, named causes (undefended piece, missed capture, fork, pin, skewer, mate), a hologram "ghost line", the better move, and opening names.
- **Tutorial**: 22 interactive steps in six chapters, about five minutes.
- **Three board themes**: Meadow (a floating garden island, the default), Twilight garden, and Galaxy.
- **Three board colors** for the tiles: Blue (the default), Sand and Classic. Blue and Sand keep the light tiles clearly darker than the white robots, so both teams are easy to see on every tile. Each theme has its own shades.
- **Robots**: six designs made from rigid parts, with screen faces, idle motion, and their own way to move and capture. Special scenes for check, checkmate, castling and promotion.
- **Settings** saved in the browser. One question at the first start (how well the player knows chess) sets the starting bot level and coach level.
- **A game in progress is saved in the browser too**, after every move. After a reload, or when a phone drops the page in the background, the home menu offers "Continue your game". Leaving a game with the Home button gives it up.
- **Sound** made in the browser with Web Audio. No audio files.
- **Installable, and playable with no internet.** The home menu shows a small Install button when an install is possible: in Chrome and Edge it opens the browser's own install dialog, and on iPhone and iPad it shows the steps to add the game to the Home Screen, because Apple gives a web page no way to start an install. The button never opens by itself and is gone once the game is installed. A service worker keeps every file of the game on the device, so the installed game (and the page in the browser, after the first visit) starts with no internet. A new version is downloaded in the background and takes over the next time the game is opened after all its windows were closed, so a game in progress is never reloaded under the player.
- **About screen** on the home menu, with links to the game page and the source code, credits for the free projects listed under "Licence", and a link to the full licence texts.

## Where things are

| Folder | What it holds |
| --- | --- |
| `src/gfx/` | Everything 3D: render pipeline (`stage.js`), worlds and lights (`environment.js`, `garden.js`), the board (`arena.js`), camera (`camera-rig.js`), the board view that maps chess state to robots (`boardview.js`), effects (`fx/`), robot designs and faces (`robots/`), animation driver and choreography (`anim/`). |
| `src/core/` | Game controller (`game.js`), clock, settings, and the saved game in progress (`saved-game.js`). |
| `src/app/` | Input (`input.js`), the zoom speed of the wheel, trackpad and pinch (`zoom-input.js`), the frame-rate limit of the frame loop (`frame-limiter.js`), the "Auto" graphics quality that measures the device (`auto-quality.js`) and the logic of the install offer (`install.js`). |
| `src/pwa/` | The service worker that keeps the game's files on the device (`service-worker.js`; the build writes it to `sw.js` with the list of built files in it) and the code that starts it (`register.js`). |
| `public/manifest.webmanifest` | Name, colors and icons of the installed app. |
| `src/engine/` | Stockfish worker wrapper and the bot levels. |
| `src/coach/` | Coach logic: illegal-move reasons, detectors, move report, feedback levels, presenter, opening lookup. No DOM code. |
| `src/tutorial/` | Lesson data and the tutorial runner. |
| `src/ui/` | The interface drawn over the 3D scene. |
| `src/audio/` | Sound synthesis. |
| `src/i18n/en.js` | All user-facing text in one file. To add a language, copy it, translate the values and register it in `src/i18n/index.js`. |
| `tests/` | Unit tests. |
| `scripts/` | `copy-engine.mjs`, `build-licenses.mjs` and `build-icons.mjs` (all three run after install: they put the engine files, `licenses.txt` and the app icons into `public/`; the icons are drawn in code, and `npm run icons:build` draws them again), `build-service-worker.mjs` (used by the build: it lists the built files for the service worker), and `build-openings.mjs` (rebuilds `public/data/openings.json` from the Lichess dataset; needs network). |
| `gallery.html` | Development-only page to inspect art and animations. It is not part of the build. |

## Numbers meant to be tuned by playtesting

- Bot strength: `BOT_LEVELS` in `src/engine/bot.js`. Level 1 should be beatable by a child who has just finished the tutorial.
- Move rating thresholds and the "equal move" window: `src/coach/constants.js`.
- Which findings each feedback level shows: `src/coach/levels.js`.
- Animation presets: `PRESETS` in `src/gfx/boardview.js`. Graphics quality levels: `QUALITY` in `src/gfx/stage.js`.
- "Auto" graphics quality: `KEEP_MARGIN` in `src/app/auto-quality.js`, which sets the lowest frame rate (about 32 frames per second) at which a device keeps a quality level. A higher number gives a smoother game and a plainer look on weaker devices.
- Two-player board flip: `BOARD_TURN_SECONDS` in `src/main.js`, the time the game waits while the camera turns the board to the next player.

## Licence

The game's own code is under the MIT licence: see `LICENSE`.

The game is built on the free work of other people, and each part keeps its own licence:

- **Stockfish** (the `stockfish` npm package, files copied to `public/engine/`) is under the GPL-3.0. It is a separate program: it runs in its own Web Worker, and the game talks to it only with text commands (the UCI protocol). Its source code is at https://github.com/nmrugg/stockfish.js. If you change the engine files and publish them, the GPL asks you to publish your changes too.
- **three.js** is under the MIT licence and **chess.js** under the BSD-2-Clause licence.
- **Fonts** (Unbounded and Lexend, bundled through Fontsource) are under the SIL Open Font License. They are served with the game, so no request goes to an outside font server.
- **Opening names** come from the Lichess `chess-openings` dataset, which is CC0.

A built game must carry these licence texts, and the bundler removes the licence comments from the code it packs. So `npm install` writes one file, `public/licenses.txt`, with the game's licence and the full licence text of every part, taken from the installed packages (`npm run licenses:build` writes it again). The build copies it next to the game, and the About screen links to it. The list of parts is in `src/ui/about.js`. Tests fail when a package in `dependencies` has no credit, when a credit shows a licence that the package does not declare, or when a licence text is missing from the file.

## Known limits

- Performance was checked on a desktop machine (an M3 Pro laptop with a 120 Hz screen: about 9 ms of GPU time per frame at high quality, so the default 60 frames per second limit leaves the GPU room to slow down). The "Auto" graphics quality does not guess from the device's name or memory, because browsers hide them (Safari tells no memory size and only "4 or 8" processor cores). At the first start it draws real frames under the loading screen, takes the time, and keeps the best level that the device draws at about 32 frames per second or more; the level is remembered, and picking "Auto" in the settings measures again. This was checked on the desktop machine and with made-up slow devices, but not yet on a real phone or tablet, so the limit of 32 is a first value.
- The phone layouts (upright and sideways) were checked in a desktop browser at phone sizes, not yet on a real phone.
- In the angled view a tall robot covers the square right behind it, so a tap on that square lands on the robot. Dragging the piece there works, and so does the Top view.
- The two-player mode was checked in a desktop browser, also at phone sizes, but not yet by two people on a real phone.
- Bot levels 4 to 7 use the ratings that Stockfish publishes for its skill settings (see the comment above `BOT_LEVELS`). Levels 1 to 3 and the coach thresholds are the game's own first values. None of them is tuned with children yet.
- Installing the game and playing with no internet were checked in desktop Chrome, also with a stand-in for Safari on an iPhone. They were not yet checked on a real Android phone, iPhone or iPad: there the icon on the Home Screen, the full-screen look under the status bar and the first start with no internet still need a look.
