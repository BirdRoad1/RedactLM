#!/usr/bin/env bash
# Rebuilds every icon in public/ from the HackUMBC 2026 crest:
#   favicon.svg                 the crest, optimized (svgo)
#   favicon.ico                 16, 32 and 48 px, transparent
#   apple-touch-icon.png        180 px on the brand's navy (iOS turns transparency black)
#   icon-192.png, icon-512.png  the same, for the web manifest
#   icon-maskable-512.png       smaller crest, inside Android's circular safe zone
# Needs rsvg-convert (apt install librsvg2-bin), python3 and bun.
# Run from apps/web: bash scripts/build-icons.sh
set -euo pipefail
cd "$(dirname "$0")/.."
src=src/assets/hackumbc2026-logo.svg
out=public
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

bunx --bun svgo@4 --quiet --multipass --precision 1 -i "$src" -o "$out/favicon.svg"

# the opaque icons: the crest nested in a navy square with a faint glow
python3 - "$out/favicon.svg" "$tmp" <<'PY'
import re, sys
crest, tmp = open(sys.argv[1]).read(), sys.argv[2]
inner = re.sub(r"^<svg[^>]*>", "", crest).rsplit("</svg>", 1)[0]
for name, size, share in [("apple-touch-icon", 180, 0.76), ("icon", 512, 0.76), ("icon-maskable", 512, 0.60)]:
    c = round(size * share); off = (size - c) / 2
    open(f"{tmp}/{name}.svg", "w").write(f'''<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
<defs><radialGradient id="glow" cx="0.25" cy="0.2" r="0.9"><stop offset="0" stop-color="#26335e"/><stop offset="1" stop-color="#111522"/></radialGradient></defs>
<rect width="{size}" height="{size}" fill="url(#glow)"/>
<svg x="{off}" y="{off}" width="{c}" height="{c}" viewBox="0 0 1200 1200">{inner}</svg>
</svg>''')
PY
rsvg-convert "$tmp/apple-touch-icon.svg" -o "$out/apple-touch-icon.png"
rsvg-convert -w 192 -h 192 "$tmp/icon.svg" -o "$out/icon-192.png"
rsvg-convert "$tmp/icon.svg" -o "$out/icon-512.png"
rsvg-convert "$tmp/icon-maskable.svg" -o "$out/icon-maskable-512.png"

# favicon.ico: an .ico can hold PNGs directly, so no ImageMagick needed
for n in 16 32 48; do rsvg-convert -w $n -h $n "$out/favicon.svg" -o "$tmp/$n.png"; done
python3 - "$tmp" "$out/favicon.ico" <<'PY'
import struct, sys
tmp, dest = sys.argv[1], sys.argv[2]
images = [(n, open(f"{tmp}/{n}.png", "rb").read()) for n in (16, 32, 48)]
offset = 6 + 16 * len(images)
out = struct.pack("<HHH", 0, 1, len(images))
for n, data in images:
    out += struct.pack("<BBBBHHII", n, n, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
open(dest, "wb").write(out + b"".join(data for _, data in images))
PY

echo "Icons written to $out/"
