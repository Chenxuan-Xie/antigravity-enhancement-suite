"""Encode anonymous browser frame recordings as 20 fps GIFs; no retouching."""
import json
import pathlib
import sys
from PIL import Image

manifest = pathlib.Path(sys.argv[1]).resolve()
assets = pathlib.Path(sys.argv[2]).resolve()
for recording in json.loads(manifest.read_text(encoding="utf-8")):
    filenames = sorted(pathlib.Path(recording["directory"]).glob("*.png"))
    assert len(filenames) == recording["frames"]
    # One shared GIF palette keeps unchanged UI pixels stable across frames.
    # This is format encoding, without cropping, repainting or retouching.
    samples = filenames[::max(1, len(filenames) // 12)]
    with Image.open(filenames[0]) as first:
        width, height = first.size
    palette_source = Image.new("RGB", (width, height * len(samples)))
    for index, filename in enumerate(samples):
        with Image.open(filename) as original:
            palette_source.paste(original, (0, index * height))
    palette = palette_source.quantize(colors=256)
    palette_source.close()
    frames = []
    for filename in filenames:
        with Image.open(filename) as original:
            frames.append(original.convert("RGB").quantize(palette=palette, dither=Image.Dither.NONE))
    assert len(frames) == recording["frames"]
    target = assets / (recording["name"] + ".gif")
    frames[0].save(str(target), save_all=True, append_images=frames[1:],
                   duration=50, loop=0, optimize=False, disposal=1)
    with Image.open(target) as result:
        assert result.n_frames > 30
        elapsed = 0
        for index in range(result.n_frames):
            result.seek(index)
            elapsed += result.info.get("duration", 0)
        assert elapsed == recording["durationMs"]
        assert not result.info.get("comment")
    print("Encoded {}: {} frames, {} bytes".format(target.name, len(frames), target.stat().st_size), flush=True)
    for frame in frames:
        frame.close()
    palette.close()
