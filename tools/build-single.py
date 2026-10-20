"""Bundles both game versions into one self-contained HTML file in dist/.

The file needs no server or internet: double-click it to play. Re-run this
after changing the game:  python tools/build-single.py
"""
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
NAME = "Tini Delivery Run"

css = (ROOT / "css" / "style.css").read_text(encoding="utf-8")
jump_js = (ROOT / "js" / "game.js").read_text(encoding="utf-8")
lanes_js = (ROOT / "js" / "game-lanes.js").read_text(encoding="utf-8")

for source in (jump_js, lanes_js):
    assert "</script" not in source, "game code can't contain </script when inlined"

page = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, viewport-fit=cover">
  <title>{NAME}</title>
  <style>
{css}
  </style>
</head>
<body>
  <main>
    <h1>{NAME} <span class="version" id="version-label"></span></h1>
    <canvas id="game" aria-label="{NAME} game"></canvas>
    <div class="controls" id="controls"></div>
    <ul class="help" id="help"></ul>
    <p class="switch"><a id="switch-link" href="#lanes"></a></p>
  </main>

  <script type="text/plain" id="jump-game">
{jump_js}
  </script>
  <script type="text/plain" id="lanes-game">
{lanes_js}
  </script>
  <script>
    (() => {{
      const lanes = location.hash === '#lanes';
      const controls = document.getElementById('controls');
      const help = document.getElementById('help');
      const canvas = document.getElementById('game');
      const link = document.getElementById('switch-link');

      document.getElementById('version-label').textContent = lanes ? 'Lane version' : 'Jump version';
      link.textContent = lanes ? 'Play the jump version instead' : 'Play the lane version instead';
      link.href = lanes ? '#jump' : '#lanes';

      if (lanes) {{
        canvas.width = 900;
        canvas.height = 400;
        controls.innerHTML =
          '<button id="btn-up" class="control" type="button" aria-label="Move up a lane">▲</button>' +
          '<button id="btn-down" class="control" type="button" aria-label="Move down a lane">▼</button>';
        help.innerHTML =
          '<li><kbd>↑</kbd> / <kbd>↓</kbd> to change lane — or tap the top or bottom half of the game</li>' +
          '<li>Steer onto the delivery bay that matches your van\\'s colour to deliver</li>' +
          '<li>Steer around the wrong bays, potholes, oncoming cars and swooping birds</li>';
      }} else {{
        canvas.width = 900;
        canvas.height = 320;
        controls.classList.add('single');
        controls.innerHTML = '<button id="btn-jump" class="control" type="button">Jump</button>';
        help.innerHTML =
          '<li><kbd>Space</kbd> / <kbd>↑</kbd> / tap to jump — hold for a higher jump</li>' +
          '<li>Drive over the delivery bay that matches your van\\'s colour to deliver</li>' +
          '<li>Jump over the wrong bays, potholes and oncoming cars — stay down for birds</li>';
      }}

      // Each game sets up its own listeners, so switching versions reloads the page
      window.addEventListener('hashchange', () => location.reload());

      const game = document.createElement('script');
      game.textContent = document.getElementById(lanes ? 'lanes-game' : 'jump-game').textContent;
      document.body.appendChild(game);
    }})();
  </script>
</body>
</html>
"""

DIST.mkdir(exist_ok=True)
html_path = DIST / f"{NAME}.html"
html_path.write_text(page, encoding="utf-8")

# Some email systems block .html attachments, so also ship a zip
zip_path = DIST / f"{NAME}.zip"
with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
    z.write(html_path, html_path.name)

print(f"Wrote {html_path} ({html_path.stat().st_size // 1024} KB)")
print(f"Wrote {zip_path} ({zip_path.stat().st_size // 1024} KB)")
