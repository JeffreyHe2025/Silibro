# Verilog build backend

Bottom-up Verilog builder with per-module compile checking (Icarus Verilog).

**Flow:** plan modules → topological sort (dependencies first) → build each
module in order → after each, run `iverilog` on it + its already-built
dependencies → on a compile error, feed the error back to the LLM and retry.

## Files
| File         | Purpose                                                        |
| ------------ | -------------------------------------------------------------- |
| `server.js`  | Express API: `POST /build`, `POST /compile`, `GET /health`     |
| `build.js`   | plan → topo-sort → build+check loop                            |
| `compile.js` | runs `iverilog` / `yosys` on a set of files, returns `{ ok, output }` |
| `llm.js`     | BYOK LLM caller (Gemini / OpenRouter / OpenAI)                 |

## Prerequisites (on the EC2 box)
```bash
# Icarus Verilog (compile + simulate) and Yosys (synthesis)
sudo apt update && sudo apt install -y iverilog yosys
yosys -V           # 0.30+ recommended

# Node 18+ (needs global fetch). Ubuntu's default may be older — install NodeSource:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v            # should be v18 or newer
```

## Run
```bash
cd backend
npm install
node server.js     # listens on :3000
```

## Try it
Health check:
```bash
curl localhost:3000/health
```

Compile-check some Verilog:
```bash
curl -s localhost:3000/compile -H 'Content-Type: application/json' -d '{
  "files": [{"name":"counter.v","code":"module counter(input clk, output reg [3:0] q); always @(posedge clk) q<=q+1; endmodule"}],
  "top": "counter"
}'
```

Synthesize the whole project with Yosys (the final step, after building and
verifying — no LLM key needed):
```bash
curl -s localhost:3000/synthesize -H 'Content-Type: application/json' -d '{
  "files": [{"name":"counter.v","code":"module counter(input clk, output reg [3:0] q); always @(posedge clk) q<=q+1; endmodule"}]
}' | python3 -m json.tool
```
Returns `{ ok, top, stats, longestPath, netlist, warnings, errors }`. The top
module is detected automatically (testbench files are excluded); pass `"top"`
explicitly if the project has several unconnected roots, and `"liberty"` (path
to a `.lib`) to map to real standard cells and get a chip-area number.

Full bottom-up build (uses YOUR LLM key — free Gemini works):
```bash
curl -s localhost:3000/build -H 'Content-Type: application/json' -d '{
  "spec": "A UART transmitter with a baud-rate generator and a small FIFO.",
  "provider": "google",
  "model": "gemini-2.5-flash",
  "key": "YOUR_GEMINI_API_KEY"
}' | python3 -m json.tool
```
The response has `files` (built modules), and `log` (per-module: attempts,
compiled ok / error).

## Calling it from your website frontend
Point the frontend at `http://<ec2-public-ip>:3000/build` (make sure the EC2
security group allows inbound TCP 3000 from your IP). Pass the user's BYOK
`{ provider, key, model }` in the request body.

## Notes
- Keep the port (3000) firewalled to your own IP while testing.
- This is the minimal loop: plan → build bottom-up → **compile-check each
  module**. Next layers: simulation against testbenches, `verilator --lint-only`,
  `yosys` synth check, and streaming progress over WebSocket.
