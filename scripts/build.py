"""Deterministic, dependency-free XPI builder. Python 3.9+."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def build():
    addon = ROOT / "addon"
    manifest = json.loads((addon / "manifest.json").read_text(encoding="utf-8"))
    files = sorted(p for p in addon.rglob("*") if p.is_file())
    allowed = {".js", ".json", ".svg", ".png", ".ico", ".ftl"}
    for path in files:
        if path.suffix.lower() not in allowed:
            raise ValueError(f"Unexpected package file: {path}")
    output = ROOT / "dist" / f"zotero-tray-{manifest['version']}.xpi"
    output.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            info = zipfile.ZipInfo(path.relative_to(addon).as_posix(), (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
        info = zipfile.ZipInfo("LICENSE", (2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, (ROOT / "LICENSE").read_bytes())
    digest = hashlib.sha256(output.read_bytes()).hexdigest()
    output.with_suffix(".xpi.sha256").write_text(f"{digest}  {output.name}\n", encoding="ascii")
    print(f"Built {output}\nSHA-256 {digest}")
    return output


if __name__ == "__main__":
    build()
