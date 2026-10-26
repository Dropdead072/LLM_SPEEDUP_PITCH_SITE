"""Кодирование PNG-кадров в mp4 (H.264) и gif без ffmpeg в системе.

    pip install av pillow
    python encode.py clips/clip_mixer/frames clips/clip_mixer/clip_mixer --fps 30 [--gif]

mp4 пишет PyAV (внутри свой ffmpeg с libx264), gif — Pillow. record.mjs вызывает этот
скрипт сам, если ffmpeg не найден в PATH.
"""
import argparse
import sys
from fractions import Fraction
from pathlib import Path

import av
from PIL import Image


def encode_mp4(frames: list[Path], out: Path, fps: int) -> None:
    first = Image.open(frames[0])
    w, h = first.size
    w, h = w - w % 2, h - h % 2  # yuv420p требует чётных сторон
    with av.open(str(out), "w") as container:
        stream = container.add_stream("libx264", rate=Fraction(fps))
        stream.width, stream.height = w, h
        stream.pix_fmt = "yuv420p"
        stream.options = {"crf": "16", "preset": "medium", "movflags": "+faststart"}
        for f in frames:
            img = Image.open(f).convert("RGB").crop((0, 0, w, h))
            for packet in stream.encode(av.VideoFrame.from_image(img)):
                container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def encode_gif(frames: list[Path], out: Path, fps: int, width: int = 1280) -> None:
    imgs = []
    for f in frames:
        im = Image.open(f).convert("RGB")
        im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
        imgs.append(im.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE))
    imgs[0].save(out, save_all=True, append_images=imgs[1:], duration=round(1000 / fps), loop=0, optimize=False, disposal=1)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("frames", type=Path, help="каталог с 00000.png, 00001.png, …")
    ap.add_argument("out", type=Path, help="путь без расширения")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--gif", action="store_true")
    a = ap.parse_args()
    frames = sorted(a.frames.glob("*.png"))
    if not frames:
        print("нет кадров в", a.frames, file=sys.stderr)
        return 1
    mp4 = a.out.with_suffix(".mp4")
    encode_mp4(frames, mp4, a.fps)
    print("  ->", mp4)
    if a.gif:
        gif = a.out.with_suffix(".gif")
        encode_gif(frames, gif, a.fps)
        print("  ->", gif)
    return 0


if __name__ == "__main__":
    sys.exit(main())
