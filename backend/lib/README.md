# Standard-cell library (for real µm² chip area)

Drop a Liberty file named **`gscl45nm.lib`** in THIS folder to make
`POST /synthesize` (the "⚙ Synthesize project" button) report a real µm² chip
area instead of the technology-independent gate-equivalent (GE) estimate.

- Get `gscl45nm.lib` (Generic Standard Cell Library, 45 nm) from the synthesis
  tutorial you're following, or any compatible Liberty `.lib`.
- Path the backend looks for: `backend/lib/gscl45nm.lib` (fixed — never taken
  from a request, so there's no injection risk).
- Absent → the flow runs generic synthesis and reports the GE estimate. Present →
  the flow additionally runs `dfflibmap`/`abc`/`stat -liberty` against it.

The area number reflects OUR `synth` optimization + this library's cell areas, so
it won't be bit-identical to a tutorial that uses a lighter `proc; opt; techmap`
flow — but it's a real, consistent µm² area for this technology.
