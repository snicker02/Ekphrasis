# Ekphrasis

**Music from images and video.** Ekphrasis reads an image or a video like a score. A playhead scans the picture, each column becomes a 16th-note step and each horizontal band becomes a pitch. Color sets the key and the harmony, structure sets the melody, and edges and motion set the groove.

Plain WebAudio + Canvas 2D. No dependencies and no build step.

## Run

ES modules don't load from `file://`, so serve the folder over HTTP:

```
python3 -m http.server 8000
# open http://localhost:8000
```

GitHub Pages works as-is.

## Sources

- **Image**: open a file or drag it onto the stage. The whole image is composed up front, so playback and exports are deterministic.
- **Video**: the key is read from five frames sampled across the clip. Music is then generated live from whatever frame is showing, and frame-to-frame motion drives rhythm and melody.
- **Webcam**: the same live analysis, using your camera.
- **Demo**: seeded procedural landscapes. Ridgelines become melodic contours and trees become rhythm.

## Genres

Pick a genre in **Style**, or leave it on **Auto** and Ekphrasis chooses one by comparing the image's energy, colorfulness, brightness and warmth to a profile for each genre. A genre doesn't change what the image controls. It changes how the result is phrased: drum patterns, bass line, chord rhythm, arpeggio style, how long lead notes are held, the tempo range, swing, the allowed modes, sidechain pumping and the default instruments. You can change any instrument after picking a genre.

| Genre | Drums | Bass | Chords | Notes |
|---|---|---|---|---|
| Ekphrasis (free) | rules driven by edges and onsets | root/fifth + onsets | sustained pad | the original v1.0 behavior |
| Ambient | off by default | 2-bar drone | add9 glass pad | 56–84 BPM, drone layer |
| Lo-fi hip hop | swung boom-bap, lo-fi kit | lazy root + fifth | strummed 7ths on electric piano | vinyl crackle |
| Jazz | swung ride, brushes, comping snare | walking quarters, approach notes | rootless piano comping | 8th-note swing |
| Synthwave | gated snare, tom fills | octave eighths | poly-synth pad | 16th up-down arpeggio, pump |
| House | four on the floor, 909 | offbeat FM bass | syncopated stabs | strong sidechain pump |
| Drum & bass | two-step breaks, ghost snares | long reese | strings | 164–176 BPM |
| Trap | half-time clap, hi-hat rolls | 808 that follows the kick, with glides | choir | rolls happen where the image has upper-band texture |
| Chiptune | noise kit (crushed) | triangle octaves | pulsing chip chords | pulse-wave lead with vibrato |
| Classical | timpani, crash at peaks | pizzicato | strings | Alberti-style harp arpeggios |
| Gamelan | gongs every 2 bars, kendang, bonang | drone | glass pad | pelog/slendro tunings, interlocking (kotekan) metallophones |

In drum patterns, `?` hits only play when the image feature for that drum is strong (low-band onsets for kicks, edges for snares, upper texture for hats). The pattern variant (busier or simpler) is picked per bar from how busy that part of the image is.

## Arrangement

**Song form** (Loop / Short / Medium / Long) turns the loop into a structured song. The form depends on the genre:

| Form | Genres | Sections (Medium) |
|---|---|---|
| Drop | House, Drum & bass, Synthwave, Trap | Intro 8 · Build 4 · Drop 16 · Breakdown 8 · Build 4 · Drop 16 · Outro 8 |
| Song | Ekphrasis, Lo-fi, Jazz, Chiptune | Intro 4 · Verse 8 · Chorus 8 · Verse 8 · Bridge 4 · Chorus 8 · Outro 4 |
| Classical | Classical | Introduction · Theme A · Theme B · Development · Recapitulation · Coda |
| Arc | Ambient, Gamelan | Emergence · Bloom · Peak · Dissolve |

Short is half the length of Medium and Long is 1.5×.

- **Repetition comes from the image.** Each *unique* section gets its own slice of the image, and together the slices cover the whole image once. A repeated section (the second chorus, the second drop, the recapitulation) re-scans the same slice with the same chords and the same random seed, so it comes back note for note.
- **Sections shape the band.** Each section type sets which voices play and how loud, and scales note density and groove. Examples: breakdowns drop the drums and bass, intros keep only the hats, builds mute the lead and switch to straight quarter-note kicks.
- **Transitions:**
  - **Filter sweeps:** a master low-pass opens through intros and closes through outros; a master high-pass rises through builds.
  - **Builds:** a noise riser plus a snare roll that speeds up from quarters to 8ths to 16ths to 32nds, ending in a silent gap just before the drop.
  - **Section starts and fades:** crashes on big section starts, a fade-in on intros and a fade-out on outros.
- **Video** stretches the form over the clip's length. If any section would get fewer than 2 bars, the clip loops instead. Webcam always loops.
- The readout shows the current section.

## Reactive visuals

**Visuals → FX** is a stack of WebGL1 post-processing effects. Tick any combination and give each one its own amount. **FX master** scales the whole stack, and section intensity scales it further. Effects apply in the fixed order below, one GPU pass each, so a stack of 3 costs 3 full-screen passes.

| Group | Effects |
|---|---|
| Space | **Zoom punch** (kick zoom + nudge), **Kick ripples** (a ring expands after every kick), **Liquid warp** (bass), **Tunnel** (log-polar fly-through, speed follows the bass), **Kaleidoscope** (segments follow intensity), **Mirror folds** (Catoptron-style), **Pixelate** (block size jumps on snares) |
| Time | **Feedback trails**: has its own history buffer, so it works anywhere in the stack; lead pitch steers its rotation |
| Color | **RGB split**, **Hue shift** (drift + melody), **Duotone** (luminance mapped between the chord color and its complement), **Posterize** (fewer levels in intense sections) |
| Texture | **Neon edges** (Sobel edges in the chord color, brighter on hats/kicks), **Halftone print** (45° dot screen), **Glitch** |
| Finish | **Bloom**, **Vignette** (breathes with the bass), **CRT / film grain** (curvature, scanlines, aperture mask, grain), **Strobe** (kick flashes, snare half-inverts) |

**Presets**: None, Pulse, Dream, Club, Trip, Catoptron, Neon, Tunnel, Retro, Print, Glitch. A preset is a starting point: ticking or adjusting any effect switches it to Custom. Dragging an amount slider switches that effect on.

The effects are driven by features computed from the **score**, not from an audio analyser: kick, snare, hat and bass envelopes, time since the last kick and snare, lead level and pitch, the chord root as a hue (the inverse of the color→key mapping), and section intensity. So **Export MP4 bakes in exactly what you see live**.

On a GPU each pass costs about a millisecond. Without hardware WebGL (software rasterizers such as SwiftShader), every pass runs on the CPU. In testing on a 2-core machine with software rendering, a 6-effect stack at 720p rendered at about 1 frame/s, and one effect at about 7–9 frames/s. That's why the FX default to None on software GL.

## Demo images

**Source → Demo image** picks the generator, and **New demo** re-rolls the seed. **Random** picks a new type each time. Each generator takes about 4–190 ms.

| Type | What the scanner gets |
|---|---|
| Landscape | layered ridgelines → melodic contours, trees → rhythm |
| Nebula | domain-warped gas clouds, stars and bright cores → slow, sparse, colorful |
| Night city | lit-window grids → dense hats and arps, skyline → melody, water reflection |
| Bauhaus abstract | bold primaries and hard edges on paper → punchy, high contrast |
| Op-art waves | warped stripes or moiré rings → very rhythmic, busy |
| Flow field | thousands of streamlines → constant texture and motion |
| Mandala | N-fold radial symmetry → made for the radar and rings scan paths |
| Aurora | curtains over a dark ridge → ambient |
| Julia fractal | escape-time Julia sets with smooth coloring |
| Pixel art | 160×90 scene scaled up crisp → blocky steps, made for chiptune |

## Instruments

There are six voices, each with an instrument selector:

- **Lead / Arpeggio / Chords**: saw, square, pulse, chip square, flute, bowed string, brass, organ, electric piano (FM), piano (modal), guitar pluck and harp (Karplus-Strong), marimba, vibraphone, FM bell, music box, kalimba, gamelan metal, glass, warm pad, strings, choir (formant filters), glass pad, poly synth, synth stab
- **Bass**: synth, sub, acid (resonant 303-style with glide), reese, 808 (pitch punch, glide, drive), upright (Karplus-Strong), FM bass, chip triangle, pizzicato
- **Drums**: studio, retro (gated snare), 808 (metallic hats), 909, breaks, lo-fi (filtered, bit-crushed), brushes, chip, orchestral (timpani, gong), gamelan (gong, bonang, kendang)
- **Atmosphere**: vinyl crackle, drone, noise riser (every 4th bar), shimmer

Everything is synthesized with WebAudio. There are no samples.

## How the picture becomes music

| Visual feature | Musical result |
|---|---|
| Dominant hue | Key root, via the hue wheel mapped onto the circle of fifths (red C, orange G, yellow D, green A, cyan E …) |
| Warmth + brightness | Mode, from dark to bright: Phrygian → Aeolian → Dorian → Mixolydian → Ionian → Lydian. Near-grayscale images get pentatonic scales |
| Contrast + edge density (+ motion) | Tempo (within the genre's range), pattern variant, fills |
| Most salient band in each column (color + local contrast + edges + motion) | Lead pitch. The band's travel is stretched across the melody range |
| Column-to-column change (onset flux) | When lead notes start. Notes are held while the feature persists and rest when it fades |
| Color drift of each bar vs. the key color | Chord choice: drift magnitude sets distance from the tonic, and drift direction picks the IV/V side or the vi/ii side |
| Bar saturation + brightness | Pad filter brightness |
| Column colorfulness / texture | Arpeggio density |
| Low-band onsets | Extra bass notes and kicks |
| Texture in the upper band | Hi-hat fills |

**Scan paths**: left → right, top → bottom, radar sweep (angle = time, radius = pitch) and rings outward (radius = time, angle = pitch).

## Exports

### Export MP4

An offline, frame-accurate render of the whole piece. It doesn't depend on playback, so nothing is dropped and the picture stays sample-locked to the audio.

**Pipeline**
1. **Score**: images use the composed song. Video files are composed by stepping through the clip; no playthrough needed.
2. **Audio**: rendered with an OfflineAudioContext at 48 kHz and peak-normalized.
3. **Frames**:
   - **GPU path** (`scene.js`, WebGL1): one pipeline draws the media texture through the camera, an analytic playhead glow in the compose shader, note particles as additive quads, then the reactive FX and a fade. Still images are uploaded once, and nothing is read back except by the encoder.
   - **2D path** (`render.js`): the same look minus FX. It's used when there's no WebGL, and when the GPU is a software rasterizer (SwiftShader, llvmpipe, Microsoft Basic Render) with FX off, where 2D is much faster.
4. **Video sources**: the file is demuxed (`engine/demux.js`: MP4/MOV including fragmented MP4, and WebM/MKV including MediaRecorder output) and decoded with **WebCodecs VideoDecoder**. Supported codecs are H.264, HEVC, VP8, VP9 and AV1, where the browser can decode them. Decoding is sequential, uses hardware where available, is frame-exact, and handles rotation and edit lists. If a file can't be decoded this way, it falls back to stepping the `<video>` element with `requestVideoFrameCallback` (`engine/videostep.js`), and then to seeking.
5. **Encode**: WebCodecs H.264 (hardware preferred) plus AAC, or Opus where AAC isn't available. Backpressure uses the encoder's `dequeue` event, and the loop yields through MessageChannel rather than timers, so background tabs don't throttle the export.
6. **Mux** (`engine/mp4.js`): ftyp, then a 64-bit mdat, then audio, video and moov (co64 past 4 GB). With **Save straight to disk** (File System Access API, Chromium), samples stream to the file as they're encoded, so memory stays flat for long or 4K exports. Otherwise the file is assembled in memory and downloaded.

**Options**
- Resolution: 720p, 1080p, 1440p or 2160p (the short side).
- Aspect: Source, 16:9, 9:16 vertical, 1:1 or 4:5.
- Framing: Fill (crop) or Fit (letterbox).
- Frame rate: 24, 30 or 60 fps.
- Quality: Standard, High or Maximum, mapped to a bits-per-pixel bitrate.
- Fade in/out: on by default. The picture fades in over 0.6 s and fades to black through the reverb tail.
- The export panel shows a live preview, progress, frames/s, speed against real time, and an ETA, with a Cancel button.

**Camera** (Visuals): Static, Drift (slow seeded pan and zoom moves every 8 bars) or Follow the scan (zoomed in, tracking the playhead; zoom grows with section intensity). Camera moves are deterministic functions of time, so the live view and the export match.

**Measured in headless Chrome, with no GPU and software H.264:**

| Case | Speed |
|---|---|
| Image, 1280×720, 30 fps, 2D path | about 2–3× real time |
| 1080p H.264 source video, 720p output | WebCodecs decode about 2–6 ms/frame (`<video>` stepping about 80 ms/frame; seeking 100–160 ms/frame) |
| FX on software WebGL | about 7–9 frames/s; full-screen shader passes are CPU-rasterized there |

On a real GPU the FX passes cost about a millisecond. Each export logs a per-stage timing line (`[export] …`) to the console.

**Hardware-decoder safety (v1.4.1).** Hardware video decoders hand out frames from a small pool and stall if the app holds on to them. The frame source now keeps at most about 4 frames in flight, and releases every frame that can no longer be shown as soon as it arrives. It flushes the end of the stream without blocking, stops touching the decoder once the final frame is on screen, and treats a stalled or failing end-of-stream flush as non-fatal: the last decoded frame is held through the audio tail. Export failures now stay in the export panel with the stage and error message until dismissed.

Frame accuracy was verified pixel-wise against the browser's own seeks on H.264 (B-frames and edit lists, fragmented, MOV, rotated), VP8, VP9 and AV1. An exported 1080p H.264 clip matches the source frame for frame (each exported frame best matches the same source frame index).

### Other exports
- **Render WAV**: offline render, normalized to −1 dBFS.
- **Export MIDI**: a type-1 SMF with one track per voice. Each track gets the GM program of its chosen instrument, and drums go on channel 10.
- **Record live (● Rec)**: records the view plus the music in real time with MediaRecorder, as MP4 where supported. Use this for webcam.

## Files

```
index.html          shell
style.css
main.js             app wiring: sources, transport, panel, rendering, exports
ui.js               declarative control-panel builder
engine/analysis.js  scan-path sampling → cell grid (hue/sat/luma/chroma/texture/edge/motion) + stats
engine/theory.js    modes, keys, chords, color → key mapping
engine/genres.js    genre definitions, drum patterns, auto-genre picker
engine/arranger.js  song forms, section shaping, transitions (sweeps, risers, rolls, fades)
engine/composer.js  grid → note events per step (lead, arp, chords, bass, drums, atmosphere)
engine/instruments.js  melodic/bass/atmosphere patches on six synthesis engines
engine/drums.js     drum pieces and kits
engine/synth.js     role buses, inserts (drive/bit-crush/lowpass), sidechain pump, reverb, echo
engine/sequencer.js lookahead scheduler, score timing, offline render
engine/export.js    WAV encoder, MIDI writer, recorder helpers
engine/mp4.js       WebCodecs H.264/AAC/Opus encode + streaming ISO-BMFF (MP4) muxer, memory/file sinks
engine/demux.js     MP4/MOV/fMP4 + WebM/MKV demuxers, WebCodecs frame source (DecodedVideo)
engine/videostep.js <video> frame stepping fallback, duration fix for MediaRecorder WebM
scene.js            WebGL1 scene renderer: media + camera, playhead, notes, FX (live view and export)
render.js           2D renderer with the same look (no-WebGL / software-GL path)
fx.js               19-effect shader library, presets, score-derived audio features
engine/demo.js      ten seeded procedural demo generators
```

Space toggles play. `window.ekphrasis` exposes state for debugging.

v1.7.0

**Mobile pass (1.6.0).** On phones the view and piano roll stay docked at the top and each panel section (Source, Style, Arrangement…) is a tab directly underneath; in landscape the tabs sit in a narrower side panel. **Confirm changes before applying** (Source tab, on by default): composition settings (genre, key, harmony, rhythm, form…) wait for **⏎ Apply** in the top bar or Enter instead of rewriting the song on every slider step; mixer, effects and visuals stay live. Fixed the panel running off the right edge on narrow screens.

## Shared image shelf

The **⇄ Shelf** button opens the image shelf shared by all apps on [snicker02.github.io](https://snicker02.github.io/#shelf). It stores images in this browser only (IndexedDB), and every app on the site can read the same shelf.

- **Load here** brings a shelf image into Ekphrasis as the source to compose from. Opening the app with `?shelf=<id>` does the same on start, which is how other apps' **Send to** works.
- Add files, Paste, or drop images on the panel to put them on the shelf.

The shelf code lives in [`snicker02.github.io/shared/bridge.js`](https://github.com/snicker02/snicker02.github.io/blob/main/shared/bridge.js). If it can't load (for example when you're offline), the app works as before and the button is hidden.

## License

MIT — see [LICENSE](LICENSE).
